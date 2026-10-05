/**
 * Split one already-paid treasury claim category across its lawful claimants.
 * This neither issues debt nor creates new authority. BigInt intermediates
 * preserve exact unit accounting for yen-sized 1991 claim pools.
 */
export function allocatePaidAuthority(
  paid: number,
  claims: readonly { id: string; due: number }[]
): Record<string, number> {
  if (!Number.isSafeInteger(paid) || paid < 0) {
    throw new Error("Paid authority must be a nonnegative safe integer");
  }
  const ids = new Set<string>();
  let totalDue = 0;
  for (const claim of claims) {
    if (!claim.id || ids.has(claim.id) || !Number.isSafeInteger(claim.due) || claim.due < 0) {
      throw new Error("Invalid treasury claim roster");
    }
    ids.add(claim.id);
    totalDue += claim.due;
    if (!Number.isSafeInteger(totalDue)) throw new Error("Treasury claim total exceeds safe units");
  }
  if (paid > totalDue) throw new Error("Paid authority exceeds the claims in its category");
  if (totalDue === 0) return Object.fromEntries(claims.map((claim) => [claim.id, 0]));

  const divisor = BigInt(totalDue);
  const rows = claims.map((claim) => {
    const numerator = BigInt(paid) * BigInt(claim.due);
    return {
      id: claim.id,
      due: claim.due,
      paid: Number(numerator / divisor),
      remainder: numerator % divisor,
    };
  });
  let residual = paid - rows.reduce((sum, row) => sum + row.paid, 0);
  rows.sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1
  );
  for (const row of rows) {
    if (residual === 0) break;
    if (row.paid >= row.due) continue;
    row.paid += 1;
    residual -= 1;
  }
  if (residual !== 0) throw new Error("Treasury authority split did not reconcile");
  return Object.fromEntries(rows.map((row) => [row.id, row.paid]));
}
