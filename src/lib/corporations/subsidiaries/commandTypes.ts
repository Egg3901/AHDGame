/** Shared result shape for subsidiary command functions. */
export type SubsidiaryCommandResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number };

export function fail(error: string, status = 400): { ok: false; error: string; status: number } {
  return { ok: false, error, status };
}
