import io
import os
import sys
import asyncio
from fastapi import APIRouter, UploadFile, File, HTTPException
import cv2
import numpy as np
from PIL import Image

# Add vendor path so we can import ManTraNet
VENDOR_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "vendor")
MANTRANET_DIR = os.path.join(VENDOR_DIR, "ManTraNet-pytorch-2")
if MANTRANET_DIR not in sys.path:
    sys.path.append(MANTRANET_DIR)

router = APIRouter()

# Lazy-load ManTraNet
_mantra_model = None

def get_mantranet():
    global _mantra_model
    if _mantra_model is None:
        import torch
        from MantraNet.mantranet import pre_trained_model
        
        # Load the v4 weights
        weight_path = os.path.join(MANTRANET_DIR, "MantraNet", "MantraNetv4.pt")
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        _mantra_model = pre_trained_model(weight_path, device=device)
        _mantra_model.eval()
    return _mantra_model

@router.post("/tampering")
async def check_tampering(document_image: UploadFile = File(...)):
    """
    Checks for image tampering using Error Level Analysis (ELA)
    and ManTraNet (pixel-level forgery localization).
    """
    doc_bytes = await document_image.read()
    return await asyncio.to_thread(process_tampering, doc_bytes)

def process_tampering(doc_bytes: bytes) -> dict:
    img_cv = cv2.imdecode(np.frombuffer(doc_bytes, np.uint8), cv2.IMREAD_COLOR)

    if img_cv is None:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    try:
        # 1. Perform basic ELA
        TEMP_QUALITY = 90
        _, encoded_img = cv2.imencode('.jpg', img_cv, [cv2.IMWRITE_JPEG_QUALITY, TEMP_QUALITY])
        compressed_img = cv2.imdecode(encoded_img, cv2.IMREAD_COLOR)
        diff = cv2.absdiff(img_cv, compressed_img)
        
        max_diff = np.max(diff)
        scale = 1.0 if max_diff == 0 else (255.0 / max_diff)
        ela_image = cv2.convertScaleAbs(diff, alpha=scale)
        gray_ela = cv2.cvtColor(ela_image, cv2.COLOR_BGR2GRAY)
        ela_score = float(np.var(gray_ela))
        
        # 2. Perform ManTraNet Deep Learning Forgery Detection
        mantra_score = 0.0
        try:
            import torch
            device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            model = get_mantranet()
            
            # ManTraNet expects RGB PIL image converted to numpy tensor
            im = Image.open(io.BytesIO(doc_bytes)).convert("RGB")
            im_np = np.array(im)
            im_tensor = torch.Tensor(im_np).unsqueeze(0).transpose(2, 3).transpose(1, 2).to(device)
            
            with torch.no_grad():
                final_output = model(im_tensor)
                
            # The output is a mask of probabilities. We take the max probability as the anomaly score.
            mask = final_output[0][0].cpu().detach().numpy()
            mantra_score = float(np.max(mask)) # 0.0 to 1.0 probability
        except ImportError:
            print("ManTraNet not available. Falling back to ELA only.")
        except Exception as e:
            print(f"ManTraNet execution failed: {e}. Falling back to ELA only.")
            
        # 3. Combine heuristics
        # If ELA variance > 1500 OR ManTraNet confidence > 0.8, flag as tampered
        is_tampered = (ela_score > 1500.0) or (mantra_score > 0.8)
        
        return {
            "success": True,
            "tampered": bool(is_tampered),
            "score": ela_score,
            "mantraScore": mantra_score,
            "threshold": 1500.0,
            "message": "Potential tampering detected in document." if is_tampered else "Document image appears consistent."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tampering check failed: {str(e)}")
