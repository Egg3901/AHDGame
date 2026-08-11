import fs from "node:fs";
import path from "node:path";

interface CdFile {
  viewBox: string;
  districts: { cd: string; path: string; cookPVI: number }[];
}

const DATA_DIR = path.join(process.cwd(), "src", "data", "congressional-districts");

/**
 * Load per-district cookPVI for a state, ordered by district code, but only when
 * the file's district count matches the requested apportionment `n`. A mismatch
 * (e.g. a 1991 seat count vs the modern file) returns null so the caller falls
 * back to the deterministic spread. Returns null for missing/unreadable files.
 */
export function loadCookPvi(stateId: string, n: number): (number | null)[] | null {
  const file = path.join(DATA_DIR, `${stateId}.json`);
  let parsed: CdFile;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CdFile;
  } catch {
    return null;
  }
  const districts = parsed.districts ?? [];
  if (districts.length !== n) return null;
  const ordered = [...districts].sort((a, b) => a.cd.localeCompare(b.cd));
  return ordered.map((d) => (typeof d.cookPVI === "number" ? d.cookPVI : null));
}
