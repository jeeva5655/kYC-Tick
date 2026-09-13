import io
import asyncio
from fastapi import APIRouter, UploadFile, File, HTTPException
import numpy as np
import cv2

router = APIRouter()

# Lazy-load the PaddleOCR model so it doesn't block startup
_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        # Initialize RapidOCR
        _ocr = RapidOCR()
    return _ocr

@router.post("/extract-full-text")
async def extract_full_text(document_image: UploadFile = File(...)):
    """
    Extracts all printed text from the document using RapidOCR.
    This captures text outside the MRZ (like Name, DOB, Document Number)
    so we can cross-reference it against the MRZ for discrepancies.
    """
    if not document_image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted.")

    # Read image into memory
    doc_bytes = await document_image.read()
    return await asyncio.to_thread(process_full_ocr, doc_bytes)

def process_full_ocr(doc_bytes: bytes) -> dict:
    img = cv2.imdecode(np.frombuffer(doc_bytes, np.uint8), cv2.IMREAD_COLOR)

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    try:
        ocr = get_ocr()
        # RapidOCR returns a tuple: (result, elapse)
        # result is a list of [box, text, score]
        result, _ = ocr(img)
        
        texts = []
        if result:
            for line in result:
                text = line[1]
                confidence = float(line[2])
                texts.append({"text": text, "confidence": confidence})
                
        return {
            "success": True,
            "full_text": " ".join([t["text"] for t in texts]),
            "raw_texts": [t["text"] for t in texts],
            "details": texts
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Full text OCR processing failed: {str(e)}")
