/**
 * Shared document-shaping helpers for the secession fan-out / economy steps:
 * dot-path get/set and recursive numeric scaling. Pure, no DB I/O.
 */

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  for (const part of parts) {
    if (part === "__proto__" || part === "constructor" || part === "prototype") return;
  }
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === "__proto__" || key === "constructor" || key === "prototype") return;
    const existing = current[key];
    if (existing === null || typeof existing !== "object") {
      current[key] = /^(0|[1-9]\d*)$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Recursively scale every finite number by `weight`; leave Dates/strings/bools. */
export function scaleDeep(value: unknown, weight: number): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value * weight : value;
  if (value == null || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => scaleDeep(v, weight));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      Object.defineProperty(out, key, {
        value: scaleDeep(nestedValue, weight),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  return value;
}
