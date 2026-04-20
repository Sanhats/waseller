#!/usr/bin/env node
/**
 * Mock mínimo del POST shadow-compare (misma forma de respuesta que espera Waseller).
 * Uso: node scripts/shadow-compare-mock-server.mjs
 * Workers: LLM_SHADOW_COMPARE_URL=http://127.0.0.1:18080/shadow-compare
 *
 * En consola imprime: filas de stockTable, businessProfileSlug, tamaño aprox. del body.
 */
import http from "node:http";

const port = Number(process.env.PORT ?? process.env.SHADOW_MOCK_PORT ?? 18080);

const okBody = JSON.stringify({
  candidateDecision: {
    draftReply: "[mock-crew] recibido",
    intent: "consultar_precio",
    nextAction: "reply_only",
    recommendedAction: "reply_only",
    confidence: 0.5,
    reason: "mock_server"
  }
});

const server = http.createServer((req, res) => {
  const path = req.url?.split("?")[0] ?? "";
  if (req.method !== "POST" || (path !== "/shadow-compare" && path !== "/v1/shadow-compare")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      console.warn("[shadow-mock] JSON inválido, primeros 200 chars:", raw.slice(0, 200));
    }
    const stock = Array.isArray(json.stockTable) ? json.stockTable : [];
    const slug = json.businessProfileSlug;
    console.log(
      `[shadow-mock] ${new Date().toISOString()} ${path} bodyBytes=${Buffer.byteLength(raw)} stockRows=${stock.length} businessProfileSlug=${slug === undefined ? "(omitido)" : JSON.stringify(slug)}`
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okBody);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[shadow-mock] escuchando http://127.0.0.1:${port}/shadow-compare y /v1/shadow-compare`);
});
