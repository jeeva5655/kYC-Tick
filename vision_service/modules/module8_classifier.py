def classify_document(ocr_text: str) -> str:
    """
    Classifies a document based on extracted OCR text.
    Returns one of: 'aadhaar', 'pan', 'voter_id', 'dl', 'passport', or 'unknown'.
    """
    text_upper = ocr_text.upper()
    
    # 1. Aadhaar
    if "UNIQUE IDENTIFICATION AUTHORITY" in text_upper or "आधार" in text_upper:
        return "aadhaar"
        
    # 2. PAN Card
    if "INCOME TAX DEPARTMENT" in text_upper:
        return "pan"
        
    # 3. Voter ID / EPIC
    if "ELECTION COMMISSION OF INDIA" in text_upper:
        return "voter_id"
        
    # 4. Driving Licence
    if "DRIVING LICENCE" in text_upper or "TRANSPORT DEPARTMENT" in text_upper:
        return "dl"
        
    # 5. Passport
    # If the MRZ pattern exists or "REPUBLIC OF INDIA" / "PASSPORT" is present.
    # Note: OCR often adds spaces, so we check for space-stripped versions too.
    text_no_spaces = text_upper.replace(" ", "")
    if "PASSPORT" in text_upper or "REPUBLIC OF INDIA" in text_upper or "P<" in text_no_spaces or "PKIND" in text_no_spaces:
        return "passport"
        
    return "unknown"
