import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function directory(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`Not a compiler-cache directory: ${path}`);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Explicit recovery only. Preserve BuildKit mount roots and never touch
// fetch-cache, runtime responses, application output or dependency caches.
export function clearCompilerCache(cwd = process.cwd()) {
  const next = join(cwd, ".next");
  const cache = join(next, "cache");
  if (!directory(next) || !directory(cache)) return;
  for (const kind of ["turbopack", "webpack"]) {
    const dir = join(cache, kind);
    if (!directory(dir)) continue;
    for (const entry of readdirSync(dir))
      rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  clearCompilerCache();
  console.log("Compiler cache contents cleared; mount points and fetch cache preserved.");
}
