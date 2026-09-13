import asyncio
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

# Import the core logic functions from the other modules
from .module1_ocr import process_mrz
from .module3_tampering import process_tampering
from .module4_face import process_face_verification
from .module5_full_ocr import process_full_ocr
from .module6_ai_detection import detect_ai_logic
from .module8_classifier import classify_document
from .module9_indian_id_patterns import parse_indian_id
from .module10_aadhaar_qr_verify import read_qr_numeric_string_from_image, verify_aadhaar_secure_qr

router = APIRouter()

@router.post("/analyze-all")
async def analyze_all(
    document_image: UploadFile = File(...),
    document_back_image: Optional[UploadFile] = File(None),
    live_image: Optional[UploadFile] = File(None),
    manual_document_type: Optional[str] = Form(None)
):
    """
    Unified entrypoint for the Python Vision Microservice.
    Accepts the document image (and optional live selfie) once, and runs
    all forensic, OCR, and AI detection models concurrently.
    """
    if not document_image.filename:
        raise HTTPException(status_code=400, detail="No document image provided")
        
    doc_bytes = await document_image.read()
    doc_back_bytes = await document_back_image.read() if document_back_image else None
    live_bytes = await live_image.read() if live_image else None

    # Phase 1: Launch independent concurrent tasks
    paddle_task = asyncio.create_task(asyncio.to_thread(process_full_ocr, doc_bytes))
    paddle_back_task = asyncio.create_task(asyncio.to_thread(process_full_ocr, doc_back_bytes)) if doc_back_bytes else None
    
    tamper_task = asyncio.create_task(asyncio.to_thread(process_tampering, doc_bytes))
    ai_task = asyncio.create_task(asyncio.to_thread(detect_ai_logic, doc_bytes))
    
    face_task = None
    if live_bytes:
        face_task = asyncio.create_task(asyncio.to_thread(process_face_verification, doc_bytes, live_bytes))

    # Task F: QR Code extraction
    async def run_qr():
        qr_string = None
        if doc_back_bytes:
            qr_string = read_qr_numeric_string_from_image(doc_back_bytes)
        if not qr_string:
            qr_string = read_qr_numeric_string_from_image(doc_bytes)
            
        if not qr_string:
            return {"signature_valid": None, "reason": "No readable QR code found in image.", "fields": {}}
        # Verify the secure QR string
        cert_path = "uidai_publickey.cer"
        res = verify_aadhaar_secure_qr(qr_string, cert_path)
        return {
            "signature_valid": res.signature_valid,
            "reason": res.reason,
            "fields": res.fields
        }
        
    qr_task = asyncio.create_task(run_qr())

    try:
        full_ocr_result = await paddle_task
        if paddle_back_task:
            back_ocr_result = await paddle_back_task
            if back_ocr_result.get("success"):
                full_ocr_result["full_text"] += " " + back_ocr_result.get("full_text", "")
                if "raw_texts" in back_ocr_result:
                    full_ocr_result["raw_texts"].extend(back_ocr_result["raw_texts"])
    except Exception as e:
        full_ocr_result = {"success": False, "error": str(e), "full_text": ""}

    ocr_text = full_ocr_result.get("full_text", "")
    
    # Classify Document
    if manual_document_type and manual_document_type != "auto":
        doc_type = manual_document_type
    else:
        doc_type = classify_document(ocr_text)

    # Phase 2: Launch ID extraction based on doc type
    if doc_type == "passport":
        extra_task = asyncio.create_task(asyncio.to_thread(process_mrz, doc_bytes))
    elif doc_type == "unknown":
        # Don't try to parse anything, just return dummy
        async def dummy_unknown():
            return {"document_type": "unknown", "is_valid": False, "reason": "Unknown document type"}
        extra_task = asyncio.create_task(dummy_unknown())
    else:
        # Run Indian ID parse (mostly synchronous, but wrap in task for uniform gather)
        async def run_indian_parse():
            return parse_indian_id(ocr_text, doc_type)
        extra_task = asyncio.create_task(run_indian_parse())

    # Wait for the rest of the tasks
    gather_tasks = [tamper_task, ai_task, extra_task, qr_task]
    if face_task:
        gather_tasks.append(face_task)

    results = await asyncio.gather(*gather_tasks, return_exceptions=True)
    
    tampering = results[0] if not isinstance(results[0], Exception) else {"success": False, "error": str(results[0])}
    ai_detect = results[1] if not isinstance(results[1], Exception) else {"success": False, "error": str(results[1])}
    extra_result = results[2] if not isinstance(results[2], Exception) else {"success": False, "error": str(results[2])}
    qr_result = results[3] if not isinstance(results[3], Exception) else {"signature_valid": None, "error": str(results[3])}
    
    face_verif = None
    if face_task:
        face_verif = results[4] if not isinstance(results[4], Exception) else {"success": False, "error": str(results[4])}

    # Aggregate and return to the Node backend
    # We pass 'extra_result' as 'idExtract' (for Aadhaar, PAN, etc.) or 'mrzExtract' (for Passport)
    # The Node backend can differentiate based on `document_type`.
    # Let's ensure document_type is top level.
    
    payload = {
        "documentType": doc_type,
        "mrzExtract": extra_result if doc_type == "passport" else None,
        "idExtract": extra_result if doc_type != "passport" else None,
        "fullTextOcrResult": full_ocr_result,
        "tamperingResult": tampering,
        "aiDetectionResult": ai_detect,
        "faceVerification": face_verif,
        "qrVerification": qr_result
    }
    
    return payload
