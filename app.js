const elements = {
  form: document.querySelector("#screeningForm"),
  documentImage: document.querySelector("#documentImage"),
  liveImage: document.querySelector("#liveImage"),
  submitBtn: document.querySelector("#submitBtn"),
  progressIndicator: document.querySelector("#progressIndicator"),
  progressText: document.querySelector("#progressText"),
  triageBadge: document.querySelector("#triageBadge"),
  emptyResult: document.querySelector("#emptyResult"),
  resultContent: document.querySelector("#resultContent"),
  triageDescription: document.querySelector("#triageDescription"),
  axesGrid: document.querySelector("#axesGrid"),
  fieldList: document.querySelector("#fieldList"),
  checkList: document.querySelector("#checkList"),
  auditDigest: document.querySelector("#auditDigest"),
  limitationsList: document.querySelector("#limitationsList"),
  docPreview: document.querySelector("#docPreview"),
  documentBackImage: document.querySelector("#documentBackImage"),
  docBackPreview: document.querySelector("#docBackPreview"),
  livePreview: document.querySelector("#livePreview"),
  tabButtons: document.querySelectorAll('.tab-button'),
  tabContents: document.querySelectorAll('.tab-content'),
  downloadPdfBtn: document.querySelector('#downloadPdfBtn'),
  refreshAnalyticsBtn: document.querySelector('#refreshAnalyticsBtn'),
  statTotal: document.querySelector('#statTotal'),
  statGreen: document.querySelector('#statGreen'),
  statAmber: document.querySelector('#statAmber'),
  statRed: document.querySelector('#statRed'),
  activityTableBody: document.querySelector('#activityTableBody'),
};

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function visualStatus(status) {
  return status.toLowerCase().replaceAll("_", "-");
}

function statusLabel(status) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function triageCopy(result) {
  if (result.triage === "RETAKE_IMAGE") return "The document image could not be read clearly. Please retake the photo in better lighting.";
  if (result.triage === "MANUAL_REVIEW") return "One or more signals flagged during AI screening require human inspection.";
  return "All automated forensic and data consistency checks passed. The document appears authentic.";
}

function renderResult(result) {
  elements.emptyResult.hidden = true;
  elements.resultContent.hidden = false;
  if (elements.downloadPdfBtn) elements.downloadPdfBtn.hidden = false;
  elements.triageBadge.className = `triage-badge ${visualStatus(result.triage)}`;
  
  if (result.triage === "NO_HIGH_RISK_SIGNAL_DETECTED") {
    elements.triageBadge.textContent = "REAL (AUTHENTIC)";
    elements.triageBadge.style.backgroundColor = "#00c853";
    elements.triageBadge.style.color = "white";
  } else if (result.triage === "MANUAL_REVIEW") {
    elements.triageBadge.textContent = "FAKE (FORGERY DETECTED)";
    elements.triageBadge.style.backgroundColor = "#ff3d00";
    elements.triageBadge.style.color = "white";
  } else if (result.triage === "RETAKE_IMAGE") {
    elements.triageBadge.textContent = "UNKNOWN (RETAKE)";
    elements.triageBadge.style.backgroundColor = "#ff9100";
    elements.triageBadge.style.color = "white";
  } else {
    elements.triageBadge.textContent = statusLabel(result.triage);
    elements.triageBadge.style.backgroundColor = "";
    elements.triageBadge.style.color = "";
  }
  
  elements.triageDescription.textContent = triageCopy(result);

  elements.axesGrid.replaceChildren();
  Object.entries(result.analysisAxes).forEach(([name, axis]) => {
    const card = makeElement("article", `axis-card ${visualStatus(axis.status)}`);
    card.append(makeElement("span", "axis-name", name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())));
    card.append(makeElement("strong", null, statusLabel(axis.status)));
    card.append(makeElement("p", null, axis.detail));
    elements.axesGrid.append(card);
  });

  elements.fieldList.replaceChildren();
  result.fields.forEach((field) => {
    const wrapper = document.createElement("div");
    wrapper.append(makeElement("dt", null, field.label));
    const definition = makeElement("dd", null, field.maskedValue);
    definition.title = `Source: ${field.source}`;
    wrapper.append(definition);
    elements.fieldList.append(wrapper);
  });

  elements.checkList.replaceChildren();
  result.checks.forEach((item) => {
    const listItem = makeElement("li", `evidence-item ${visualStatus(item.status)}`);
    const topLine = makeElement("div", "evidence-topline");
    topLine.append(makeElement("strong", null, item.label));
    topLine.append(makeElement("span", "status-chip", statusLabel(item.status)));
    listItem.append(topLine);
    listItem.append(makeElement("p", null, item.evidence));
    elements.checkList.append(listItem);
  });

  if (typeof result.auditDigest === "object" && result.auditDigest !== null) {
    elements.auditDigest.textContent = result.auditDigest.hash;
  } else {
    elements.auditDigest.textContent = result.auditDigest;
  }
  elements.limitationsList.replaceChildren();
  result.limitations.forEach((limitation) => elements.limitationsList.append(makeElement("li", null, limitation)));
}

function showError(message) {
  renderResult({
    triage: "RETAKE_IMAGE",
    analysisAxes: {
      captureQuality: { status: "RETAKE", detail: message },
      dataConsistency: { status: "NOT_ASSESSED", detail: "No result was returned." },
      imageAnomaly: { status: "NOT_ASSESSED", detail: "No result was returned." },
      identityComparison: { status: "UNAVAILABLE", detail: "No result was returned." }
    },
    fields: [],
    checks: [{ label: "Request", status: "FAIL", evidence: message }],
    signals: [],
    auditDigest: "No digest created",
    limitations: ["No document data is stored."]
  });
}

function handleFileSelect(inputElement, previewElement) {
  const file = inputElement.files[0];
  if (file) {
    elements.submitBtn.disabled = false;
    const reader = new FileReader();
    reader.onload = (e) => {
      previewElement.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 100%; max-height: 200px; border-radius: 8px;" />`;
      previewElement.hidden = false;
      
      const label = inputElement.closest('.upload-label');
      if (label) {
        const icon = label.querySelector('.upload-icon');
        const title = label.querySelector('.upload-title');
        const hint = label.querySelector('.field-hint');
        if (icon) icon.style.display = 'none';
        if (title) title.style.display = 'none';
        if (hint) hint.style.display = 'none';
      }
    };
    reader.readAsDataURL(file);
  }
}

elements.documentImage.addEventListener("change", () => handleFileSelect(elements.documentImage, elements.docPreview));
elements.documentBackImage.addEventListener("change", () => handleFileSelect(elements.documentBackImage, elements.docBackPreview));
elements.liveImage.addEventListener("change", () => handleFileSelect(elements.liveImage, elements.livePreview));

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  
  const docFile = elements.documentImage.files[0];
  const docBackFile = elements.documentBackImage.files[0];
  const liveFile = elements.liveImage.files[0];
  if (!docFile) return showError("Please upload a document image.");

  elements.submitBtn.disabled = true;
  elements.progressIndicator.hidden = false;
  elements.emptyResult.hidden = true;
  elements.resultContent.hidden = true;
  
  let faceVerification = null;
  let tamperingResult = null;
  let fullTextOcrResult = null;
  let mrzExtract = null;

  try {
    const docData = new FormData();
    docData.append("document_image", docFile);
    if (docBackFile) {
        docData.append("document_back_image", docBackFile);
    }
    if (liveFile) {
        docData.append("live_image", liveFile);
    }
    
    const manualTypeSelect = document.getElementById("manualDocumentType");
    if (manualTypeSelect) {
      docData.append("manual_document_type", manualTypeSelect.value);
    }
    
    elements.progressText.textContent = "Running unified visual analysis (OCR, Forensics, Face)...";
    
    let backendUrl = document.getElementById("backendUrlInput").value.trim();
    if (backendUrl.endsWith("/")) backendUrl = backendUrl.slice(0, -1);
    const analyzeRes = await fetch(`${backendUrl}/api/v1/analyze-all`, { method: "POST", body: docData });
    if (!analyzeRes.ok) {
        throw new Error("Failed to communicate with vision service");
    }
    
    const analyzeData = await analyzeRes.json();
    
    mrzExtract = analyzeData.mrzExtract;
    fullTextOcrResult = analyzeData.fullTextOcrResult;
    tamperingResult = analyzeData.tamperingResult;
    let aiDetectionResult = analyzeData.aiDetectionResult;
    faceVerification = analyzeData.faceVerification;
    let qrVerification = analyzeData.qrVerification;
    
    const documentType = analyzeData.documentType;
    const idExtract = analyzeData.idExtract;
    
    let mrzLine1 = null;
    let mrzLine2 = null;

    if (mrzExtract && mrzExtract.success && mrzExtract.mrz_raw) {
        const lines = mrzExtract.mrz_raw.split('\n').filter(Boolean);
        if (lines.length >= 2) {
            mrzLine1 = lines[0];
            mrzLine2 = lines[1];
        }
    }
    
    if (!mrzLine1 || !mrzLine2) {
       if (fullTextOcrResult && fullTextOcrResult.success) {
           const texts = fullTextOcrResult.raw_texts.map(t => t.replace(/\s+/g, ''));
           const mrzLines = texts.filter(t => t.length === 44 && /^[A-Z0-9<]+$/.test(t));
           if (mrzLines.length >= 2) {
               mrzLine1 = mrzLines[0];
               mrzLine2 = mrzLines[1];
           }
       }
    }

    if (documentType === "passport" && (!mrzLine1 || !mrzLine2)) {
        console.warn("No MRZ found in the image for passport.");
    }
    
    elements.progressText.textContent = "Compiling intelligence report...";

    // 6. Final triage
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentType,
        idExtract,
        mrzLine1,
        mrzLine2,
        faceVerification,
        tamperingResult,
        fullTextOcrResult,
        aiDetectionResult,
        qrVerification
      })
    });
    
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The server could not process the analysis.");
    renderResult(body);
  } catch (error) {
    showError(error.message);
  } finally {
    elements.submitBtn.disabled = false;
    elements.progressIndicator.hidden = true;
  }
});

// UI Interactions
if (elements.tabButtons) {
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.tabButtons.forEach(b => b.classList.remove('active'));
      elements.tabContents.forEach(c => c.classList.remove('active'));
      elements.tabContents.forEach(c => c.hidden = true);
      
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.classList.add('active');
        targetEl.hidden = false;
      }
      
      if (targetId === 'analyticsTab') {
        loadAnalytics();
      }
    });
  });
}

if (elements.downloadPdfBtn) {
  elements.downloadPdfBtn.addEventListener('click', () => {
    window.print();
  });
}

async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    if (!res.ok) throw new Error("Failed to load analytics");
    const data = await res.json();
    
    if (elements.statTotal) elements.statTotal.textContent = data.total;
    if (elements.statGreen) elements.statGreen.textContent = data.riskDistribution.green;
    if (elements.statAmber) elements.statAmber.textContent = data.riskDistribution.amber;
    if (elements.statRed) elements.statRed.textContent = data.riskDistribution.red;
    
    if (elements.activityTableBody) {
      if (!data.recent || data.recent.length === 0) {
        elements.activityTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem 0;">No screenings yet. Upload a document in the Screening tab to see activity.</td></tr>';
      } else {
        elements.activityTableBody.innerHTML = data.recent.map(r => `
          <tr>
            <td>${new Date(r.timestamp).toLocaleTimeString()}</td>
            <td style="text-transform: capitalize;">${r.docType}</td>
            <td><span class="status-chip" style="background: ${r.triage === 'NO_HIGH_RISK_SIGNAL_DETECTED' ? 'var(--accent)' : (r.triage === 'MANUAL_REVIEW' ? 'var(--warning)' : 'var(--danger)')}">${r.triage.replaceAll("_", " ")}</span></td>
            <td style="font-family: monospace; font-size: 0.8rem; color: var(--muted);">${r.id}</td>
          </tr>
        `).join('');
      }
    }
  } catch(e) {
    console.error("Analytics Error:", e);
  }
}

if (elements.refreshAnalyticsBtn) {
  elements.refreshAnalyticsBtn.addEventListener('click', loadAnalytics);
}

const urlInput = document.getElementById("backendUrlInput");
if (urlInput) {
    const savedUrl = localStorage.getItem("backendApiUrl");
    if (savedUrl) {
        urlInput.value = savedUrl;
    }
    urlInput.addEventListener("input", (e) => {
        localStorage.setItem("backendApiUrl", e.target.value.trim());
    });
}
