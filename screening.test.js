import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScreening, listDemoScenarios, parseTd3Mrz } from "./screening.js";

const scenarioById = (id) => listDemoScenarios().find((scenario) => scenario.id === id);

test("the clean fictional fixture has valid TD3 check digits", () => {
  const clean = scenarioById("clean");
  const parsed = parseTd3Mrz(clean.mrzLine1, clean.mrzLine2);
  assert.equal(parsed.checks.every((item) => item.status === "PASS"), true);
  assert.equal(parsed.fields.dateOfBirth, "1990-01-01");
  assert.equal(parsed.fields.dateOfExpiry, "2034-01-01");
});

test("the clean fictional fixture produces an informational triage state", () => {
  const clean = scenarioById("clean");
  const result = analyzeScreening({ ...clean, scenarioId: clean.id, testOnly: true });
  assert.equal(result.triage, "NO_HIGH_RISK_SIGNAL_DETECTED");
  assert.deepEqual(result.reasonCodes, []);
});

test("a printed DOB disagreement requires human review", () => {
  const scenario = scenarioById("dob-mismatch");
  const result = analyzeScreening({ ...scenario, scenarioId: scenario.id, testOnly: true });
  assert.equal(result.triage, "MANUAL_REVIEW");
  assert.equal(result.reasonCodes.includes("FIELD_OR_RULE_MISMATCH"), true);
  assert.equal(result.checks.find((item) => item.id === "fields.birth_date").status, "FAIL");
});

test("fixture-only image signals require review without claiming image analysis", () => {
  const scenario = scenarioById("image-anomaly");
  const result = analyzeScreening({ ...scenario, scenarioId: scenario.id, testOnly: true });
  assert.equal(result.triage, "MANUAL_REVIEW");
  assert.equal(result.analysisAxes.imageAnomaly.status, "REVIEW");
  assert.equal(result.signals.every((signal) => signal.confidence === "demo-only"), true);
});

test("malformed MRZ input asks for a retake instead of making a decision", () => {
  const result = analyzeScreening({ mrzLine1: "P<UTO", mrzLine2: "INVALID", testOnly: true });
  assert.equal(result.triage, "RETAKE_IMAGE");
  assert.equal(result.checks[0].id, "mrz.structure");
});
