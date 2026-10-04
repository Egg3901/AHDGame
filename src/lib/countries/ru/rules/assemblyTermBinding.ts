/**
 * First-Assembly repeats stay inside their ratified original chamber terms.
 * validateRussianAssemblyRepeatTerm permits pre-handover polls and proven
 * seated-family vacancies while rejecting bare activation or seating markers.
 */
export interface RussianAssemblyTermProof {
  id: string;
  preset: string;
  countryId: string;
  dumaRootId: string;
  councilRootId: string;
  seatedOnTurn: number;
  dumaTermEndTurn: number;
  councilTermEndTurn: number;
}
export function validateRussianAssemblyRepeatTerm(input: {
  turn: number;
  electionEndTurn?: number;
  chamber: "duma" | "council";
  assemblySinceTurn?: number;
  dumaRootId?: string;
  councilRootId?: string;
  previousSeatedOnTurn?: number;
  previousSeatingProven?: boolean;
  proof?: RussianAssemblyTermProof;
}) {
  if (!Number.isSafeInteger(input.turn) || input.turn < 1)
    throw new Error("Assembly repeats need a safe current turn");
  if (input.assemblySinceTurn == null) {
    if (input.previousSeatedOnTurn != null)
      throw new Error("An unactivated Assembly cannot have seated predecessors");
    return { stage: "pending" as const, termEndTurn: undefined };
  }
  const proof = input.proof;
  if (
    !Number.isSafeInteger(input.assemblySinceTurn) ||
    input.assemblySinceTurn < 1 ||
    input.assemblySinceTurn > input.turn ||
    !input.dumaRootId ||
    !input.councilRootId ||
    !proof ||
    proof.id !== `${input.dumaRootId}:${input.councilRootId}` ||
    proof.preset !== "1991-default" ||
    proof.countryId !== "RU" ||
    proof.dumaRootId !== input.dumaRootId ||
    proof.councilRootId !== input.councilRootId ||
    proof.seatedOnTurn !== input.assemblySinceTurn
  )
    throw new Error("Assembly repeats require the actual seated root family");
  for (const end of [proof.dumaTermEndTurn, proof.councilTermEndTurn])
    if (!Number.isSafeInteger(end) || end <= proof.seatedOnTurn)
      throw new Error("Assembly term proof has unsafe original clocks");
  const termEndTurn = input.chamber === "duma" ? proof.dumaTermEndTurn : proof.councilTermEndTurn;
  if (
    input.turn >= termEndTurn ||
    (input.electionEndTurn != null &&
      (!Number.isSafeInteger(input.electionEndTurn) ||
        input.electionEndTurn < input.turn ||
        input.electionEndTurn >= termEndTurn))
  )
    throw new Error("Assembly repeat exceeds its original chamber term");
  if (
    input.previousSeatedOnTurn != null &&
    (!Number.isSafeInteger(input.previousSeatedOnTurn) ||
      input.previousSeatedOnTurn < proof.seatedOnTurn ||
      input.previousSeatedOnTurn > input.turn ||
      !input.previousSeatingProven)
  )
    throw new Error("Assembly predecessor seating needs its actual receipt");
  return { stage: "seated" as const, termEndTurn };
}
