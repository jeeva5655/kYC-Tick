export default async function handler(req, res) {
  if (req.method === "GET") {
    // Note: Vercel serverless functions are stateless, so this history will 
    // reset frequently in production. For a demo, it's sufficient to return empty or mock data.
    const summary = {
      total: 0,
      riskDistribution: { green: 0, amber: 0, red: 0 },
      recent: []
    };
    return res.status(200).json(summary);
  }
  return res.status(405).json({ error: "Method not allowed" });
}
