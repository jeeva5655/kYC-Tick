import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeScreening, listDemoScenarios } from "./screening.js";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 16 * 1024;

const staticFiles = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.html", { file: "app.html", type: "text/html; charset=utf-8" }],
  ["/landing.css", { file: "landing.css", type: "text/css; charset=utf-8" }],
  ["/landing.js", { file: "landing.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/manifest.json", { file: "manifest.json", type: "application/manifest+json; charset=utf-8" }],
  ["/service-worker.js", { file: "service-worker.js", type: "text/javascript; charset=utf-8" }],
  ["/icon-512.jpg", { file: "icon-512.jpg", type: "image/jpeg" }]
]);

function addSafetyHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:8001; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response, statusCode, payload) {
  addSafetyHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The request must contain valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

  try {
    if (request.method === "GET" && requestUrl.pathname.startsWith("/frames/")) {
      try {
        const framePath = path.join(rootDirectory, requestUrl.pathname);
        const content = await readFile(framePath);
        addSafetyHeaders(response);
        response.writeHead(200, { "Content-Type": "image/jpeg" });
        return response.end(content);
      } catch (error) {
        return sendJson(response, 404, { error: "Not found" });
      }
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok", storage: "disabled" });
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/scenarios") {
      return sendJson(response, 200, { scenarios: listDemoScenarios() });
    }

const screeningHistory = [];

    if (request.method === "GET" && requestUrl.pathname === "/api/analytics") {
      const summary = {
        total: screeningHistory.length,
        riskDistribution: {
          green: screeningHistory.filter(h => h.triage === "NO_HIGH_RISK_SIGNAL_DETECTED").length,
          amber: screeningHistory.filter(h => h.triage === "MANUAL_REVIEW").length,
          red: screeningHistory.filter(h => h.triage === "STOP_TRANSACTION").length
        },
        recent: screeningHistory.slice(-10).reverse() // Last 10 items
      };
      return sendJson(response, 200, summary);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/analyze") {
      const input = await readJsonBody(request);
      const result = analyzeScreening(input);
      
      // Store lightweight representation in history
      screeningHistory.push({
        id: result.screeningId,
        timestamp: result.auditDigest.timestamp,
        triage: result.triage,
        docType: input.documentType || "passport"
      });
      
      return sendJson(response, 200, result);
    }

    if (request.method === "GET" && staticFiles.has(requestUrl.pathname)) {
      const asset = staticFiles.get(requestUrl.pathname);
      const content = await readFile(path.join(rootDirectory, asset.file));
      addSafetyHeaders(response);
      response.writeHead(200, { "Content-Type": asset.type });
      return response.end(content);
    }

    return sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendJson(response, statusCode, {
      error: statusCode === 500 ? "The demo could not process that request." : error.message
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Synthetic document integrity demo: http://127.0.0.1:${port}`);
});
