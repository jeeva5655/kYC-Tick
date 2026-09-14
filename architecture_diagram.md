# Identity Document Detection - Architecture & Data Flow

This document details the complete end-to-end architecture of the **Document Integrity Demo**, which supports Global Passports as well as Indian domestic IDs (Aadhaar, PAN, Voter ID, Driving Licence). The system is strictly divided between a cloud-hosted Vercel frontend/gateway and a local Python-based machine learning inference engine exposed via Ngrok.

## 1. High-Level System Architecture

```mermaid
graph TD
    %% Cloud Frontend Layer
    subgraph Vercel Cloud [Vercel Cloud Platform]
        UI[PWA Frontend app.js<br/>Dynamic Ngrok URL Config]
        API_Upload[Serverless Function<br/>api/analyze.js]
        Triage[screening.js Triage Engine]
        Privacy[Privacy Masking]
        Digest[HMAC Audit Digest]
    end

    %% Network Tunnel
    Tunnel((Ngrok Secure Tunnel))

    %% Local ML Vision Layer
    subgraph Local Workstation [Local Python Vision Service - Port 8001]
        Orchestrator[module7_orchestrator.py - POST /api/v1/analyze-all]
        
        Classifier[module8_classifier.py]
        OCR[module1_ocr.py - MRZ Extract]
        IndianIDs[module9_indian_id_patterns.py]
        
        Tamper[module3_tampering.py]
        Face[module4_face.py]
        FullOCR[module5_full_ocr.py]
        AIDetect[module6_ai_detection.py]
        QRVerify[module10_aadhaar_qr_verify.py - zxing-cpp & RSA]
    end

    %% Flow Connections
    UI -->|1. FormData + Ngrok URL| API_Upload
    API_Upload -->|2. Forward Images| Tunnel
    Tunnel -->|3. Route Request| Orchestrator
    
    Orchestrator -->|4a. dispatch| FullOCR
    Orchestrator -->|3b. dispatch| Tamper
    Orchestrator -->|3c. dispatch| Face
    Orchestrator -->|3d. dispatch| AIDetect
    Orchestrator -->|3e. dispatch| QRVerify
    
    FullOCR -->|5. Merged Front+Back OCR Text| Classifier
    Classifier -->|6a. If Passport| OCR
    Classifier -->|6b. If Domestic ID| IndianIDs
    
    OCR -.-> Orchestrator
    IndianIDs -.-> Orchestrator
    Tamper -.-> Orchestrator
    Face -.-> Orchestrator
    AIDetect -.-> Orchestrator
    QRVerify -.-> Orchestrator
    
    Orchestrator -->|7. Unified JSON Results| Tunnel
    Tunnel -->|8. Return to Cloud| Triage
    Triage -->|9. Triage Engine & Rules| Privacy
    Privacy -->|10. Apply HMAC & Masking| Digest
    Digest -->|11. Triage Output + Digest| UI
```

---

## 2. Detailed Data Flow Sequence

The following sequence diagram outlines the step-by-step data exchange during a screening event, demonstrating the concurrent execution model in Python.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App as Browser (app.js)
    participant Vercel as Vercel Serverless (api/analyze.js)
    participant Ngrok as Ngrok Tunnel
    participant Python as Local Orchestrator (module7)
    participant ML as Local ML Models (ThreadPool)
    participant QR as Cryptography (module10)
    
    User->>App: Drops Doc Front, Doc Back, Selfie & Sets Ngrok URL
    User->>App: Clicks "Run AI Screening"
    
    %% Request to Vercel
    App->>Vercel: POST /api/analyze<br/>(FormData + dynamic backend URL)
    Vercel->>Ngrok: POST https://[id].ngrok.app/api/v1/analyze-all
    Ngrok->>Python: Route to localhost:8001
    
    %% Python internal dispatch - Phase 1
    activate Python
    note over Python, ML: asyncio.create_task() across ThreadPoolExecutor
    Python->>ML: Task A: Full OCR on Front (PaddleOCR)
    Python->>ML: Task B: Full OCR on Back (PaddleOCR)
    Python->>ML: Task C: Tampering (ManTraNet filters)
    Python->>ML: Task D: DeepFace (document vs live)
    Python->>ML: Task E: AI Detection (5-Gate Engine)
    Python->>QR: Task F: QR Read (zxing-cpp) & RSA Signature Check
    
    %% Classification Phase
    ML-->>Python: Return OCR Text (Merged Front + Back)
    Python->>Python: classify_document(ocr_text)
    
    %% Phase 2 extraction
    alt is passport
        Python->>ML: Task G: PassportEye MRZ Extraction
    else is indian_id
        Python->>Python: parse_indian_id(ocr_text, doc_type) + Verhoeff
    end
    
    ML-->>Python: Return extracted JSON/Signals
    QR-->>Python: Return Signature Pass/Fail
    deactivate Python
    
    %% Python to Node
    Python-->>Ngrok: Return merged JSON (docType, IDs, PIN, ML signals, QR)
    Ngrok-->>Vercel: Return payload to Cloud
    
    %% Vercel Triage
    activate Vercel
    note over Vercel: screening.js Triage Rules
    Vercel->>Vercel: Weigh rules based on docType
    Vercel->>Vercel: Calculate Score -> Decide "MANUAL_REVIEW" vs "REAL"
    
    %% Privacy & Crypto
    Vercel->>Vercel: Privacy: Mask raw IDs (leave last 4 chars)
    Vercel->>Vercel: Crypto: HMAC-SHA256(RawID + Verdict + Timestamp)
    deactivate Vercel
    
    %% Vercel to App
    Vercel-->>App: Return { triageResult, axes, details, auditDigest }
    
    App->>User: Render Intelligence Report UI
```

---

## 3. The 5-Gate AI Detection Architecture

The `module6_ai_detection.py` subsystem specifically runs a multi-gate filter cascade on the document image to catch varying types of forgery and synthetically generated identities. This runs consistently regardless of the document type.

```mermaid
graph TD
    Image[Raw Bytes] --> Preprocess[Decode & Resize]
    
    Preprocess --> Gate1[Gate 1: EXIF Metadata Check]
    Preprocess --> Gate2[Gate 2: Screen/Moire Detection]
    Preprocess --> Gate3[Gate 3: Noise Analysis]
    Preprocess --> Gate4[Gate 4: Frequency/Edges]
    Preprocess --> Gate5[Gate 5: Synthetic Identity FFT <br/>Threshold: 250.0]
    
    Gate1 --> Agg[Aggregate Results]
    Gate2 --> Agg
    Gate3 --> Agg
    Gate4 --> Agg
    Gate5 -.-> |Weight 0.0 Info Only| Agg
    
    Agg --> Score[Calculate Total AI Risk Score]
    Score --> Output[{"is_ai_generated": bool, "confidence": float, "details": [...]}]
```

## 4. Privacy & Compliance Boundary

The architecture is explicitly designed to meet DPDP / GDPR / Aadhaar Act constraints regarding biometric handling:

1. **Memory-Only Processing**: Images are buffered in RAM during the Vercel `fetch` and locally via `FastAPI`. No images are ever saved to disk in the cloud or locally.
2. **Deterministic Triage Isolation**: The Vercel cloud environment never runs heavy ML processing; it strictly evaluates discrete output signals (e.g., `confidence: 0.82`, `signature_valid: True`) over a secure Ngrok tunnel.
3. **Data Minimization (Masking)**: Aadhaar, PAN, Voter ID, and Driving Licence numbers are immediately masked by the Vercel Serverless Function (e.g. `••••••••1234`). The raw ID is NEVER transmitted back to the browser or stored in plaintext.
4. **Cryptographic Auditing (HMAC)**: Instead of logging PII for auditing, the system generates a **deterministic HMAC-SHA256 digest** using a secure hash. This allows investigators to correlate repeat usages of a forged ID across multiple transactions without ever exposing the raw plaintext ID to an outside observer.
