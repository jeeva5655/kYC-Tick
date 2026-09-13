# Synthetic Document Integrity Triage Demo

A local, install-free starter for a hackathon-style document-integrity project. It deliberately handles **fictional passport-style test data only**. It is not a travel-document verification product and never makes an approval, denial, blacklist, fraud, or identity decision.

## What works now

- Three clearly fictional TD3 passport MRZ fixtures: clean, printed-date mismatch, and simulated visual anomaly.
- Deterministic TD3 MRZ check digits: document number, date of birth, expiry date, optional data, and composite check.
- Printed-field versus MRZ consistency checks and expiry validation.
- Separate, explainable axes for capture quality, data consistency, image anomalies, and identity comparison.
- Only three human-safe triage states: `RETAKE_IMAGE`, `MANUAL_REVIEW`, and `NO_HIGH_RISK_SIGNAL_DETECTED`.
- Masked result fields and a non-identifying SHA-256 audit digest. The server does not persist requests or results.

## Run it

This project needs Node.js 20 or later and no third-party packages.

```powershell
node server.js
```

Then open `http://127.0.0.1:3000` in a browser.

Run the automated checks with:

```powershell
node --test screening.test.js
```

## Privacy and demo boundary

- Do not enter real passports, visas, ID cards, face images, or personally identifying data.
- No images, camera capture, OCR, metadata extraction, face matching, watchlist lookup, or external services are enabled.
- Test fixtures are generated in code and use the non-country code `UTO`.
- The API rejects requests unless `testOnly: true` is supplied.
- The audit digest intentionally contains result-state data only, not raw fields.

## Next milestones

1. Run the isolated local vision service in `vision_service/`; it pins PaddleOCR, PaddlePaddle, OpenCV, and Pillow without mixing them into the browser-facing Node app.
2. Add a local OCR adapter behind a narrow interface, beginning with synthetic fixtures.
3. Add image-quality, EXIF, and error-level-analysis evidence—each described as an indicator, never proof.
4. Add an encrypted, short-retention local audit-event store if the demo needs chained receipts.
5. Evaluate against permitted mock-document datasets such as MIDV-2020/MIDV-DM after reviewing their current terms.
6. Consider an optional, explicitly consented 1:1 face-to-document comparison only after the preceding modules are reliable. Do not add one-to-many identification or a biometric database search.

## Architecture principle

Keep adapters replaceable instead of copying large GitHub repositories into this codebase:

```text
UI → screening orchestrator → OCR/MRZ adapter → validation rules → image-anomaly adapter → explainable triage result
```

That lets the project later use an OCR library such as PaddleOCR while preserving a small, testable core and clear privacy boundaries.
