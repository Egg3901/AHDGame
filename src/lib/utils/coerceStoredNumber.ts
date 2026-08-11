import { Decimal128, Int32, Long } from "mongodb";

/**
 * Converts values as returned from the MongoDB driver (or their JSON shape after
 * `JSON.stringify`) into a finite JavaScript number for API responses.
 *
 * BSON `Long` serializes as `{ low, high, unsigned }` — if that is passed through
 * `NextResponse.json` without coercion, the client sees an object and `Number(x)` is NaN.
 */
export function coerceStoredNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof value === "object") {
    if (Long.isLong(value)) {
      try {
        const n = value.toNumber();
        return Number.isFinite(n) ? n : fallback;
      } catch {
        return fallback;
      }
    }
    if (value instanceof Decimal128) {
      try {
        const n = Number(value.toString());
        return Number.isFinite(n) ? n : fallback;
      } catch {
        return fallback;
      }
    }
    if (value instanceof Int32) {
      const n = value.valueOf();
      return Number.isFinite(n) ? n : fallback;
    }
    const ext = value as { $numberLong?: unknown };
    if (typeof ext.$numberLong === "string") {
      const n = Number(ext.$numberLong);
      return Number.isFinite(n) ? n : fallback;
    }
    const perhapsLong = value as { low?: unknown; high?: unknown; unsigned?: unknown };
    if (typeof perhapsLong.low === "number" && typeof perhapsLong.high === "number") {
      try {
        const n = Long.fromValue({
          low: perhapsLong.low,
          high: perhapsLong.high,
          unsigned: typeof perhapsLong.unsigned === "boolean" ? perhapsLong.unsigned : false,
        }).toNumber();
        return Number.isFinite(n) ? n : fallback;
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}
