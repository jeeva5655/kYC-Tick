import { analyzeScreening, listDemoScenarios } from "../screening.js";

const screeningHistory = [];

export default async function handler(req, res) {
  const { route } = req.query; // e.g. ['analyze'] for /api/analyze

  if (!route || route.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  const endpoint = route[0];

  if (req.method === "GET" && endpoint === "health") {
    return res.status(200).json({ status: "ok", storage: "disabled" });
  }

  if (req.method === "GET" && endpoint === "scenarios") {
    return res.status(200).json({ scenarios: listDemoScenarios() });
  }

  if (req.method === "GET" && endpoint === "analytics") {
    const summary = {
      total: screeningHistory.length,
      riskDistribution: {
        green: screeningHistory.filter(h => h.triage === "NO_HIGH_RISK_SIGNAL_DETECTED").length,
        amber: screeningHistory.filter(h => h.triage === "MANUAL_REVIEW").length,
        red: screeningHistory.filter(h => h.triage === "STOP_TRANSACTION").length
      },
      recent: screeningHistory.slice(-10).reverse()
    };
    return res.status(200).json(summary);
  }

  if (req.method === "POST" && endpoint === "analyze") {
    try {
      const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const result = analyzeScreening(input);
      
      screeningHistory.push({
        id: result.screeningId,
        timestamp: result.auditDigest.timestamp,
        triage: result.triage,
        docType: input.documentType || "passport"
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: "The demo could not process that request." });
    }
  }

  return res.status(404).json({ error: "Not found" });
}
