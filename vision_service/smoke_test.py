"""Run a local PaddleOCR smoke test using a generated fictional fixture only."""

from pathlib import Path
from tempfile import TemporaryDirectory

from paddleocr import PaddleOCR
from PIL import Image, ImageDraw, ImageFont


def test_font(size: int) -> ImageFont.FreeTypeFont:
    windows_font = Path(r"C:\Windows\Fonts\arial.ttf")
    if windows_font.exists():
        return ImageFont.truetype(str(windows_font), size)
    return ImageFont.load_default()


with TemporaryDirectory(prefix="synthetic-ocr-") as temporary_directory:
    fixture_path = Path(temporary_directory) / "fictional_fixture.png"
    image = Image.new("RGB", (1600, 560), "white")
    canvas = ImageDraw.Draw(image)
    font = test_font(58)
    canvas.text((80, 70), "DEMO / NOT A REAL TRAVEL DOCUMENT", fill="black", font=font)
    canvas.text((80, 190), "JORDAN DOE", fill="black", font=font)
    canvas.text((80, 310), "DOCUMENT XK0000001", fill="black", font=font)
    image.save(fixture_path)

    ocr = PaddleOCR(
        lang="en",
        # PaddlePaddle 3.3's CPU oneDNN path currently has a Windows inference
        # regression. Disabling it keeps this local, CPU-only demo reliable.
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    results = list(ocr.predict(str(fixture_path)))
    if not results:
        raise RuntimeError("PaddleOCR returned no result for the fictional fixture.")

    # The model's structured output varies by PaddleOCR release. Reaching this
    # point confirms that local model initialization and inference completed.
    print("Synthetic OCR smoke test passed: local model initialized and inference completed.")
