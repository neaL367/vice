// uniqueName: collision-free output names. exists() probes the destination
// (pre-listed directory entries, try-create, etc.); the planner never
// overwrites silently. Also strips characters the File System Access API
// refuses on common filesystems.

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeStem(stem: string): string {
  const clean = (stem || "image").replace(ILLEGAL, "_").replace(/[. ]+$/, "");
  return clean.length > 0 ? clean.slice(0, 100) : "image";
}

export function uniqueName(stem: string, ext: string, exists: (name: string) => boolean): string {
  const base = sanitizeStem(stem);
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  const first = `${base}${suffix}`;
  if (!exists(first)) return first;
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base} (${i})${suffix}`;
    if (!exists(candidate)) return candidate;
  }
  // Practically unreachable; timestamp fallback instead of overwriting.
  return `${base} ${Date.now()}${suffix}`;
}

export interface DirectoryLike<F> {
  getFileHandle(name: string, opts: { create: boolean }): Promise<F>;
}

/** Resolve a collision-free file name in a directory handle (no overwrite). */
export async function uniqueFileHandle<F>(
  dir: DirectoryLike<F>,
  stem: string,
  ext: string,
): Promise<{ handle: F; fileName: string }> {
  const base = sanitizeStem(stem);
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  for (let i = 0; i < 10000; i++) {
    const fileName = i === 0 ? `${base}${suffix}` : `${base} (${i})${suffix}`;
    try {
      await dir.getFileHandle(fileName, { create: false });
    } catch {
      return { handle: await dir.getFileHandle(fileName, { create: true }), fileName };
    }
  }
  const fileName = `${base} ${Date.now()}${suffix}`;
  return { handle: await dir.getFileHandle(fileName, { create: true }), fileName };
}
