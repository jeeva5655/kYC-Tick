"""
5-Gate Deep Forensic AI Detection Engine
=========================================
Gate 1A: EXIF Metadata Analysis — Was this from a real camera?
Gate 1B: Screen Recapture Detection — Was this a photo OF a screen?
Gate 2:  ELA + Noise Residual — Were pixels tampered with?
Gate 3:  DCT Frequency + Benford's Law — Does the math look natural?
Gate 4:  (ManTraNet — handled by module3_tampering.py, wired at frontend)
Gate 5:  (MRZ Checksum — handled by screening.js, wired at frontend)

All gates run 100% locally. Zero cloud APIs. Zero model downloads for Gates 1-3.
"""

import io
import math
import numpy as np
import cv2
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
from fastapi import APIRouter, File, UploadFile, HTTPException
from scipy.fft import dctn

router = APIRouter()

# ─── Known AI/Editor software signatures ───
AI_SOFTWARE_KEYWORDS = [
    "midjourney", "dall-e", "dalle", "stable diffusion", "stablediffusion",
    "playground", "firefly", "adobe firefly", "imagen", "flux",
    "comfyui", "automatic1111", "invoke", "novelai", "nightcafe",
    "deepai", "craiyon", "bing image creator", "copilot designer",
    "leonardo", "ideogram", "runway", "pika", "synthesia",
    "photoshop", "gimp", "paint.net", "canva", "pixlr", "fotor",
    "lightroom", "affinity", "corel", "krita",
]

CAMERA_EXIF_FIELDS = ["Make", "Model", "LensModel", "FocalLength", "ISOSpeedRatings",
                       "ExposureTime", "FNumber", "Flash", "WhiteBalance"]


# ═══════════════════════════════════════════════════════════════════
# GATE 1A — EXIF / Metadata Analysis
# ═══════════════════════════════════════════════════════════════════

def gate_1a_exif(img: Image.Image) -> dict:
    """Analyze EXIF metadata for camera authenticity."""
    result = {
        "gate": "1A",
        "name": "EXIF Metadata Analysis",
        "score": 0.0,       # 0 = real camera, 1 = AI/synthetic
        "weight": 0.8,
        "details": {},
        "verdict": "UNKNOWN"
    }

    exif_data = {}
    try:
        raw_exif = img._getexif()
        if raw_exif:
            for tag_id, value in raw_exif.items():
                tag = TAGS.get(tag_id, tag_id)
                if isinstance(value, bytes):
                    try:
                        value = value.decode("utf-8", errors="ignore")
                    except Exception:
                        value = str(value)
                exif_data[str(tag)] = str(value)
    except Exception:
        pass

    result["details"]["exif_tags_found"] = len(exif_data)

    # Check for camera-specific fields
    camera_fields_found = 0
    for field in CAMERA_EXIF_FIELDS:
        if field in exif_data:
            camera_fields_found += 1

    result["details"]["camera_fields_found"] = camera_fields_found
    result["details"]["camera_fields_checked"] = len(CAMERA_EXIF_FIELDS)

    # Check for GPS data
    has_gps = any("GPS" in str(k) for k in exif_data.keys())
    result["details"]["has_gps"] = has_gps

    # Check for software tags
    software = exif_data.get("Software", "").lower()
    processing_software = exif_data.get("ProcessingSoftware", "").lower()
    image_description = exif_data.get("ImageDescription", "").lower()
    all_text = f"{software} {processing_software} {image_description}"

    ai_keywords_found = [kw for kw in AI_SOFTWARE_KEYWORDS if kw in all_text]
    result["details"]["software_tag"] = exif_data.get("Software", "None")
    result["details"]["ai_keywords_found"] = ai_keywords_found

    # Scoring
    if ai_keywords_found:
        result["score"] = 0.95
        result["verdict"] = "AI_SOFTWARE_DETECTED"
    elif len(exif_data) == 0:
        result["score"] = 0.4  # Lowered: browser uploads always strip EXIF, so missing metadata is not strong forgery evidence
        result["verdict"] = "NO_METADATA"
    elif camera_fields_found == 0:
        result["score"] = 0.7
        result["verdict"] = "NO_CAMERA_DATA"
    elif camera_fields_found < 3:
        result["score"] = 0.5
        result["verdict"] = "PARTIAL_CAMERA_DATA"
    elif camera_fields_found >= 5 and has_gps:
        result["score"] = 0.05
        result["verdict"] = "FULL_CAMERA_DATA"
    else:
        result["score"] = 0.2
        result["verdict"] = "CAMERA_DATA_PRESENT"

    return result


# ═══════════════════════════════════════════════════════════════════
# GATE 1B — Screen Recapture Detection
# ═══════════════════════════════════════════════════════════════════

def gate_1b_screen_recapture(img_cv: np.ndarray) -> dict:
    """Detect if the image is a photograph of a screen (moiré, backlight, pixel grid)."""
    result = {
        "gate": "1B",
        "name": "Screen Recapture Detection",
        "score": 0.0,
        "weight": 1.2,
        "details": {},
        "verdict": "UNKNOWN"
    }

    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # --- Sub-check 1: Moiré pattern detection via FFT ---
    # Moiré produces periodic peaks in the frequency domain
    f_transform = np.fft.fft2(gray.astype(np.float32))
    f_shift = np.fft.fftshift(f_transform)
    magnitude = np.log1p(np.abs(f_shift))

    # Mask out the DC component (center) and low frequencies
    center_y, center_x = h // 2, w // 2
    mask_radius = min(h, w) // 8
    y_coords, x_coords = np.ogrid[:h, :w]
    center_mask = ((y_coords - center_y) ** 2 + (x_coords - center_x) ** 2) <= mask_radius ** 2
    magnitude[center_mask] = 0

    # Look for periodic spikes in mid-to-high frequencies
    mag_mean = np.mean(magnitude)
    mag_std = np.std(magnitude)
    spike_threshold = mag_mean + 4 * mag_std
    spike_count = np.sum(magnitude > spike_threshold)
    total_pixels = h * w
    spike_ratio = spike_count / total_pixels

    moire_score = min(1.0, spike_ratio * 500)  # Normalize
    result["details"]["moire_spike_ratio"] = round(float(spike_ratio), 6)
    result["details"]["moire_score"] = round(float(moire_score), 3)

    # --- Sub-check 2: Backlight gradient detection ---
    # Screens have center-bright, edge-dim pattern (opposite of camera vignetting)
    block_size = max(h, w) // 8
    if block_size > 0:
        center_region = gray[h//4:3*h//4, w//4:3*w//4]
        edge_top = gray[:block_size, :]
        edge_bottom = gray[-block_size:, :]
        edge_left = gray[:, :block_size]
        edge_right = gray[:, -block_size:]

        center_mean = float(np.mean(center_region))
        edge_mean = float(np.mean(np.concatenate([
            edge_top.flatten(), edge_bottom.flatten(),
            edge_left.flatten(), edge_right.flatten()
        ])))

        # Screen: center brighter than edges
        brightness_diff = center_mean - edge_mean
        backlight_score = max(0, min(1.0, brightness_diff / 40.0))
    else:
        backlight_score = 0.0
        brightness_diff = 0.0

    result["details"]["center_brightness"] = round(center_mean if block_size > 0 else 0, 1)
    result["details"]["edge_brightness"] = round(edge_mean if block_size > 0 else 0, 1)
    result["details"]["backlight_score"] = round(float(backlight_score), 3)

    # --- Sub-check 3: Color banding (quantized color depth) ---
    # Screens display limited color depth; photos of screens show stepped histograms
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    non_zero_bins = np.sum(hist > 0)
    color_utilization = non_zero_bins / 256.0

    # Very low utilization suggests quantized (screen-captured) content
    banding_score = max(0, 1.0 - color_utilization) * 2
    banding_score = min(1.0, banding_score)
    result["details"]["color_bins_used"] = int(non_zero_bins)
    result["details"]["banding_score"] = round(float(banding_score), 3)

    # --- Combine sub-scores ---
    combined = (moire_score * 0.5) + (backlight_score * 0.3) + (banding_score * 0.2)
    result["score"] = round(min(1.0, combined), 3)

    if result["score"] > 0.6:
        result["verdict"] = "SCREEN_RECAPTURE_LIKELY"
    elif result["score"] > 0.3:
        result["verdict"] = "SCREEN_ARTIFACTS_PRESENT"
    else:
        result["verdict"] = "NO_SCREEN_ARTIFACTS"

    return result


# ═══════════════════════════════════════════════════════════════════
# GATE 2 — ELA + Noise Residual Analysis
# ═══════════════════════════════════════════════════════════════════

def gate_2_ela_noise(img_cv: np.ndarray) -> dict:
    """Combined Error Level Analysis and Noise Residual for tamper detection."""
    result = {
        "gate": "2",
        "name": "ELA + Noise Residual Analysis",
        "score": 0.0,
        "weight": 1.3,
        "details": {},
        "verdict": "UNKNOWN"
    }

    # --- ELA ---
    quality = 90
    _, encoded = cv2.imencode('.jpg', img_cv, [cv2.IMWRITE_JPEG_QUALITY, quality])
    compressed = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    diff = cv2.absdiff(img_cv, compressed)

    max_diff = np.max(diff)
    scale = 1.0 if max_diff == 0 else (255.0 / max_diff)
    ela_image = cv2.convertScaleAbs(diff, alpha=scale)
    gray_ela = cv2.cvtColor(ela_image, cv2.COLOR_BGR2GRAY)

    ela_variance = float(np.var(gray_ela))
    ela_mean = float(np.mean(gray_ela))

    # AI-generated images tend to have VERY LOW or VERY UNIFORM ELA
    # Real photos have moderate, varied ELA
    if ela_variance < 200:
        ela_score = 0.7  # Suspiciously uniform — likely AI-generated
    elif ela_variance > 2000:
        ela_score = 0.8  # Suspiciously high — likely tampered
    else:
        ela_score = max(0, 0.3 - (ela_variance / 10000))  # Normal range

    result["details"]["ela_variance"] = round(ela_variance, 1)
    result["details"]["ela_mean"] = round(ela_mean, 1)
    result["details"]["ela_score"] = round(float(ela_score), 3)

    # --- Noise Residual ---
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # Denoise with Gaussian blur
    denoised = cv2.GaussianBlur(gray, (5, 5), 1.5)
    noise_residual = gray - denoised

    noise_std = float(np.std(noise_residual))
    noise_entropy = float(np.mean(np.abs(noise_residual)))

    # Real cameras produce noise_std in range ~2-15
    # AI images have very low noise (~0-2) or perfectly uniform noise
    if noise_std < 1.5:
        noise_score = 0.85  # Suspiciously clean — AI-generated
    elif noise_std > 20:
        noise_score = 0.6   # Could be heavy processing
    else:
        noise_score = max(0, 0.2 - (noise_std / 100))

    result["details"]["noise_std"] = round(noise_std, 2)
    result["details"]["noise_entropy"] = round(noise_entropy, 3)
    result["details"]["noise_score"] = round(float(noise_score), 3)

    # --- Noise uniformity check ---
    # Divide image into 4x4 grid, check noise std per block
    h, w = gray.shape
    block_h, block_w = h // 4, w // 4
    block_stds = []
    for i in range(4):
        for j in range(4):
            block = noise_residual[i*block_h:(i+1)*block_h, j*block_w:(j+1)*block_w]
            block_stds.append(float(np.std(block)))

    noise_uniformity = float(np.std(block_stds))
    # Real images have varied noise across regions; AI has uniform noise
    if noise_uniformity < 0.5:
        uniformity_score = 0.7  # Too uniform — suspicious
    else:
        uniformity_score = max(0, 0.2 - (noise_uniformity / 20))

    result["details"]["noise_uniformity"] = round(noise_uniformity, 3)
    result["details"]["uniformity_score"] = round(float(uniformity_score), 3)

    # Combine
    combined = (ela_score * 0.4) + (noise_score * 0.35) + (uniformity_score * 0.25)
    result["score"] = round(min(1.0, combined), 3)

    if result["score"] > 0.6:
        result["verdict"] = "TAMPERING_OR_AI_LIKELY"
    elif result["score"] > 0.35:
        result["verdict"] = "ANOMALIES_DETECTED"
    else:
        result["verdict"] = "PIXELS_APPEAR_NATURAL"

    return result


# ═══════════════════════════════════════════════════════════════════
# GATE 3 — DCT Frequency + Benford's Law
# ═══════════════════════════════════════════════════════════════════

def gate_3_dct_benford(img_cv: np.ndarray) -> dict:
    """DCT frequency spectrum analysis and Benford's Law compliance."""
    result = {
        "gate": "3",
        "name": "DCT Frequency + Benford's Law",
        "score": 0.0,
        "weight": 1.0,
        "details": {},
        "verdict": "UNKNOWN"
    }

    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY).astype(np.float64)

    # --- DCT Frequency Analysis ---
    # Compute 2D DCT
    dct_coeffs = dctn(gray, type=2, norm='ortho')
    dct_abs = np.abs(dct_coeffs)

    # Analyze energy distribution: real photos follow power-law decay
    h, w = gray.shape
    # Radial energy distribution
    center_y, center_x = h // 2, w // 2
    max_radius = min(center_y, center_x)

    radial_energy = []
    for r in range(1, min(max_radius, 100)):
        y_coords, x_coords = np.ogrid[:h, :w]
        ring_mask = ((y_coords ** 2 + x_coords ** 2) >= (r - 1) ** 2) & \
                    ((y_coords ** 2 + x_coords ** 2) < r ** 2)
        ring_energy = float(np.mean(dct_abs[ring_mask])) if np.any(ring_mask) else 0
        radial_energy.append(ring_energy)

    radial_energy = np.array(radial_energy)
    if len(radial_energy) > 2 and radial_energy[0] > 0:
        # Fit log-log slope (power law)
        log_r = np.log(np.arange(1, len(radial_energy) + 1))
        log_e = np.log(radial_energy + 1e-10)
        # Linear regression on log-log
        valid = np.isfinite(log_e)
        if np.sum(valid) > 5:
            slope = float(np.polyfit(log_r[valid], log_e[valid], 1)[0])
        else:
            slope = 0.0

        # Natural images typically have slope between -1.5 and -3.0
        # AI images often have slope outside this range (too flat or too steep)
        if -3.5 < slope < -1.0:
            dct_score = max(0, abs(slope + 2.0) / 3.0)  # Deviation from ideal -2.0
        else:
            dct_score = 0.7  # Abnormal spectrum
    else:
        slope = 0.0
        dct_score = 0.5

    result["details"]["dct_slope"] = round(slope, 3)
    result["details"]["dct_score"] = round(float(dct_score), 3)

    # --- Benford's Law Analysis ---
    # First-digit distribution of DCT coefficients should follow Benford's Law
    # P(d) = log10(1 + 1/d) for d = 1..9
    expected_benford = np.array([math.log10(1 + 1/d) for d in range(1, 10)])

    # Get first digits of non-zero DCT coefficients
    flat_dct = np.abs(dct_coeffs.flatten())
    nonzero = flat_dct[flat_dct > 0.01]

    if len(nonzero) > 100:
        # Extract first significant digit
        log_vals = np.log10(nonzero)
        first_digits = np.floor(10 ** (log_vals - np.floor(log_vals))).astype(int)
        first_digits = first_digits[(first_digits >= 1) & (first_digits <= 9)]

        if len(first_digits) > 50:
            observed = np.array([np.sum(first_digits == d) for d in range(1, 10)], dtype=float)
            observed /= (np.sum(observed) + 1e-10)

            # Chi-squared-like deviation from Benford's Law
            benford_deviation = float(np.sum((observed - expected_benford) ** 2 / (expected_benford + 1e-10)))

            # Natural images: deviation < 0.01
            # AI images: deviation > 0.05
            if benford_deviation < 0.01:
                benford_score = 0.1  # Follows Benford's Law — natural
            elif benford_deviation < 0.05:
                benford_score = 0.4  # Slight deviation
            else:
                benford_score = 0.8  # Strong deviation — likely AI
        else:
            benford_score = 0.5
            benford_deviation = -1.0
    else:
        benford_score = 0.5
        benford_deviation = -1.0

    result["details"]["benford_deviation"] = round(float(benford_deviation), 5)
    result["details"]["benford_score"] = round(float(benford_score), 3)

    # Combine
    combined = (dct_score * 0.5) + (benford_score * 0.5)
    result["score"] = round(min(1.0, combined), 3)

    if result["score"] > 0.6:
        result["verdict"] = "FREQUENCY_ANOMALIES_DETECTED"
    elif result["score"] > 0.35:
        result["verdict"] = "MINOR_SPECTRAL_DEVIATION"
    else:
        result["verdict"] = "FREQUENCY_SPECTRUM_NATURAL"

    return result


# ═══════════════════════════════════════════════════════════════════
# GATE 5 — Synthetic Identity Classifier (FFT Heuristic Placeholder)
# ═══════════════════════════════════════════════════════════════════

def gate_5_synthetic(img_cv: np.ndarray) -> dict:
    """
    Simulates a Synthetic Image Classifier (like DIRE or DMimageDetection).
    Uses high-frequency FFT thresholding. 
    DEMOTED TO INFORMATIONAL: Requires validation with ResNet-50 CNNDetection before acting as a catastrophic block.
    """
    result = {
        "gate": "5",
        "name": "Synthetic Image Classifier (FFT)",
        "score": 0.0,
        "weight": 0.0, # Informational severity, doesn't impact total score
        "details": {},
        "verdict": "UNKNOWN"
    }
    
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1)
    
    h, w = gray.shape
    cy, cx = h // 2, w // 2
    
    # Mask out the low frequencies (center of spectrum)
    r = min(h, w) // 4
    y, x = np.ogrid[:h, :w]
    mask = (x - cx)**2 + (y - cy)**2 >= r**2
    
    high_freq_magnitude = np.mean(magnitude_spectrum[mask])
    result["details"]["high_freq_magnitude"] = round(float(high_freq_magnitude), 3)
    
    # Diffusion and GANs often leave unnatural high-frequency patterns
    if high_freq_magnitude > 250.0:
        result["score"] = 0.9
        result["verdict"] = "SUSPICIOUS_HIGH_FREQUENCY"
    else:
        result["score"] = 0.1
        result["verdict"] = "NATURAL_FREQUENCY"
        
    return result


# ═══════════════════════════════════════════════════════════════════
# UNIFIED ENDPOINT — Runs all gates, produces combined verdict
# ═══════════════════════════════════════════════════════════════════

import asyncio

@router.post("/detect-ai")
async def detect_ai(document_image: UploadFile = File(...)):
    """Run the 5-gate forensic AI detection engine."""
    if not document_image.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    image_bytes = await document_image.read()
    return await asyncio.to_thread(detect_ai_logic, image_bytes)

def detect_ai_logic(image_bytes: bytes) -> dict:
    try:
        # Decode for OpenCV
        img_cv = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img_cv is None:
            raise HTTPException(status_code=400, detail="Invalid image file.")

        # Decode for PIL (EXIF reading)
        img_pil = Image.open(io.BytesIO(image_bytes))

        # Run Gates 1 to 5
        gate_1 = gate_1a_exif(img_pil)
        gate_1["gate"] = "1"
        gate_2 = gate_1b_screen_recapture(img_cv)
        gate_2["gate"] = "2"
        gate_3 = gate_2_ela_noise(img_cv)
        gate_3["gate"] = "3"
        gate_4 = gate_3_dct_benford(img_cv)
        gate_4["gate"] = "4"
        gate_5 = gate_5_synthetic(img_cv)

        gates = [gate_1, gate_2, gate_3, gate_4, gate_5]

        # Weighted average for final score (Gate 5 has weight 0.0)
        total_weight = sum(g["weight"] for g in gates)
        final_score = sum(g["score"] * g["weight"] for g in gates) / total_weight if total_weight > 0 else 0

        # Determine overall verdict
        if final_score > 0.65:
            overall_verdict = "AI_GENERATED_OR_TAMPERED"
            is_artificial = True
        elif final_score > 0.55:
            overall_verdict = "SUSPICIOUS_REVIEW_NEEDED"
            is_artificial = True
        else:
            overall_verdict = "APPEARS_AUTHENTIC"
            is_artificial = False

        # Check for any single critical gate
        critical_gates = [g for g in gates if g["score"] > 0.85 and g["weight"] > 0]
        if critical_gates:
            overall_verdict = "AI_GENERATED_OR_TAMPERED"
            is_artificial = True

        return {
            "success": True,
            "artificial": is_artificial,
            "artificial_score": round(final_score, 3),
            "human_score": round(1.0 - final_score, 3),
            "overall_verdict": overall_verdict,
            "gates": [
                {
                    "gate": g["gate"],
                    "name": g["name"],
                    "score": g["score"],
                    "verdict": g["verdict"],
                    "details": g["details"]
                }
                for g in gates
            ],
            "results": [
                {"label": "artificial", "score": round(final_score, 3)},
                {"label": "human", "score": round(1.0 - final_score, 3)}
            ]
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
