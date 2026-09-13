import re

verhoeff_d = (
    (0,1,2,3,4,5,6,7,8,9),
    (1,2,3,4,0,6,7,8,9,5),
    (2,3,4,0,1,7,8,9,5,6),
    (3,4,0,1,2,8,9,5,6,7),
    (4,0,1,2,3,9,5,6,7,8),
    (5,9,8,7,6,0,4,3,2,1),
    (6,5,9,8,7,1,0,4,3,2),
    (7,6,5,9,8,2,1,0,4,3),
    (8,7,6,5,9,3,2,1,0,4),
    (9,8,7,6,5,4,3,2,1,0)
)

verhoeff_p = (
    (0,1,2,3,4,5,6,7,8,9),
    (1,5,7,6,2,8,3,0,9,4),
    (5,8,0,3,7,9,6,1,4,2),
    (8,9,1,6,0,4,3,5,2,7),
    (9,4,5,3,1,2,6,8,7,0),
    (4,2,8,6,5,7,3,9,0,1),
    (2,7,9,3,8,0,6,4,1,5),
    (7,0,4,6,9,1,3,2,5,8)
)

def validate_verhoeff(num_str: str) -> bool:
    try:
        c = 0
        reversed_num = list(reversed([int(x) for x in num_str]))
        for i, n in enumerate(reversed_num):
            c = verhoeff_d[c][verhoeff_p[i % 8][n]]
        return c == 0
    except Exception:
        return False

def parse_indian_id(ocr_text: str, doc_type: str) -> dict:
    """
    Parses OCR text for Indian ID patterns and extracts relevant numbers.
    """
    # Normalize text by removing spaces and newlines for easier regex matching
    text_upper = ocr_text.upper()
    normalized = re.sub(r'\s+', '', text_upper)
    
    result = {
        "document_type": doc_type,
        "id_number": None,
        "is_valid": False,
        "reason": "Extraction failed",
        "pin_code": None
    }
    
    # Optional Address/PIN extraction (common on back of Indian IDs)
    pin_match = re.search(r'\b[1-9][0-9]{5}\b', ocr_text)
    if pin_match:
        result["pin_code"] = pin_match.group(0)
    
    if doc_type == "aadhaar":
        # Aadhaar: 12 digits, first digit 2-9
        # Sanity check: must contain Aadhaar-related keywords
        if "UNIQUE" not in text_upper and "AUTHORITY" not in text_upper and "GOVERNMENT" not in text_upper and "INDIA" not in text_upper and "आधार" not in text_upper:
            result["is_valid"] = False
            result["reason"] = "Document does not appear to be an Aadhaar card (missing keywords)"
            return result

        match = re.search(r'[2-9][0-9]{11}', normalized)
        if match:
            uid = match.group(0)
            result["id_number"] = uid
            if validate_verhoeff(uid):
                result["is_valid"] = True
                result["reason"] = "Verhoeff check passed"
            else:
                result["is_valid"] = False
                result["reason"] = "Verhoeff check failed"
                
    elif doc_type == "pan":
        # PAN: 5 letters, 4 digits, 1 letter
        match = re.search(r'[A-Z]{5}[0-9]{4}[A-Z]', normalized)
        if match:
            result["id_number"] = match.group(0)
            result["is_valid"] = True
            result["reason"] = "Format matches standard PAN structure"
            
    elif doc_type == "voter_id":
        # Voter ID (EPIC): 3 letters, 7 digits (though some are longer, this matches the standard block)
        if "ELECTION" not in text_upper and "COMMISSION" not in text_upper and "EPIC" not in text_upper and "ELECTOR" not in text_upper:
            result["is_valid"] = False
            result["reason"] = "Document does not appear to be a Voter ID (missing keywords)"
            return result
            
        match = re.search(r'[A-Z]{3}[0-9]{7}', normalized)
        if match:
            # Avoid matching Aadhaar VID by ensuring it doesn't start with VID
            if match.group(0).startswith("VID"):
                result["is_valid"] = False
                result["reason"] = "Matched Aadhaar VID instead of EPIC"
                return result
                
            result["id_number"] = match.group(0)
            result["is_valid"] = True
            result["reason"] = "Format matches standard EPIC structure"
            
    elif doc_type == "dl":
        # Driving Licence: 2 letters, 2-3 digits, 4 digits, 7 digits
        match = re.search(r'[A-Z]{2}[0-9]{2,3}[0-9]{4}[0-9]{7}', normalized)
        if match:
            result["id_number"] = match.group(0)
            result["is_valid"] = True
            result["reason"] = "Format matches standard Driving Licence structure"
            
    return result
