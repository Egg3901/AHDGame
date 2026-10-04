/**
 * Player Council nominations occupy one association slot without removing another player.
 * planRussianCouncilPlayerAdmission replaces a bounded automatic nominee when necessary,
 * keeps independent voter groups separate and plans party changes before any write.
 */
export function planRussianCouncilPlayerAdmission(input: {
  ownerId: string;
  party: string;
  candidates: readonly {
    id: string;
    ownerId: string;
    party: string;
    isNpc: boolean;
    bounded: boolean;
    registrationOrder: number;
  }[];
}):
  | { allowed: true; withdrawIds: string[]; associationNominees: number }
  | { allowed: false; reason: "already-filed" | "association-full" } {
  if (
    !input.ownerId ||
    !input.party ||
    new Set(input.candidates.map((row) => row.id)).size !== input.candidates.length ||
    input.candidates.some(
      (row) =>
        !row.id ||
        !row.ownerId ||
        !row.party ||
        !Number.isSafeInteger(row.registrationOrder) ||
        row.registrationOrder < 0
    )
  )
    throw new Error("Council admission needs unique registered nominee identities");
  const previous = input.candidates.filter((row) => !row.isNpc && row.ownerId === input.ownerId);
  if (previous.some((row) => row.party === input.party))
    return { allowed: false, reason: "already-filed" };
  const association =
    input.party === "independent"
      ? []
      : input.candidates.filter((row) => row.party === input.party);
  const withdrawIds = previous.map((row) => row.id);
  if (association.length >= 2) {
    const automatic = association
      .filter((row) => row.isNpc && row.bounded)
      .sort((a, b) => b.registrationOrder - a.registrationOrder || b.id.localeCompare(a.id));
    if (association.length !== 2 || !automatic.length)
      return { allowed: false, reason: "association-full" };
    withdrawIds.push(automatic[0].id);
  }
  return {
    allowed: true,
    withdrawIds,
    associationNominees: association.length - (association.length >= 2 ? 1 : 0),
  };
}
