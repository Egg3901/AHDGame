/**
 * Shared document-shaping helpers for the secession fan-out / economy steps:
 * dot-path get/set and recursive numeric scaling. Pure, no DB I/O.
 */

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] as Record<string, unknown>;
  cur[parts[parts.length - 1]] = value;
}

/** Recursively scale every finite number by `weight`; leave Dates/strings/bools. */
export function scaleDeep(value: unknown, weight: number): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value * weight : value;
  if (value == null || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => scaleDeep(v, weight));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scaleDeep(v, weight);
    return out;
  }
  return value;
}
