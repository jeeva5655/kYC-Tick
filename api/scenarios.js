import { listDemoScenarios } from "../screening.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ scenarios: listDemoScenarios() });
  }
  return res.status(405).json({ error: "Method not allowed" });
}
