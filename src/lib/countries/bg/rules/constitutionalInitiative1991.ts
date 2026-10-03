/** A quarter of Bulgaria's constituent deputies may introduce a constitution draft. */
export function bg1991InitiativeSupport(
  officials: { actor: string; seats: number; human: boolean }[],
  signatures: string[],
  capacity: number
) {
  if (capacity !== 400) throw new Error("The initiative needs the 400-seat constituent Assembly");
  const mandates = new Map<string, number>();
  let seated = 0;
  for (const official of officials) {
    if (
      !official.actor ||
      !Number.isSafeInteger(official.seats) ||
      official.seats < 0 ||
      (official.human && (official.seats > 1 || mandates.has(official.actor)))
    )
      throw new Error("Invalid constituent mandate custody");
    seated += official.seats;
    if (seated > capacity) throw new Error("Constituent mandates exceed chamber capacity");
    mandates.set(official.actor, (mandates.get(official.actor) ?? 0) + official.seats);
  }
  const support = [...new Set(signatures)].reduce(
    (total, actor) => total + (mandates.get(actor) ?? 0),
    0
  );
  return { support, required: capacity / 4, canIntroduce: support >= capacity / 4 };
}
