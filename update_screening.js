import fs from 'fs';

let content = fs.readFileSync('screening.js', 'utf8');

// 1. Imports
content = content.replace(
  'import { createHash, randomUUID } from "node:crypto";',
  'import { createHash, createHmac, randomUUID } from "node:crypto";'
);

// 2. Add maskIdNumber function
const maskIdNumberFunc = `
function maskIdNumber(idStr, docType) {
  if (!idStr) return "—";
  if (docType === "aadhaar" || docType === "pan" || docType === "voter_id" || docType === "dl") {
    if (idStr.length <= 4) return "•".repeat(idStr.length);
    return "•".repeat(idStr.length - 4) + idStr.slice(-4);
  }
  return maskValue(idStr, 4);
}
`;
content = content.replace('function createAuditDigest', maskIdNumberFunc + '\nfunction createAuditDigest');

// 3. Update createAuditDigest
const newCreateAuditDigest = `function createAuditDigest(name, documentNumber, verdict) {
  const timestamp = new Date().toISOString();
  let hash;
  if (process.env.HMAC_SECRET) {
    const payload = \`\${name}|\${documentNumber}|\${verdict}|\${timestamp}\`;
    hash = createHmac("sha256", process.env.HMAC_SECRET).update(payload).digest("hex");
  } else {
    const salt = randomUUID();
    const payload = \`\${name}|\${documentNumber}|\${verdict}|\${timestamp}|\${salt}\`;
    hash = createHash("sha256").update(payload).digest("hex");
  }
  
  return {
    hash,
    plaintextVerdict: verdict,
    timestamp
  };
}`;
content = content.replace(
  /function createAuditDigest.*?return \{\n    hash,\n    plaintextVerdict: verdict,\n    timestamp\n  \};\n}/s,
  newCreateAuditDigest
);

// 4. Update enrichWithBackendResults face confidence bands
const newFaceLogic = `
  // Process face verification results
  const faceVerif = input.faceVerification;
  if (faceVerif) {
    // Wider inconclusive bands for Aadhaar/PAN
    const docType = input.documentType || "passport";
    let isMatch = faceVerif.match;
    
    // Custom handling based on distance if we want wider bands.
    // DeepFace standard threshold is usually 0.4 for cosine, 0.6 for euclidean, etc.
    // For now we rely on faceVerif.match which is provided by the backend,
    // but we adjust the severity/status based on document type.
    
    if (faceVerif.success && isMatch === true) {
      result.analysisAxes.identityComparison = { status: "CLEAR", detail: \`Face matches document photo. Distance: \${faceVerif.distance.toFixed(2)}\` };
      result.checks.push({ id: "face.match", label: "Face verification", status: "PASS", severity: "info", evidence: "DeepFace matching successful." });
    } else if (faceVerif.success && isMatch === false) {
      const isLowQualityDoc = ["aadhaar", "pan"].includes(docType);
      const isBorderline = faceVerif.distance > 0.4 && faceVerif.distance < 0.65; // example borderline heuristic
      
      if (isLowQualityDoc && isBorderline) {
        result.analysisAxes.identityComparison = { status: "REVIEW", detail: \`Inconclusive face match due to document photo quality. Distance: \${faceVerif.distance.toFixed(2)}\` };
        // We do not add FACE_MISMATCH reason code, we treat it as inconclusive
        result.checks.push({ id: "face.match", label: "Face verification (Inconclusive)", status: "FAIL", severity: "review", evidence: "Face distance is borderline; given document type, this may be a photo quality artifact." });
      } else {
        result.analysisAxes.identityComparison = { status: "REVIEW", detail: \`Face mismatch. Distance: \${faceVerif.distance.toFixed(2)}\` };
        result.reasonCodes.push("FACE_MISMATCH");
        result.checks.push({ id: "face.match", label: "Face verification", status: "FAIL", severity: "review", evidence: "Document photo and live selfie do not match." });
      }
    }
  }
`;
content = content.replace(
  /\/\/ Process face verification results.*?return result;/s,
  newFaceLogic.trim() + '\n\n  return result;'
);


// 5. Replace analyzeScreening
const newAnalyzeScreening = `
export function analyzeScreening(input = {}) {
  const docType = input.documentType || "passport"; // Fallback to passport for older tests
  
  if (docType === "unknown") {
    const result = invalidMrzResult("Document type could not be identified.");
    return enrichWithBackendResults(result, input);
  }

  // --- NON-PASSPORT INDIAN IDs ---
  if (docType !== "passport") {
    const idExtract = input.idExtract || { is_valid: false, reason: "No extraction payload", id_number: "UNKNOWN" };
    const rawId = idExtract.id_number || "UNKNOWN";
    
    const isValid = idExtract.is_valid;
    const reasons = [];
    if (!isValid) reasons.push("VALIDATION_FAILED");

    const checks = [
      {
        id: "id_validation",
        label: \`\${docType.toUpperCase()} Format Validation\`,
        status: isValid ? "PASS" : "FAIL",
        severity: isValid ? "info" : "review",
        evidence: idExtract.reason
      }
    ];

    const triage = reasons.length ? "MANUAL_REVIEW" : "NO_HIGH_RISK_SIGNAL_DETECTED";

    // For these docs, the ID validation carries lower trust than MRZ, so we still flag it if it fails.
    // The true weight is in the image forensics and face match (added by enrichWithBackendResults).

    const result = {
      screeningId: randomUUID(),
      notice: TEST_DATA_NOTICE,
      triage,
      reasonCodes: reasons,
      analysisAxes: {
        captureQuality: { status: "NOT_ASSESSED", detail: "Quality checks not implemented for this type." },
        dataConsistency: {
          status: isValid ? "CLEAR" : "REVIEW",
          detail: isValid ? "Validation algorithm passed." : "Validation failed."
        },
        imageAnomaly: { status: "NOT_ASSESSED", detail: "" },
        identityComparison: { status: "UNAVAILABLE", detail: "" }
      },
      fields: [
        { id: "documentType", label: "Document Type", maskedValue: docType.toUpperCase(), source: "Classifier" },
        { id: "documentNumber", label: "ID Number", maskedValue: maskIdNumber(rawId, docType), source: "OCR Extraction" }
      ],
      checks,
      signals: [],
      auditDigest: createAuditDigest("UNKNOWN_NAME", rawId, triage),
      limitations: [
        "This result is triage assistance for a fictional fixture, not proof of authenticity.",
        "A trained human must make any real-world decision."
      ]
    };
    
    return enrichWithBackendResults(result, input);
  }

  // --- PASSPORT (Original MRZ Logic) ---
  let parsed;
  let mrzFailed = false;
  let mrzError = "";
  try {
    parsed = parseTd3Mrz(input.mrzLine1, input.mrzLine2);
  } catch (error) {
    mrzFailed = true;
    mrzError = error.message;
  }

  if (mrzFailed) {
    const result = invalidMrzResult(mrzError);
    return enrichWithBackendResults(result, input);
  }

  const scenario = getScenario(input.scenarioId);
  const visibleFields = input.visibleFields || scenario?.visibleFields || {};
  const dataChecks = [
    fieldAgreementCheck("fields.name", "Printed name agrees with MRZ", parsed.fields.name, visibleFields.name),
    fieldAgreementCheck("fields.document_number", "Printed document number agrees with MRZ", parsed.fields.documentNumber, visibleFields.documentNumber),
    fieldAgreementCheck("fields.birth_date", "Printed date of birth agrees with MRZ", parsed.fields.dateOfBirth, visibleFields.dateOfBirth),
    fieldAgreementCheck("fields.expiry_date", "Printed expiry date agrees with MRZ", parsed.fields.dateOfExpiry, visibleFields.dateOfExpiry),
    expiryCheck(parsed.fields.dateOfExpiry)
  ];
`;

content = content.replace(
  /export function analyzeScreening\(input = \{\}\) \{[\s\S]*?(?=\n  \/\/ ─── ICAO 9303 Worldwide Validation Rules ───)/,
  newAnalyzeScreening.trim() + '\n'
);

fs.writeFileSync('screening.js', content, 'utf8');
console.log('Update complete.');
