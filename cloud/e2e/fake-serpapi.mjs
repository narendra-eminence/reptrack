// A stand-in for https://serpapi.com/search so end-to-end tests spend no credits and get predictable results.
//
// What a query returns is written into the query itself:
//   n<count>   how many results exist in total (default 25), served 10 per page with serpapi_pagination.next
//   nothing    SerpAPI's 200 "Google hasn't returned any results" answer
//   slow       each page takes SLOW_MS
//   flaky      HTTP 500 while the "flaky" switch is on (POST /control {"flaky": true|false})
// Every result has a date; every fourth one falls after the run's window so the out-of-range flag gets exercised.
//
// GET /stats returns {calls, byQuery}; POST /reset clears them and the switches.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SERPAPI_PORT ?? 4010);
const KEY = process.env.SERPAPI_KEY ?? "e2e-key";
const SLOW_MS = 2_000;

let calls = 0;
let byQuery = {};
let flaky = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s ? JSON.parse(s) : {}));
  });

function result(q, i) {
  const slug = q.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const day = (i % 28) + 1;
  // Results 4, 8, 12, ... are dated October, after a September window.
  const date = i % 4 === 0 ? `Oct ${day}, 2026` : `Sep ${day}, 2026`;
  return {
    position: i,
    title: `${q} result ${i}`,
    link: `https://site${i % 5}.example.com/${slug}/${i}`,
    snippet: `Snippet ${i} about ${q}.`,
    date,
    source: `Outlet ${i % 3}`,
  };
}

function search(params) {
  const raw = params.get("q") ?? "";
  const q = raw.replace(/\s+(after|before):\S+/g, "").trim();
  const total = Number(/\bn(\d+)\b/.exec(q)?.[1] ?? 25);
  if (/\bnothing\b/.test(q)) return { error: "Google hasn't returned any results for this query." };
  if (params.get("engine") === "google_news") {
    // Two plain stories and one cluster of two.
    const items = [1, 2].map((i) => ({ ...result(q, i), iso_date: `2026-09-0${i}T08:00:00Z`, source: { name: `Outlet ${i}` } }));
    items.push({ title: `${q} cluster`, stories: [3, 4].map((i) => ({ ...result(q, i), iso_date: `2026-09-0${i}T08:00:00Z`, source: { name: `Outlet ${i}` } })) });
    return { news_results: items };
  }
  const start = Number(params.get("start") ?? 0);
  const organic = [];
  for (let i = start + 1; i <= Math.min(start + 10, total); i++) organic.push(result(q, i));
  const out = { search_metadata: { status: "Success" } };
  if (params.get("tbm") === "nws") out.news_results = organic;
  else out.organic_results = organic;
  if (start + 10 < total) out.serpapi_pagination = { next: `https://serpapi.com/search?start=${start + 10}` };
  return out;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (url.pathname === "/stats") return send(res, 200, { calls, byQuery });
  if (url.pathname === "/reset" && req.method === "POST") {
    calls = 0;
    byQuery = {};
    flaky = false;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/control" && req.method === "POST") {
    const body = await readBody(req);
    if (typeof body.flaky === "boolean") flaky = body.flaky;
    return send(res, 200, { flaky });
  }
  if (url.pathname !== "/search") return send(res, 404, { error: "not found" });
  if (url.searchParams.get("api_key") !== KEY) return send(res, 401, { error: "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" });
  const q = url.searchParams.get("q") ?? "";
  calls++;
  byQuery[q] = (byQuery[q] ?? 0) + 1;
  if (/\bslow\b/.test(q)) await sleep(SLOW_MS);
  if (flaky && /\bflaky\b/.test(q)) return send(res, 500, { error: "Internal error (fake)" });
  return send(res, 200, search(url.searchParams));
}).listen(PORT, "127.0.0.1", () => console.log(`fake SerpAPI on http://127.0.0.1:${PORT}/search`));
