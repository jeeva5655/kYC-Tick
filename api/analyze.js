import { analyzeScreening } from "../screening.js";

const screeningHistory = [];

export default async function handler(req, res) {
  if (req.method === "POST") {
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
      console.error(error);
      return res.status(500).json({ error: "The demo could not process that request." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
