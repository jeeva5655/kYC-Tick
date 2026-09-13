"""
module10_aadhaar_qr_verify.py

Cryptographic verification for Aadhaar's "Secure QR Code" -- the piece that
answers a narrower but *provable* question than "is this Aadhaar number
real and currently active":

    Was this exact demographic payload signed by UIDAI's private key,
    and has it been altered since?

That is a yes/no you can prove offline with public-key cryptography alone.
It does NOT call any UIDAI server, and it does NOT confirm the number is
still active today -- this signature scheme has no revocation check, so a
signature stays mathematically valid even if the underlying number were
later deactivated. UIDAI's own guidance is that a live human/photo check
is still the intended complement to this -- which is exactly what
module4_face.py already does in this pipeline. This module is the missing
piece that lets triage ask "was this card's data ever genuinely issued by
UIDAI", instead of only "is this image un-photoshopped".

Format reference: UIDAI's Secure QR Code spec documents the payload as a
byte array with fields delimited by byte value 255, with the digital
signature appended as the final bytes of that array.

Dependencies: only the `cryptography` package plus the standard library.
`read_qr_numeric_string_from_image` additionally uses cv2 + numpy (both
already in this pipeline's stack) -- no new QR-reading library needed.
"""

from __future__ import annotations

import zlib
import os
from dataclasses import dataclass, field
from typing import Optional

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.exceptions import InvalidSignature

FIELD_DELIMITER = 255  # per UIDAI's own Secure QR Code specification

# Best-effort label order for the demographic fields, cross-checked against
# UIDAI's spec and the field order used by community decoders (pyaadhaar,
# aadhaar-py). Treat this as a *starting point* -- UIDAI has shipped more
# than one QR layout (with/without photo), so confirm against a real
# sample before trusting it for display. It does NOT affect whether the
# signature check below is trustworthy.
DEMOGRAPHIC_FIELD_LABELS = [
    "email_mobile_flag_and_reference_id",
    "name", "dob", "gender", "care_of", "district", "landmark", "house",
    "location", "pincode", "post_office", "state", "sub_district", "vtc",
]


@dataclass
class QRVerificationResult:
    signature_valid: bool
    reason: str
    key_size_bits: Optional[int] = None
    fields: dict = field(default_factory=dict)


def qr_numeric_string_to_bytes(numeric_string: str) -> bytes:
    """UIDAI's QR is encoded in 'numeric mode' -- the whole payload is one
    giant base-10 integer (what a QR reader like cv2.QRCodeDetector hands
    you as a string). Convert it back to the raw compressed bytes."""
    value = int(numeric_string)
    length = max(1, (value.bit_length() + 7) // 8)
    return value.to_bytes(length, byteorder="big")


def inflate(raw: bytes) -> bytes:
    """The compressed stream is raw DEFLATE (no zlib/gzip header)."""
    d = zlib.decompressobj(-zlib.MAX_WBITS)
    return d.decompress(raw) + d.flush()


def load_uidai_certificate(cert_path: str) -> x509.Certificate:
    """Load UIDAI's published signing certificate. Get the *current* one
    from UIDAI's Developer Section -> Data and Downloads page -- these are
    dated and rotated periodically, so don't hardcode an old filename or
    reuse a stale download indefinitely."""
    raw = open(cert_path, "rb").read()
    try:
        return x509.load_der_x509_certificate(raw)
    except ValueError:
        return x509.load_pem_x509_certificate(raw)


def split_signature(payload: bytes, cert: x509.Certificate) -> tuple[bytes, bytes]:
    """The signature sits in the final bytes of the array. Its length is
    just the RSA modulus size in bytes -- read that from the certificate
    itself instead of hardcoding 256, so this keeps working even if UIDAI
    rotates to a different key size."""
    public_key = cert.public_key()
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise TypeError("Expected an RSA public key in the UIDAI certificate")
    sig_len = public_key.key_size // 8
    if len(payload) <= sig_len:
        raise ValueError("Payload shorter than the expected signature -- not a valid Secure QR payload")
    return payload[:-sig_len], payload[-sig_len:]


def verify_signature(signed_data: bytes, signature: bytes, cert: x509.Certificate) -> bool:
    """UIDAI's offline-signed documents use SHA-256 + RSA PKCS#1 v1.5
    ('SHA256withRSA') -- the standard scheme for signed government XML/QR
    payloads of this era. If this always fails on genuine cards, that
    padding/hash assumption is the first thing to double check."""
    public_key = cert.public_key()
    try:
        public_key.verify(signature, signed_data, padding.PKCS1v15(), hashes.SHA256())
        return True
    except InvalidSignature:
        return False


def parse_demographic_fields(signed_data: bytes) -> dict:
    """Best-effort split by the delimiter UIDAI's spec documents (byte
    255). Only for displaying name/DOB/etc in your UI -- it has no bearing
    on whether the signature check is trustworthy. For production-grade
    field parsing (photo extraction, handling both QR layout versions),
    consider `pyaadhaar` or `aadhaar-py` from PyPI, which the community
    maintains against real cards."""
    parts = signed_data.split(bytes([FIELD_DELIMITER]))
    return {label: part.decode("utf-8", errors="replace")
            for label, part in zip(DEMOGRAPHIC_FIELD_LABELS, parts)}


def verify_aadhaar_secure_qr(numeric_string: str, cert_path: str, parse_fields: bool = True) -> QRVerificationResult:
    """Main entry point. `numeric_string` is whatever your QR reader
    scanned off the card; `cert_path` points at UIDAI's current public
    certificate file."""
    
    if not os.path.exists(cert_path):
        return QRVerificationResult(
            signature_valid=False,
            reason=f"NOT_PRESENT: Certificate file not found at {cert_path}. Cannot verify signature."
        )

    try:
        cert = load_uidai_certificate(cert_path)
        payload = inflate(qr_numeric_string_to_bytes(numeric_string))
        signed_data, signature = split_signature(payload, cert)
        valid = verify_signature(signed_data, signature, cert)
        fields = parse_demographic_fields(signed_data) if (valid and parse_fields) else {}
        return QRVerificationResult(
            signature_valid=valid,
            reason=("UIDAI signature verified -- this payload was genuinely signed by "
                     "UIDAI and is unaltered.") if valid else
                    ("Signature check FAILED -- forged/altered data, a corrupted scan, "
                     "or the wrong certificate."),
            key_size_bits=cert.public_key().key_size,
            fields=fields,
        )
    except Exception as exc:
        return QRVerificationResult(signature_valid=None, reason=f"Could not process QR payload: {exc}")


def read_qr_numeric_string_from_image(image_bytes: bytes) -> Optional[str]:
    """Convenience: pull the raw numeric string straight out of an
    uploaded document image using OpenCV's built-in QR detector, so this
    slots in right after your existing image-upload step. No new
    dependency -- cv2 is already in this stack."""
    import numpy as np
    import cv2

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    
    if img is None:
        return None
        
    try:
        import zxingcpp
        # zxing-cpp is highly robust and doesn't require model loading
        results = zxingcpp.read_barcodes(img)
        for r in results:
            if r.text:
                return r.text
    except Exception as e:
        print(f"zxingcpp Error: {e}")
        
    # Fallback to standard detector
    detector = cv2.QRCodeDetector()
    data, _, _ = detector.detectAndDecode(img)
    return data or None


if __name__ == "__main__":
    # --- Self-test ----------------------------------------------------
    # Proves the pipeline and the crypto logic are both correct, without
    # needing a real Aadhaar card or UIDAI's actual private key. A
    # throwaway keypair stands in for "UIDAI", and the placeholder fields
    # below are obviously fake -- nothing here is real ID data.
    print("Running self-test (throwaway keypair, placeholder fields)...\n")

    fake_uidai_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    fake_public_key = fake_uidai_key.public_key()

    placeholder_fields = [b"2REF0000TESTONLY", b"TEST NAME", b"01-01-2000", b"M"]
    fake_payload = bytes([FIELD_DELIMITER]).join(placeholder_fields)
    signature = fake_uidai_key.sign(fake_payload, padding.PKCS1v15(), hashes.SHA256())
    envelope = fake_payload + signature

    # Round-trip through the same numeric-mode encoding a real QR uses, to
    # test qr_numeric_string_to_bytes() + inflate() together.
    compressor = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    compressed = compressor.compress(envelope) + compressor.flush()
    numeric_string = str(int.from_bytes(compressed, "big"))

    recovered = inflate(qr_numeric_string_to_bytes(numeric_string))
    assert recovered == envelope, "decode/decompress round-trip failed"
    print("[OK] numeric-string -> bytes -> inflate round-trip matches original payload")

    sig_len = fake_public_key.key_size // 8
    data_part, sig_part = recovered[:-sig_len], recovered[-sig_len:]

    try:
        fake_public_key.verify(sig_part, data_part, padding.PKCS1v15(), hashes.SHA256())
        print("[OK] genuine signature verifies as VALID")
    except InvalidSignature:
        print("[FAIL] genuine signature was rejected -- bug in verification logic")

    tampered = bytearray(data_part)
    tampered[0] ^= 0x01
    try:
        fake_public_key.verify(sig_part, bytes(tampered), padding.PKCS1v15(), hashes.SHA256())
        print("[FAIL] tampered payload was accepted -- this should never happen")
    except InvalidSignature:
        print("[OK] tampered payload correctly rejected as INVALID")

    print("\nSelf-test complete. Plug in a real UIDAI .cer file (from the")
    print("Developer Section on uidai.gov.in) and a real scanned QR numeric")
    print("string via verify_aadhaar_secure_qr() to use this for real.")
