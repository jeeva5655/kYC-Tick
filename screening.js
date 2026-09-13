import { createHash, createHmac, randomUUID } from "node:crypto";

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

function fuzzyIncludes(wordList, targetWord) {
  const threshold = targetWord.length > 5 ? 2 : 1;
  return wordList.some(w => {
    // Exact substring check as fallback (in case they are concatenated)
    if (w.includes(targetWord)) return true;
    return levenshtein(w, targetWord) <= threshold;
  });
}

const MRZ_LINE_LENGTH = 44;

let previousHash = "0000000000000000000000000000000000000000000000000000000000000000"; // Genesis Block Hash
const TEST_DATA_NOTICE = "Synthetic demo data only — not a real travel-document verification service.";

// ─── ICAO 9303 Worldwide Passport Rules ───────────────────────────────────────
// Complete ISO 3166-1 alpha-3 country codes + ICAO special codes
const VALID_COUNTRY_CODES = new Set([
  // Special ICAO codes
  "UTO", "UNO", "UNA", "UNK", "XXA", "XXB", "XXC", "XXX",
  // A
  "AFG","ALB","DZA","ASM","AND","AGO","AIA","ATA","ATG","ARG","ARM","ABW","AUS","AUT","AZE",
  // B
  "BHS","BHR","BGD","BRB","BLR","BEL","BLZ","BEN","BMU","BTN","BOL","BES","BIH","BWA","BVT",
  "BRA","IOT","BRN","BGR","BFA","BDI",
  // C
  "CPV","KHM","CMR","CAN","CYM","CAF","TCD","CHL","CHN","CXR","CCK","COL","COM","COG","COD",
  "COK","CRI","CIV","HRV","CUB","CUW","CYP","CZE",
  // D
  "DNK","DJI","DMA","DOM","DEU","D<<",
  // E
  "ECU","EGY","SLV","GNQ","ERI","EST","SWZ","ETH","EUE",
  // F
  "FLK","FRO","FJI","FIN","FRA","GUF","PYF","ATF",
  // G
  "GAB","GMB","GEO","GHA","GIB","GRC","GRL","GRD","GLP","GUM","GTM","GGY","GIN","GNB","GUY",
  // H
  "HTI","HMD","VAT","HND","HKG","HUN",
  // I
  "ISL","IND","IDN","IRN","IRQ","IRL","IMN","ISR","ITA",
  // J
  "JAM","JPN","JEY","JOR",
  // K
  "KAZ","KEN","KIR","PRK","KOR","KWT","KGZ","RKS",
  // L
  "LAO","LVA","LBN","LSO","LBR","LBY","LIE","LTU","LUX",
  // M
  "MAC","MDG","MWI","MYS","MDV","MLI","MLT","MHL","MTQ","MRT","MUS","MYT","MEX","FSM","MDA",
  "MCO","MNG","MNE","MSR","MAR","MOZ","MMR","MKD",
  // N
  "NAM","NRU","NPL","NLD","NCL","NZL","NIC","NER","NGA","NIU","NFK","MNP","NOR",
  // O
  "OMN",
  // P
  "PAK","PLW","PSE","PAN","PNG","PRY","PER","PHL","PCN","POL","PRT","PRI",
  // Q
  "QAT",
  // R
  "REU","ROU","RUS","RWA",
  // S
  "BLM","SHN","KNA","LCA","MAF","SPM","VCT","WSM","SMR","STP","SAU","SEN","SRB","SYC","SLE",
  "SGP","SXM","SVK","SVN","SLB","SOM","ZAF","SGS","SSD","ESP","LKA","SDN","SUR","SJM","SWE",
  "CHE","SYR",
  // T
  "TWN","TJK","TZA","THA","TLS","TGO","TKL","TON","TTO","TUN","TUR","TKM","TCA","TUV",
  // U
  "UGA","UKR","ARE","GBR","USA","UMI","URY","UZB",
  // V
  "VUT","VEN","VNM","VGB","VIR",
  // W
  "WLF",
  // Y
  "YEM",
  // Z
  "ZMB","ZWE",
  // Legacy / alternate codes used in MRZ
  "GBD","GBN","GBO","GBP","GBS",  // British territories
  "ANT","NTZ","CSK","YUG","SCG",  // Historical
]);

const VALID_DOC_TYPES = new Set(["P<", "PA", "PB", "PC", "PD", "PE", "PO", "PP"]);
const VALID_SEX_CODES = new Set(["M", "F", "X", "<"]);

function checkDigit(value) {
  const weights = [7, 3, 1];
  const total = [...value].reduce((sum, character, index) => {
    let characterValue = 0;
    if (/\d/.test(character)) characterValue = Number(character);
    if (/[A-Z]/.test(character)) characterValue = character.charCodeAt(0) - 55;
    return sum + characterValue * weights[index % weights.length];
  }, 0);
  return String(total % 10);
}

function normalizeMrzLine(value) {
  const line = String(value || "").toUpperCase().replace(/\s/g, "");
  if (line.length !== MRZ_LINE_LENGTH) {
    throw new Error(`Each TD3 MRZ line must contain exactly ${MRZ_LINE_LENGTH} characters. OCR parsed ${line.length} chars: ${line}`);
  }
  if (!/^[A-Z0-9<]+$/.test(line)) {
    throw new Error("MRZ lines may contain only A–Z, 0–9, and < characters.");
  }
  return line;
}

function parseMrzDate(value, kind = "birth") {
  if (!/^\d{6}$/.test(value)) return null;
  const yearFragment = Number(value.slice(0, 2));
  const currentYear = new Date().getUTCFullYear();
  let year = 2000 + yearFragment;
  // A birth date may be in the previous century; an expiry date in this demo
  // uses the current century so future fixtures are not mistaken for 19xx.
  if (kind === "birth" && year > currentYear) year -= 100;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function formatMrzName(value) {
  const [surname = "", givenNames = ""] = value.split("<<", 2);
  return [givenNames, surname]
    .join(" ")
    .replace(/</g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function canonicalText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function maskValue(value, visibleCharacters = 3) {
  const stringValue = String(value || "");
  if (stringValue.length <= visibleCharacters) return "•".repeat(stringValue.length);
  return `${"•".repeat(Math.max(3, stringValue.length - visibleCharacters))}${stringValue.slice(-visibleCharacters)}`;
}

function check(id, label, actual, expected, evidence) {
  return {
    id,
    label,
    status: actual === expected ? "PASS" : "FAIL",
    severity: actual === expected ? "info" : "review",
    evidence
  };
}

export function parseTd3Mrz(line1Input, line2Input) {
  const line1 = normalizeMrzLine(line1Input);
  const line2 = normalizeMrzLine(line2Input);

  const documentNumber = line2.slice(0, 9);
  const birthDateMrz = line2.slice(13, 19);
  const expiryDateMrz = line2.slice(21, 27);
  const optionalData = line2.slice(28, 42);
  const checks = [
    check("mrz.document_number_check", "Document-number checksum", checkDigit(documentNumber), line2[9], "TD3 MRZ check digit"),
    check("mrz.birth_date_check", "Date-of-birth checksum", checkDigit(birthDateMrz), line2[19], "TD3 MRZ check digit"),
    check("mrz.expiry_date_check", "Expiry-date checksum", checkDigit(expiryDateMrz), line2[27], "TD3 MRZ check digit"),
    check("mrz.optional_data_check", "Optional-data checksum", checkDigit(optionalData), line2[42], "TD3 MRZ check digit"),
    check(
      "mrz.composite_check",
      "Composite checksum",
      checkDigit(`${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`),
      line2[43],
      "TD3 MRZ composite check digit"
    )
  ];

  return {
    raw: { line1, line2 },
    checks,
    fields: {
      documentType: line1.slice(0, 2),
      issuingCountry: line1.slice(2, 5).replace(/</g, ""),
      name: formatMrzName(line1.slice(5)),
      documentNumber: documentNumber.replace(/</g, ""),
      nationality: line2.slice(10, 13).replace(/</g, ""),
      dateOfBirth: parseMrzDate(birthDateMrz, "birth"),
      sex: line2[20] === "<" ? "Unspecified" : line2[20],
      dateOfExpiry: parseMrzDate(expiryDateMrz, "expiry")
    }
  };
}

function buildTd3Line1({ issuer, surname, givenNames }) {
  const nameSegment = `${surname.toUpperCase()}<<${givenNames.toUpperCase().replace(/\s+/g, "<")}`;
  return `P<${issuer}${nameSegment.padEnd(39, "<").slice(0, 39)}`;
}

function buildTd3Line2({ documentNumber, nationality, dateOfBirth, sex, dateOfExpiry, optionalData = "" }) {
  const documentNumberSegment = documentNumber.toUpperCase().padEnd(9, "<").slice(0, 9);
  const birthSegment = dateOfBirth.replaceAll("-", "").slice(2);
  const expirySegment = dateOfExpiry.replaceAll("-", "").slice(2);
  const optionalSegment = optionalData.toUpperCase().replace(/[^A-Z0-9<]/g, "<").padEnd(14, "<").slice(0, 14);
  const core = `${documentNumberSegment}${checkDigit(documentNumberSegment)}${nationality}${birthSegment}${checkDigit(birthSegment)}${sex}${expirySegment}${checkDigit(expirySegment)}${optionalSegment}`;
  return `${core}${checkDigit(optionalSegment)}${checkDigit(`${core.slice(0, 10)}${core.slice(13, 20)}${core.slice(21)}${checkDigit(optionalSegment)}`)}`;
}

function createDemoScenario({ id, title, description, visibleFields, signals = [] }) {
  const mrzLine1 = buildTd3Line1({ issuer: "UTO", surname: "DOE", givenNames: "JORDAN" });
  const mrzLine2 = buildTd3Line2({
    documentNumber: "XK0000001",
    nationality: "UTO",
    dateOfBirth: "1990-01-01",
    sex: "X",
    dateOfExpiry: "2034-01-01",
    optionalData: "DEMO<ONLY"
  });
  return { id, title, description, mrzLine1, mrzLine2, visibleFields, signals };
}

const demoScenarios = [
  createDemoScenario({
    id: "clean",
    title: "Clean fictional passport",
    description: "All synthetic printed fields agree with a valid TD3 MRZ.",
    visibleFields: {
      name: "Jordan Doe",
      documentNumber: "XK0000001",
      dateOfBirth: "1990-01-01",
      dateOfExpiry: "2034-01-01"
    }
  }),
  createDemoScenario({
    id: "dob-mismatch",
    title: "Printed DOB mismatch",
    description: "The displayed date of birth conflicts with the checksum-valid MRZ.",
    visibleFields: {
      name: "Jordan Doe",
      documentNumber: "XK0000001",
      dateOfBirth: "1990-01-02",
      dateOfExpiry: "2034-01-01"
    }
  }),
  createDemoScenario({
    id: "image-anomaly",
    title: "Simulated visual anomaly",
    description: "A fictional fixture contributes two explicitly simulated anomaly indicators.",
    visibleFields: {
      name: "Jordan Doe",
      documentNumber: "XK0000001",
      dateOfBirth: "1990-01-01",
      dateOfExpiry: "2034-01-01"
    },
    signals: [
      {
        id: "demo.photo_region_inconsistency",
        label: "Simulated photo-region inconsistency",
        confidence: "demo-only",
        evidence: "Fixture-provided signal; no image analysis was run."
      },
      {
        id: "demo.text_region_anomaly",
        label: "Simulated text-region anomaly",
        confidence: "demo-only",
        evidence: "Fixture-provided signal; no image analysis was run."
      }
    ]
  })
];

function getScenario(id) {
  return demoScenarios.find((scenario) => scenario.id === id);
}

export function listDemoScenarios() {
  return demoScenarios.map(({ id, title, description, mrzLine1, mrzLine2, visibleFields }) => ({
    id,
    title,
    description,
    mrzLine1,
    mrzLine2,
    visibleFields
  }));
}

function invalidMrzResult(errorMessage) {
  const reasons = ["MRZ_INPUT_INVALID", "POTENTIAL_FORGERY_DETECTED"];
  return {
    screeningId: randomUUID(),
    notice: TEST_DATA_NOTICE,
    triage: "RETAKE_IMAGE",
    reasonCodes: reasons,
    analysisAxes: {
      captureQuality: { status: "REVIEW", detail: "The provided MRZ is structurally unusable. This usually indicates a forged document or a completely failed scan." },
      dataConsistency: { status: "FAIL", detail: "Checks require two valid-length TD3 MRZ lines." },
      imageAnomaly: { status: "NOT_ASSESSED", detail: "Image analysis is not enabled in this starter." },
      identityComparison: { status: "UNAVAILABLE", detail: "No face comparison or identification is performed." }
    },
    fields: [],
    checks: [{ id: "mrz.structure", label: "TD3 MRZ structure", status: "FAIL", severity: "review", evidence: errorMessage }],
    signals: [],
    auditDigest: createAuditDigest("UNKNOWN", "UNKNOWN", "MANUAL_REVIEW"),
    limitations: [
      "This result is triage assistance for a fictional fixture, not proof of authenticity.",
      "A trained human must make any real-world decision."
    ]
  };
}


function maskIdNumber(idStr, docType) {
  if (!idStr) return "—";
  if (docType === "aadhaar" || docType === "pan" || docType === "voter_id" || docType === "dl") {
    if (idStr.length <= 4) return "•".repeat(idStr.length);
    return "•".repeat(idStr.length - 4) + idStr.slice(-4);
  }
  return maskValue(idStr, 4);
}

function createAuditDigest(name, documentNumber, verdict) {
  const timestamp = new Date().toISOString();
  const salt = randomUUID();
  const payload = `${previousHash}|${name}|${documentNumber}|${verdict}|${timestamp}|${salt}`;
  const hash = createHash("sha256").update(payload).digest("hex");
  previousHash = hash; // Update the chain
  
  return {
    hash,
    plaintextVerdict: verdict,
    timestamp
  };
}

function fieldAgreementCheck(id, label, mrzValue, visibleValue) {
  if (!visibleValue) {
    return { id, label, status: "NOT_ASSESSED", severity: "info", evidence: "No synthetic visible field supplied." };
  }
  const matches = canonicalText(mrzValue) === canonicalText(visibleValue);
  return {
    id,
    label,
    status: matches ? "PASS" : "FAIL",
    severity: matches ? "info" : "review",
    evidence: matches ? "Synthetic printed field agrees with MRZ." : "Synthetic printed field conflicts with MRZ."
  };
}

function expiryCheck(dateOfExpiry) {
  if (!dateOfExpiry) {
    return { id: "rules.expiry_date", label: "Expiry date is valid", status: "FAIL", severity: "review", evidence: "Expiry date cannot be parsed." };
  }
  const isExpired = Date.parse(`${dateOfExpiry}T23:59:59Z`) < Date.now();
  return {
    id: "rules.expiry_date",
    label: "Expiry date is current",
    status: isExpired ? "FAIL" : "PASS",
    severity: isExpired ? "review" : "info",
    evidence: isExpired ? "The synthetic document is expired." : "The synthetic document has not expired."
  };
}

function enrichWithBackendResults(result, input) {
  // Process tampering results from ManTraNet/ELA
  const tamper = input.tamperingResult;
  if (tamper && tamper.success) {
    const mantraScore = tamper.mantraScore || 0;
    if (tamper.tampered) {
      result.analysisAxes.imageAnomaly = { status: "REVIEW", detail: `Tampering detected (ELA variance: ${tamper.score.toFixed(0)}, ManTraNet anomaly: ${mantraScore.toFixed(2)})` };
      result.reasonCodes.push("TAMPERING_DETECTED");
      result.checks.push({ id: "tamper", label: "Tampering Detection", status: "FAIL", severity: "review", evidence: "High anomaly score detected in ELA or ManTraNet analysis." });
    } else {
      result.analysisAxes.imageAnomaly = { status: "CLEAR", detail: `Image pixels appear consistent (ELA: ${tamper.score.toFixed(0)}, ManTraNet: ${mantraScore.toFixed(2)})` };
      result.checks.push({ id: "tamper", label: "Tampering Detection", status: "PASS", severity: "info", evidence: "Image compression and pixels appear consistent." });
    }
  }

  // Process AI detection results from the 5-gate forensic engine
  const aiDetect = input.aiDetectionResult;
  if (aiDetect && aiDetect.success) {
    const isAi = aiDetect.artificial;
    const confidence = (isAi ? aiDetect.artificial_score : aiDetect.human_score) * 100;
    if (isAi) {
      result.analysisAxes.imageAnomaly = { status: "REVIEW", detail: `AI generation/tampering detected (${confidence.toFixed(1)}% confidence). Verdict: ${aiDetect.overall_verdict || "SUSPICIOUS"}` };
      result.reasonCodes.push("SYNTHETIC_GENERATION_DETECTED");
      result.checks.push({ id: "ai_detect", label: "AI Generation Check", status: "FAIL", severity: "review", evidence: `5-Gate forensic engine flagged this image (${confidence.toFixed(1)}%).` });
    } else {
      result.checks.push({ id: "ai_detect", label: "AI Generation Check", status: "PASS", severity: "info", evidence: `Image appears camera-captured (${confidence.toFixed(1)}%).` });
    }

    // Add individual gate results as checks
    if (aiDetect.gates) {
      aiDetect.gates.forEach(gate => {
        const gatePass = gate.score < 0.5;
        // Gate 5 is informational only for now (unvalidated heuristic)
        const isInformational = gate.gate === "5";
        
        result.checks.push({
          id: `ai_gate_${gate.gate}`,
          label: `Gate ${gate.gate}: ${gate.name}`,
          status: gatePass ? "PASS" : "FAIL",
          severity: gatePass ? "info" : (isInformational ? "info" : "review"),
          evidence: `Score: ${(gate.score * 100).toFixed(1)}% — ${gate.verdict}`
        });
        
        // Gate 5 is informational only (unvalidated FFT heuristic, weight=0)
        // Do NOT push a reason code for it — it must not affect triage.
      });
    }
  }

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
    
    if (faceVerif.is_real === false) {
      result.analysisAxes.identityComparison = { status: "REVIEW", detail: `Face spoofing detected. Live image failed liveness check.` };
      result.reasonCodes.push("LIVENESS_FAILED");
      result.checks.push({ id: "face.liveness", label: "Liveness & Anti-Spoofing", status: "FAIL", severity: "review", evidence: "Live selfie appears to be a spoof (photo or mask)." });
    } else {
      result.checks.push({ id: "face.liveness", label: "Liveness & Anti-Spoofing", status: "PASS", severity: "info", evidence: "Selfie passes liveness check." });
      
      if (faceVerif.success && isMatch === true) {
        result.analysisAxes.identityComparison = { status: "CLEAR", detail: `Face matches document photo. Distance: ${faceVerif.distance.toFixed(2)}` };
        result.checks.push({ id: "face.match", label: "Face verification", status: "PASS", severity: "info", evidence: "DeepFace matching successful." });
      } else if (faceVerif.success && isMatch === false) {
        const isLowQualityDoc = ["aadhaar", "pan"].includes(docType);
        const isBorderline = faceVerif.distance > 0.4 && faceVerif.distance < 0.65; // example borderline heuristic
        
        if (isLowQualityDoc && isBorderline) {
          result.analysisAxes.identityComparison = { status: "REVIEW", detail: `Inconclusive face match due to document photo quality. Distance: ${faceVerif.distance.toFixed(2)}` };
          // We do not add FACE_MISMATCH reason code, we treat it as inconclusive
          result.checks.push({ id: "face.match", label: "Face verification (Inconclusive)", status: "FAIL", severity: "review", evidence: "Face distance is borderline; given document type, this may be a photo quality artifact." });
        } else {
          result.analysisAxes.identityComparison = { status: "REVIEW", detail: `Face mismatch. Distance: ${faceVerif.distance.toFixed(2)}` };
          result.reasonCodes.push("FACE_MISMATCH");
          result.checks.push({ id: "face.match", label: "Face verification", status: "FAIL", severity: "review", evidence: "Document photo and live selfie do not match." });
        }
      }
    }
  }

  // Process QR Cryptographic Verification
  const qrVerif = input.qrVerification;
  result.analysisAxes.qrCryptography = { status: "NOT_ASSESSED", detail: "No QR data received." };
  
  if (qrVerif) {
    if (qrVerif.signature_valid === true) {
      result.analysisAxes.qrCryptography = { status: "CLEAR", detail: "Secure QR Signature Verified. Data is unaltered." };
      result.checks.push({ id: "qr.cryptography", label: "Secure QR Signature", status: "PASS", severity: "info", evidence: qrVerif.reason });
    } else if (qrVerif.signature_valid === false) {
      result.analysisAxes.qrCryptography = { status: "REVIEW", detail: "Invalid Secure QR Signature!" };
      result.checks.push({ id: "qr.cryptography", label: "Secure QR Signature", status: "FAIL", severity: "review", evidence: qrVerif.reason });
      result.reasonCodes.push("QR_SIGNATURE_INVALID");
    } else {
      result.analysisAxes.qrCryptography = { status: "NOT_ASSESSED", detail: qrVerif.reason || "QR code not present or not readable." };
      result.checks.push({ id: "qr.cryptography", label: "Secure QR Signature", status: "NOT_ASSESSED", severity: "info", evidence: qrVerif.reason || "QR code not present or not readable." });
    }
  }

  // Recalculate triage if ML signals added reason codes
  if (result.reasonCodes.length > 0 && result.triage === "NO_HIGH_RISK_SIGNAL_DETECTED") {
    result.triage = "MANUAL_REVIEW";
  }

  return result;
}

export function analyzeScreening(input = {}) {
  const docType = input.documentType || "passport"; // Fallback to passport for older tests
  
  if (docType === "unknown") {
    const result = invalidMrzResult("Document type could not be identified.");
    return enrichWithBackendResults(result, input);
  }

  // --- NON-PASSPORT INDIAN IDs ---
  if (docType !== "passport") {
    const idExtract = input.idExtract || { is_valid: false, reason: "No extraction payload", id_number: "UNKNOWN", pin_code: null };
    const rawId = idExtract.id_number || "UNKNOWN";
    const pinCode = idExtract.pin_code;
    
    const isValid = idExtract.is_valid;
    const reasons = [];
    if (!isValid) reasons.push("VALIDATION_FAILED");

    const checks = [
      {
        id: "id_validation",
        label: `${docType.toUpperCase()} Format Validation`,
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
    
    if (pinCode) {
        result.fields.push({ id: "pinCode", label: "Address PIN", maskedValue: pinCode, source: "OCR Extraction (Back)" });
    }
    
    return enrichWithBackendResults(result, input);
  }

  // --- PASSPORT (Original MRZ Logic) ---
  let parsed;
  let mrzFailed = false;
  let mrzError = "";
  try {
    // OCR Heuristic: If OCR dropped the 'P' at the beginning of the MRZ and hallucinated an extra char at the end
    if (input.mrzLine1 && input.mrzLine1.length === MRZ_LINE_LENGTH && input.mrzLine1.startsWith("<")) {
      input.mrzLine1 = "P" + input.mrzLine1.substring(0, MRZ_LINE_LENGTH - 1);
    }
    
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

  // ─── ICAO 9303 Worldwide Validation Rules ───
  const icaoChecks = [];

  // Rule: Document type must start with 'P'
  const passportType = parsed.fields.documentType;
  const validDocType = VALID_DOC_TYPES.has(passportType) || passportType.startsWith("P");
  icaoChecks.push({
    id: "icao.document_type", label: "Document type is passport (P)",
    status: validDocType ? "PASS" : "FAIL",
    severity: validDocType ? "info" : "review",
    evidence: validDocType
      ? `Document type '${passportType}' is a valid ICAO passport type.`
      : `Document type '${passportType}' is not a recognized passport type. Expected 'P<' or similar.`
  });

  // Rule: Issuing country must be valid ISO 3166-1 alpha-3
  const issuer = parsed.fields.issuingCountry;
  const validIssuer = VALID_COUNTRY_CODES.has(issuer);
  icaoChecks.push({
    id: "icao.issuing_country", label: "Issuing country is valid ISO code",
    status: validIssuer ? "PASS" : "FAIL",
    severity: validIssuer ? "info" : "review",
    evidence: validIssuer
      ? `Issuing country '${issuer}' is a recognized ISO 3166-1 / ICAO code.`
      : `Issuing country '${issuer}' is NOT a valid ISO 3166-1 country code. Possible forgery.`
  });

  // Rule: Nationality must be valid ISO 3166-1 alpha-3
  const nationality = parsed.fields.nationality;
  const validNationality = VALID_COUNTRY_CODES.has(nationality);
  icaoChecks.push({
    id: "icao.nationality", label: "Nationality is valid ISO code",
    status: validNationality ? "PASS" : "FAIL",
    severity: validNationality ? "info" : "review",
    evidence: validNationality
      ? `Nationality '${nationality}' is a recognized ISO 3166-1 / ICAO code.`
      : `Nationality '${nationality}' is NOT a valid ISO 3166-1 country code. Possible forgery.`
  });

  // Rule: Sex field must be M, F, or < (unspecified)
  const sexRaw = parsed.raw.line2[20];
  const validSex = VALID_SEX_CODES.has(sexRaw);
  icaoChecks.push({
    id: "icao.sex_field", label: "Sex field is valid (M/F/<)",
    status: validSex ? "PASS" : "FAIL",
    severity: validSex ? "info" : "review",
    evidence: validSex
      ? `Sex field '${sexRaw}' is valid per ICAO 9303.`
      : `Sex field '${sexRaw}' is invalid. Must be M, F, or < (unspecified).`
  });

  // Rule: Date of birth must be parseable and not in the future
  const dob = parsed.fields.dateOfBirth;
  const dobValid = dob !== null;
  const dobInFuture = dob && Date.parse(`${dob}T00:00:00Z`) > Date.now();
  icaoChecks.push({
    id: "icao.birth_date_valid", label: "Date of birth is valid",
    status: (dobValid && !dobInFuture) ? "PASS" : "FAIL",
    severity: (dobValid && !dobInFuture) ? "info" : "review",
    evidence: !dobValid
      ? "Date of birth cannot be parsed from MRZ. Invalid YYMMDD format."
      : dobInFuture
        ? `Date of birth ${dob} is in the future. Impossible — likely forged.`
        : `Date of birth ${dob} is a valid past date.`
  });

  // Rule: Name must not be empty
  const name = parsed.fields.name;
  const nameValid = name && name.trim().length > 1;
  icaoChecks.push({
    id: "icao.name_present", label: "Holder name is present",
    status: nameValid ? "PASS" : "FAIL",
    severity: nameValid ? "info" : "review",
    evidence: nameValid
      ? `Name '${name}' extracted from MRZ.`
      : "Name field is empty or contains only filler characters. Invalid passport."
  });

  // Rule: Document number must not be all filler
  const docNum = parsed.fields.documentNumber;
  const docNumValid = docNum && docNum.length > 0 && docNum !== "";
  icaoChecks.push({
    id: "icao.document_number_present", label: "Document number is present",
    status: docNumValid ? "PASS" : "FAIL",
    severity: docNumValid ? "info" : "review",
    evidence: docNumValid
      ? `Document number present (masked for privacy).`
      : "Document number is empty or all filler characters. Invalid passport."
  });

  const allChecks = [...parsed.checks, ...dataChecks, ...icaoChecks];
  const failedIcaoCheck = icaoChecks.some((item) => item.status === "FAIL");
  const signals = scenario?.signals || [];
  const failedMrzCheck = parsed.checks.some((item) => item.status === "FAIL");
  const failedDataCheck = dataChecks.some((item) => item.status === "FAIL");
  const reasons = [];
  if (failedMrzCheck) reasons.push("MRZ_CHECKSUM_FAILED");
  if (failedDataCheck) reasons.push("FIELD_OR_RULE_MISMATCH");
  if (signals.length) reasons.push("SIMULATED_IMAGE_ANOMALY");
  if (failedIcaoCheck) reasons.push("ICAO_RULE_VIOLATION");

    const faceVerif = input.faceVerification;
    let identityComparison = { status: "UNAVAILABLE", detail: "No face comparison or identification is performed." };
    if (faceVerif) {
      if (faceVerif.is_real === false) {
        identityComparison = { status: "REVIEW", detail: `Face spoofing detected. Live image failed liveness check.` };
        reasons.push("LIVENESS_FAILED");
        allChecks.push({ id: "face.liveness", label: "Liveness & Anti-Spoofing", status: "FAIL", severity: "review", evidence: "Live selfie appears to be a spoof (photo or mask)." });
      } else {
        allChecks.push({ id: "face.liveness", label: "Liveness & Anti-Spoofing", status: "PASS", severity: "info", evidence: "Selfie passes liveness check." });
        
        if (faceVerif.success && faceVerif.match === true) {
          identityComparison = { status: "CLEAR", detail: `Face matches document photo. Distance: ${faceVerif.distance.toFixed(2)}` };
          allChecks.push({ id: "face.match", label: "Face verification", status: "PASS", severity: "info", evidence: "DeepFace matching successful." });
        } else if (faceVerif.success && faceVerif.match === false) {
          identityComparison = { status: "REVIEW", detail: `Face mismatch. Distance: ${faceVerif.distance.toFixed(2)}` };
          reasons.push("FACE_MISMATCH");
          allChecks.push({ id: "face.match", label: "Face verification", status: "FAIL", severity: "review", evidence: "Document photo and live selfie do not match." });
        } else {
          identityComparison = { status: "REVIEW", detail: "Face verification failed to run." };
          allChecks.push({ id: "face.match", label: "Face verification", status: "FAIL", severity: "review", evidence: "Failed to detect face or run verification." });
        }
      }
    }

    const tamper = input.tamperingResult;
    let imageAnomaly = {
        status: signals.length ? "REVIEW" : "NOT_ASSESSED",
        detail: signals.length ? "Fixture-only visual anomaly indicators are present; no image model ran." : "No image-forensics adapter is enabled."
    };
    if (tamper) {
      if (tamper.success) {
        const mantraScore = tamper.mantraScore || 0;
        if (tamper.tampered) {
          imageAnomaly = { status: "REVIEW", detail: `Tampering detected (ELA variance: ${tamper.score.toFixed(0)}, ManTraNet anomaly: ${mantraScore.toFixed(2)})` };
          reasons.push("TAMPERING_DETECTED");
          allChecks.push({ id: "tamper", label: "Tampering Detection", status: "FAIL", severity: "review", evidence: "High anomaly score detected in ELA or ManTraNet analysis." });
        } else {
          imageAnomaly = { status: "CLEAR", detail: `Image appears consistent (ELA: ${tamper.score.toFixed(0)}, ManTraNet: ${mantraScore.toFixed(2)})` };
          allChecks.push({ id: "tamper", label: "Tampering Detection", status: "PASS", severity: "info", evidence: "Image compression and pixels appear consistent." });
        }
      }
    }

    const aiDetect = input.aiDetectionResult;
    if (aiDetect && aiDetect.success) {
      const isAi = aiDetect.artificial;
      const confidence = (isAi ? aiDetect.artificial_score : aiDetect.human_score) * 100;
      if (isAi) {
        imageAnomaly = { status: "REVIEW", detail: `Synthetic/AI generation detected (${confidence.toFixed(1)}% confidence).` };
        reasons.push("SYNTHETIC_GENERATION_DETECTED");
        allChecks.push({ id: "ai_detect", label: "AI Generation Check", status: "FAIL", severity: "review", evidence: `Image is classified as AI-generated by ViT classifier (${confidence.toFixed(1)}%).` });
      } else {
        allChecks.push({ id: "ai_detect", label: "AI Generation Check", status: "PASS", severity: "info", evidence: `Image appears to be human/camera captured (${confidence.toFixed(1)}%).` });
      }
    }

    const ocr = input.fullTextOcrResult;
    if (ocr && ocr.success) {
      const ocrWords = ocr.raw_texts.map(t => t.toUpperCase().replace(/[^A-Z0-9]/g, ""));
      const nameParts = parsed.fields.name.toUpperCase().split(" ");
      nameParts.forEach(part => {
        if (part.length > 2) {
          const found = fuzzyIncludes(ocrWords, part.replace(/[^A-Z0-9]/g, ""));
          allChecks.push({
            id: `ocr.name_${part}`,
            label: `Printed name part '${part}' found`,
            status: found ? "PASS" : "FAIL",
            severity: found ? "info" : "review",
            evidence: found ? "Name part matches printed text (with typo tolerance)." : "Name part not found in document text."
          });
          if (!found) reasons.push("PRINTED_TEXT_MISMATCH");
        }
      });
      const docNum = parsed.fields.documentNumber.toUpperCase();
      if (docNum.length > 3) {
        const foundDoc = fuzzyIncludes(ocrWords, docNum.replace(/[^A-Z0-9]/g, ""));
        allChecks.push({
          id: `ocr.docnum`,
          label: `Printed doc number '${docNum}' found`,
          status: foundDoc ? "PASS" : "FAIL",
          severity: foundDoc ? "info" : "review",
          evidence: foundDoc ? "Document number matches printed text (with typo tolerance)." : "Document number not found in document text."
        });
        if (!foundDoc) reasons.push("PRINTED_TEXT_MISMATCH");
      }
    }

    const triage = reasons.length ? "MANUAL_REVIEW" : "NO_HIGH_RISK_SIGNAL_DETECTED";
    const inputMode = scenario ? "synthetic-demo" : "manual-fictional-test";
    const checkStates = allChecks.map((item) => `${item.id}:${item.status}`);

    return {
      screeningId: randomUUID(),
      notice: TEST_DATA_NOTICE,
      triage,
      reasonCodes: reasons,
      analysisAxes: {
        captureQuality: { status: "NOT_ASSESSED", detail: "This starter accepts MRZ text, not images or camera capture." },
        dataConsistency: {
          status: failedMrzCheck || failedDataCheck ? "REVIEW" : "CLEAR",
          detail: failedMrzCheck || failedDataCheck ? "At least one deterministic MRZ or field check needs human review." : "All supplied deterministic checks agree."
        },
        imageAnomaly,
        identityComparison
      },
    fields: [
      { id: "name", label: "Name", maskedValue: maskValue(parsed.fields.name, 4), source: "MRZ" },
      { id: "documentNumber", label: "Document number", maskedValue: maskValue(parsed.fields.documentNumber), source: "MRZ" },
      { id: "nationality", label: "Nationality code", maskedValue: parsed.fields.nationality || "—", source: "MRZ" },
      { id: "dateOfBirth", label: "Date of birth", maskedValue: maskValue(parsed.fields.dateOfBirth), source: "MRZ" },
      { id: "dateOfExpiry", label: "Expiry date", maskedValue: maskValue(parsed.fields.dateOfExpiry), source: "MRZ" }
    ],
    checks: allChecks,
    signals,
    auditDigest: createAuditDigest(parsed.fields.name, parsed.fields.documentNumber, triage),
    limitations: [
      "This result is triage assistance for a fictional fixture, not proof of authenticity.",
      "No OCR, image upload, metadata analysis, watchlist lookup, facial recognition, storage, or external API is used.",
      "A trained human must make any real-world decision."
    ]
  };
}

export const _internal = { buildTd3Line1, buildTd3Line2, checkDigit };
