import { ObjectId } from "mongodb";

/** `{ $oid: hex }` markers become driver ObjectIds; everything else is copied. */
export function reviveObjectIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => reviveObjectIds(v)) as unknown as T;
  if (value && typeof value === "object") {
    if (value instanceof ObjectId || value instanceof Date) return value;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$oid" && typeof record.$oid === "string") {
      return new ObjectId(record.$oid) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) out[key] = reviveObjectIds(inner);
    return out as T;
  }
  return value;
}
