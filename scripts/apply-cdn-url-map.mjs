// Replace external image URLs in source files using public/static/url-map.json
//
//   node scripts/apply-cdn-url-map.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(root, "public", "static", "url-map.json");
const urlMap = JSON.parse(readFileSync(mapPath, "utf8"));

const TARGET_DIRS = ["src"];
const SKIP = new Set(["url-map.json"]);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, files);
    } else if (/\.(ts|tsx|json)$/.test(name) && !SKIP.has(name)) {
      files.push(full);
    }
  }
  return files;
}

let totalReplacements = 0;

for (const dir of TARGET_DIRS) {
  for (const file of walk(path.join(root, dir))) {
    let text = readFileSync(file, "utf8");
    let changed = false;
    for (const [from, to] of Object.entries(urlMap)) {
      if (!from.startsWith("http") && !from.startsWith("/api/")) continue;
      if (!text.includes(from)) continue;
      const count = text.split(from).length - 1;
      text = text.split(from).join(to);
      totalReplacements += count;
      changed = true;
    }
    if (changed) {
      writeFileSync(file, text);
      console.log(`  updated ${path.relative(root, file)}`);
    }
  }
}

console.log(`Done. ${totalReplacements} replacements.`);
