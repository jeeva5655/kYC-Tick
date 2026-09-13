# Local vision dependencies

This isolated Python service holds the optional local OCR and image-forensics
runtime for the synthetic document-integrity demo.

Installed components:

- `paddleocr` + CPU `paddlepaddle`: local OCR adapter foundation.
- `opencv-python-headless` and `Pillow`: local preprocessing, EXIF inspection,
  error-level analysis, and other explainable image indicators.
- `FastAPI` + `uvicorn`: a local-only service boundary.

It intentionally does **not** expose an image-upload, facial-recognition,
watchlist, or identity-decision endpoint. The current Node UI continues to use
fictional MRZ fixtures only.

Run the dependency-status endpoint after installation:

```powershell
..\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8001
```

Then visit `http://127.0.0.1:8001/health`.

To download the OCR model cache locally and verify that inference runs on a
generated fictional image:

```powershell
$env:PADDLE_PDX_CACHE_HOME = "$PWD\.paddlex-cache"
..\.venv\Scripts\python.exe smoke_test.py
```

The current Windows CPU setup explicitly disables Paddle's oneDNN/MKLDNN path
for inference because PaddlePaddle 3.3 has an upstream regression there. Keep
that setting on any first OCR adapter until the upstream fix is verified.
