// Post-build: fold every emitted static chunk into the service worker's
// precache list so a first visit can go fully offline, including pool worker
// boots. The turbopack worker container needs its #params fragment (the
// bundle's bootstrap config) on the PRECACHED entry too, or the offline
// worker boots without it and throws "Missing worker bootstrap config".
// Precaching the container without the fragment actually breaks offline
// spawn (hashless location), so it is withheld from the plain list.
import fs from "node:fs";
import path from "node:path";

const webDir = path.resolve(import.meta.dirname, "..");
const chunksDir = path.join(webDir, ".next", "static", "chunks");
const swPath = path.join(webDir, "public", "sw.js");
const MANUAL = ["/", "/wasm/core.js", "/wasm/core.wasm", "/favicon.ico", "/icon.svg"];

const files = fs.readdirSync(chunksDir).filter((f) => f.endsWith(".js")).sort();
const plain = files.map((f) => `/_next/static/chunks/${f}`);

// Build the worker container's #params entry from the client bundle's
// embedded loader call: f("static/chunks/turbopack-worker-*.js",[deps...]);
// the runtime reverses the dep list and appends [suffix, basePath, ids].
const container = files.find((f) => f.startsWith("turbopack-worker-"));
let workerUrl = null;
if (container) {
  const pat = new RegExp(
    'f\\("static/chunks/' + container + '",\\[([^\\]]*)\\]',
    "s",
  );
  let deps = [];
  for (const f of files) {
    const m = fs.readFileSync(path.join(chunksDir, f), "utf8").match(pat);
    if (m) {
      deps = m[1]
        .split('","')
        .map((x) => x.replaceAll('"', "").trim())
        .filter(Boolean);
      break;
    }
  }
  const cfg = [
    deps.reverse().map((d) => `/_next/${d}`),
    "",
    "/_next/",
    null,
    null,
  ];
  workerUrl =
    "/_next/static/chunks/" + container +
    "#params=" + encodeURIComponent(JSON.stringify(cfg));
}

const urls = plain.filter((u) => !container || !u.endsWith(`/${container}`));
if (workerUrl) urls.push(workerUrl);
const next = fs
  .readFileSync(swPath, "utf8")
  .replace(/^const PRECACHE = .*$/m, `const PRECACHE = ${JSON.stringify([...MANUAL, ...urls])};`);
if (!next.includes("const PRECACHE = "))
  throw new Error("PRECACHE line not found in sw.js");
fs.writeFileSync(swPath, next);
console.log(
  `sw.js precache: ${plain.length} build chunks added (+${workerUrl ? 1 : 0} fragmented worker entry; hidden plain container: ${container ?? "none"})`,
);
