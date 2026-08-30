export type ParsedQueryValue<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseBoundedInt(
  raw: string | null,
  options: { name: string; defaultValue: number; min: number; max: number }
): ParsedQueryValue<number> {
  if (raw === null || raw === "") return { ok: true, value: options.defaultValue };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: `${options.name} must be an integer` };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    return {
      ok: false,
      message: `${options.name} must be between ${options.min} and ${options.max}`,
    };
  }
  return { ok: true, value };
}
