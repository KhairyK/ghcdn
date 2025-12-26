import { minifyJS, minifyCSS, minifyJSON, minifyHTML } from './minifier.js';

const BIG_FILE = 512 * 1024; // 512KB threshold for weak ETag

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, "");

    if (!path) return new Response("GHCDN Alive", { status: 200 });

    const kvKey = "raw:" + path;
    const brKey = kvKey + ":br";

    const wantMeta = url.searchParams.get("meta") === "true";
    const wantIntegrity = url.searchParams.get("integrity") === "true";
    const wantMinified = url.searchParams.get("need") === "minified";

    const prewarm = url.searchParams.get("prewarm") === "true";

    const accept = req.headers.get("accept-encoding") || "";
    const useBr = accept.includes("br") && canCompress(path);

    // ---------- 1️⃣ KV RAW ----------
    let raw = await env.GHCDN_KV.get(kvKey, { type: "arrayBuffer" });
    let source = "kv";

    if (!raw || prewarm) {
      // ---------- 2️⃣ FETCH RAW ----------
      const gh = `https://raw.githubusercontent.com/${path}`;
      let res = await fetch(gh);

      // ---------- 3️⃣ FALLBACK ----------
      if (!res.ok) {
        const jsd = `https://cdn.jsdelivr.net/gh/${path}`;
        res = await fetch(jsd);
        source = "jsdelivr";
      } else {
        source = "github";
      }

      if (!res.ok) return new Response("Not Found", { status: 404 });

      raw = await res.arrayBuffer();

      // ---------- 4️⃣ MINIFY ----------
      if (wantMinified && canCompress(path)) {
        let txt = new TextDecoder().decode(raw);
        if (path.endsWith(".js")) txt = minifyJS(txt);
        else if (path.endsWith(".css")) txt = minifyCSS(txt);
        else if (path.endsWith(".json")) txt = minifyJSON(txt);
        else if (path.endsWith(".html")) txt = minifyHTML(txt);
        raw = new TextEncoder().encode(txt);
      }

      // ---------- 5️⃣ SAVE KV ----------
      ctx.waitUntil(
        env.GHCDN_KV.put(kvKey, raw, { expirationTtl: 60 * 60 * 24 * 7 })
      );
    }

    // ---------- 6️⃣ INTEGRITY ----------
    const hashBuf = await crypto.subtle.digest("SHA-384", raw);
    const integrity =
      "sha384-" + btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

    // ---------- 7️⃣ METADATA ----------
    if (wantMeta) {
      return Response.json({
        path,
        size: raw.byteLength,
        integrity,
        source,
        brotli: useBr,
        minified: wantMinified,
        mime: mimeFromPath(path)
      });
    }

    // ---------- 8️⃣ ETAG ----------
    const weak = raw.byteLength > BIG_FILE;
    const etag = (weak ? "W/" : "") + `"${integrity.slice(7, 23)}"`;

    // ---------- 9️⃣ RANGE SUPPORT ----------
    let start = 0, end = raw.byteLength - 1;
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        start = m[1] ? parseInt(m[1]) : 0;
        end = m[2] ? parseInt(m[2]) : raw.byteLength - 1;
        if (start > end || start >= raw.byteLength)
          return new Response("Range Not Satisfiable", { status: 416 });
      }
    }

    // ---------- 10️⃣ BROTLI ----------
    let body = raw.slice(start, end + 1);
    let encoding;
    if (useBr) {
      let br = await env.GHCDN_KV.get(brKey, { type: "arrayBuffer" });
      if (!br) {
        br = await brotliCompress(raw);
        ctx.waitUntil(
          env.GHCDN_KV.put(brKey, br, { expirationTtl: 60 * 60 * 24 * 7 })
        );
      }
      body = br.slice(start, end + 1);
      encoding = "br";
    }

    // ---------- 11️⃣ FINAL RESPONSE ----------
    const headers = {
      "content-type": mimeFromPath(path),
      "cache-control": "public, max-age=31536000, immutable",
      "etag": etag,
      "vary": "Accept-Encoding",
      "x-ghcdn-source": source
    };

    if (encoding) headers["content-encoding"] = encoding;
    if (rangeHeader) {
      headers["content-range"] = `bytes ${start}-${end}/${raw.byteLength}`;
      return new Response(body, { status: 206, headers });
    }

    return new Response(body, { headers });
  }
};

// ===============================
// HELPERS
// ===============================

function canCompress(p) {
  return (
    p.endsWith(".js") ||
    p.endsWith(".css") ||
    p.endsWith(".json") ||
    p.endsWith(".html") ||
    p.endsWith(".wasm")
  );
}

function mimeFromPath(p) {
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

async function brotliCompress(buf) {
  const cs = new CompressionStream("br");
  const writer = cs.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  return new Response(cs.readable).arrayBuffer();
}
