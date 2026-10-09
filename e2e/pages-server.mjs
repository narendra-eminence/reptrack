import http from "node:http";

const page = (title, paras) =>
  `<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${paras
    .map((p) => `<p>${p}</p>`)
    .join("")}</article></body></html>`;
const filler =
  "Travel gear makers reported steady demand this season as more people booked trips across the country and abroad.";
const pages = {
  "/health": "ok",
  "/article-1": page("Mokobara expands its luggage range", [
    "Mokobara launched a new cabin trolley this week, adding to its growing luggage line.",
    filler,
    "Founders of Mokobara said the brand will open more stores next year.",
    filler,
  ]),
  "/article-2": page("Monsoon travel tips", [filler, filler, filler, filler]),
  "/article-3": page("Best cabin bags of the year", [
    // Distinct sentences, not repeats of `filler`: trafilatura dedupes an exact-repeated paragraph within one
    // page, which would silently shrink this list back down and push the single Mokobara mention's paragraph
    // share back over the verifier's min_paragraph_share threshold.
    "Travel gear makers reported steady demand this season as more people booked trips across the country and abroad.",
    "Airlines have also reported a rise in checked baggage fees across most major routes this year.",
    "Among the picks, Mokobara stood out for its build quality and its lifetime warranty on wheels.",
    "Budget conscious travelers increasingly compare hard shell and soft shell luggage before buying.",
    "Several retailers extended their return windows heading into the festive shopping season.",
  ]),
};

http
  .createServer((req, res) => {
    const body = pages[(req.url ?? "/").split("?")[0]];
    if (!body) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body>Not found</body></html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  })
  .listen(8200, "127.0.0.1");
