/** Articles72 and73 govern the founding constituency vote, independently of list votes. */
export interface BgFoundingMajorityOption {
  personId: string;
  votes: number;
  /** Frozen public lot order resolves an exact vote tie without a new random draw. */
  tieOrder: number;
}
export interface BgFoundingMajorityBallot {
  registeredVoters: number;
  ballotsCast: number;
  invalidBallots: number;
  options: readonly BgFoundingMajorityOption[];
}
export type BgFoundingMajorityResult =
  | { kind: "elected"; personId: string }
  | { kind: "runoff"; personIds: string[]; allowNewNominations: boolean }
  | { kind: "repeat"; reason: "no-votes" };

function validate(ballot: BgFoundingMajorityBallot) {
  const { registeredVoters, ballotsCast, invalidBallots, options } = ballot;
  if (
    [registeredVoters, ballotsCast, invalidBallots].some(
      (value) => !Number.isSafeInteger(value) || value < 0
    ) ||
    registeredVoters < 1 ||
    ballotsCast > registeredVoters ||
    invalidBallots > ballotsCast ||
    new Set(options.map((row) => row.personId)).size !== options.length ||
    new Set(options.map((row) => row.tieOrder)).size !== options.length ||
    options.some(
      (row) =>
        !row.personId ||
        !Number.isSafeInteger(row.votes) ||
        row.votes < 0 ||
        !Number.isSafeInteger(row.tieOrder) ||
        row.tieOrder < 1
    )
  )
    throw new Error("Invalid Bulgarian founding majority ballot");
  const valid = options.reduce((sum, row) => sum + BigInt(row.votes), BigInt(0));
  if (valid + BigInt(invalidBallots) !== BigInt(ballotsCast))
    throw new Error("Bulgarian founding vote accounting is incomplete");
  return {
    valid,
    ranked: [...options].sort((a, b) => b.votes - a.votes || a.tieOrder - b.tieOrder),
  };
}

export function resolveBgFoundingFirstRound(
  ballot: BgFoundingMajorityBallot
): BgFoundingMajorityResult {
  const { valid, ranked } = validate(ballot);
  if (
    ranked[0] &&
    BigInt(ballot.ballotsCast) * BigInt(2) > BigInt(ballot.registeredVoters) &&
    BigInt(ranked[0].votes) * BigInt(2) > valid
  )
    return { kind: "elected", personId: ranked[0].personId };
  return {
    kind: "runoff",
    personIds: ranked.slice(0, 2).map((row) => row.personId),
    allowNewNominations: ranked.length <= 1,
  };
}

export function resolveBgFoundingRunoff(
  first: BgFoundingMajorityBallot,
  second: BgFoundingMajorityBallot
): BgFoundingMajorityResult {
  const pending = resolveBgFoundingFirstRound(first);
  if (pending.kind !== "runoff") throw new Error("Bulgarian constituency has no pending runoff");
  if (second.registeredVoters !== first.registeredVoters)
    throw new Error("Bulgarian runoff changes its frozen register");
  const { ranked } = validate(second);
  if (
    !pending.allowNewNominations &&
    second.options.some((row) => !pending.personIds.includes(row.personId))
  )
    throw new Error("Bulgarian runoff includes an unqualified nominee");
  for (const row of second.options) {
    const original = first.options.find((prior) => prior.personId === row.personId);
    if (original && row.tieOrder !== original.tieOrder)
      throw new Error("Bulgarian runoff changes its frozen tie order");
  }
  if (!ranked[0] || ranked[0].votes === 0) return { kind: "repeat", reason: "no-votes" };
  return { kind: "elected", personId: ranked[0].personId };
}
