// Post-build: fold every emitted static chunk into the service worker's
// precache list so a first visit can go fully offline, including pool worker
// boots. The turbopack worker container needs its #params fragment (the
// bundle's bootstrap config) on the PRECACHED entry too, or the offline
// worker boots without it and throws "Missing worker bootstrap config".
// Precaching the container without the fragment actually breaks offline
// spawn (hashless location), so it is withheld from the plain list.
//
// Discovery is resilient to CI layouts: prefer .next/static/chunks, fall back
// to a recursive scan of .next/static, and finally to chunk names scraped from
// Build manifests. If nothing is found, the deploy still passes (best-effort
// precache; offline stays degraded, nothing crashes).
import fs from "node:fs";
import path from "node:path";

const webDir = path.resolve(import.meta.dirname, "..");
const nextDir = path.join(webDir, ".next");
const swPath = path.join(webDir, "public", "sw.js");
const MANUAL = ["/", "/wasm/core.js", "/wasm/core.wasm", "/favicon.ico", "/icon.svg"];

const log = (...m) => console.log("[sw-precache]", ...m);

const chunksDir = path.join(nextDir, "static", "chunks");

function scanStatic() {
  // Only `.next/static` maps to public `/_next/static/...` URLs; server
  // output (e.g. .next/server/chunks) would precache unservable paths.
  const staticDir = path.join(nextDir, "static");
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".js") && p.includes("chunks")) {
        out.push(p);
      }
    }
  };
  if (fs.existsSync(staticDir)) walk(staticDir);
  return out;
}

// Chunk names referenced by build manifests, relative to .next/ ("static/...").
function manifestChunks() {
  const out = new Set();
  for (const name of ["build-manifest.json", "fallback-build-manifest.json"]) {
    const p = path.join(nextDir, name);
    try {
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(/"((?:static|chunks)[^"]*\.js)"/g)) out.add(m[1]);
    } catch {
      /* manifest absent on some CI layouts — skip */
    }
  }
  return [...out];
}

// refs are paths relative to .next ("static/chunks/x.js").
function discover() {
  const canRead = (rel) => {
    const abs = path.join(nextDir, rel);
    try {
      return fs.readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  };

  if (fs.existsSync(chunksDir)) {
    const refs = fs
      .readdirSync(chunksDir)
      .filter((f) => f.endsWith(".js"))
      .sort()
      .map((f) => `static/chunks/${f}`);
    log(`discovery: .next/static/chunks (${refs.length} files)`);
    return { refs, canRead };
  }

  const scanned = scanStatic().map((abs) => path.relative(nextDir, abs).split(path.sep).join("/"));
  if (scanned.length) {
    log(`discovery: recursive .next/static scan (${scanned.length} matches)`);
    return { refs: scanned, canRead };
  }

  const mrefs = manifestChunks();
  if (mrefs.length) {
    log(`discovery: manifest scrape (${mrefs.length} refs, file content unavailable)`);
    return { refs: mrefs, canRead };
  }

  log("discovery: no build output found (.next absent or output elsewhere)");
  return { refs: [], canRead };
}

const { refs, canRead } = discover();
if (refs.length === 0) {
  const listing = (() => {
    try {
      return fs.readdirSync(webDir).join(", ");
    } catch {
      return "unreadable";
    }
  })();
  log("web dir contents for diagnostics:", listing || "(empty)");
}

// Worker container + embedded bootstrap config: find the loader call in the
// client bundle's chunk content — f("static/chunks/turbopack-worker-*.js",
// [deps...]). The runtime reverses the dep list and appends the suffix/base
// config, so the fragment must be composed in that same shape.
let workerUrl = null;
for (const rel of refs) {
  const m = canRead(rel)?.match(
    /f\("static\/chunks\/(turbopack-worker-[A-Za-z0-9_-]+\.js)",\[([^\]]*)\]/,
  );
  if (!m) continue;
  const deps = m[2]
    .split('","')
    .map((x) => x.replaceAll('"', "").trim())
    .filter(Boolean)
    .reverse()
    .map((d) => `/_next/${d}`);
  const cfg = [deps, "", "/_next/", null, null];
  workerUrl =
    "/_next/static/chunks/" + m[1] + "#params=" + encodeURIComponent(JSON.stringify(cfg));
  break;
}
if (workerUrl) log("worker bootstrap entry reconstructed");
else log("worker bootstrap entry not derived (offline worker spawn stays best-effort)");

// Keep the fragment-less worker container OUT of the plain list: serving it
// offline strips the hash and breaks boot with a missing bootstrap config.
const plain = refs
  .map((rel) => `/_next/${rel}`)
  .filter((u) => !u.endsWith("/turbopack-worker-"));
if (workerUrl) plain.push(workerUrl);

const entries = [...MANUAL, ...plain];
if (entries.length <= MANUAL.length) {
  // Nothing to merge: leave the committed list untouched and ship anyway.
  log("no build chunks to fold in; keeping existing precache list");
  process.exit(0);
}

const sw = fs.readFileSync(swPath, "utf8");
const merged = sw.replace(/^const PRECACHE = .*$/m, `const PRECACHE = ${JSON.stringify(entries)};`);
if (merged === sw) throw new Error("PRECACHE line not found in sw.js");
fs.writeFileSync(swPath, merged);
log(`precache merged: ${plain.length} build chunks (total ${entries.length})`);
