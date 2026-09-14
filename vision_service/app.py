"""Local-only capability endpoint for the synthetic document-integrity demo.

This service intentionally has no image-upload route yet. The first web UI accepts
only fictional MRZ text; an image route will be introduced only alongside explicit
test-fixture validation and short-lived in-memory processing.
"""

from importlib.metadata import PackageNotFoundError, version
import io
import os

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from passporteye import read_mrz

app = FastAPI(
    title="Synthetic Document Vision Service",
    version="0.1.0",
    description="Local vision processing for the synthetic document-integrity demo.",
)

# Allow requests from the Node.js frontend
allowed_origins = ["http://127.0.0.1:3000", "http://localhost:3000"]
allowed_origins.extend(
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://([a-z0-9-]+\.)?vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def package_version(package_name: str) -> str | None:
    try:
        return version(package_name)
    except PackageNotFoundError:
        return None


@app.get("/health")
def health() -> dict:
    """Report local adapter availability."""
    return {
        "status": "ok",
        "storage": "disabled",
        "imageUpload": "enabled",
        "adapters": {
            "paddleOcr": package_version("paddleocr"),
            "easyocr": package_version("easyocr"),
            "passporteye": package_version("passporteye"),
            "deepface": package_version("deepface"),
        },
        "boundary": "Synthetic fixtures only; no identity decision, watchlist, or biometric matching.",
    }


from modules import module1_ocr, module3_tampering, module4_face, module5_full_ocr, module6_ai_detection, module7_orchestrator

app.include_router(module1_ocr.router, prefix="/api/v1", tags=["OCR Extraction"])
app.include_router(module3_tampering.router, prefix="/api/v1", tags=["Tampering Detection"])
app.include_router(module4_face.router, prefix="/api/v1", tags=["Face Verification"])
app.include_router(module5_full_ocr.router, prefix="/api/v1", tags=["Full Text OCR"])
app.include_router(module6_ai_detection.router, prefix="/api/v1", tags=["AI Image Detection"])
app.include_router(module7_orchestrator.router, prefix="/api/v1", tags=["Unified Orchestrator"])
