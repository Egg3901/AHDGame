/**
 * Ordinary Duma elections renew the chamber without rewriting the first Assembly.
 * planRussianDumaConvocation opens a full campaign near the proved term boundary;
 * russianDumaConvocationTermEnd gives later convocations their four-year mandate.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { planRussianDumaBallot } from "./assemblySchedule";

export interface RussianDumaConvocationClock {
  number: number;
  rootId: string;
  seatedOnTurn: number;
  termEndTurn: number;
}

export function validateRussianDumaConvocationClock(clock: RussianDumaConvocationClock) {
  if (
    !Number.isSafeInteger(clock.number) ||
    clock.number < 1 ||
    !clock.rootId ||
    !Number.isSafeInteger(clock.seatedOnTurn) ||
    clock.seatedOnTurn < 1 ||
    !Number.isSafeInteger(clock.termEndTurn) ||
    clock.termEndTurn <= clock.seatedOnTurn
  )
    throw new Error("Duma recurrence needs the proved current convocation clock");
  return clock;
}

export function planRussianDumaConvocation(input: {
  turn: number;
  current: RussianDumaConvocationClock;
  pendingRootId?: string;
}) {
  if (!Number.isSafeInteger(input.turn) || input.turn < 1)
    throw new Error("Duma recurrence needs a safe current turn");
  const current = validateRussianDumaConvocationClock(input.current);
  if (input.turn < current.seatedOnTurn)
    throw new Error("Duma recurrence cannot precede its seated authority");
  if (input.pendingRootId) {
    if (input.pendingRootId === current.rootId)
      throw new Error("A pending Duma cannot reuse the current root");
    return { kind: "resume" as const, rootId: input.pendingRootId };
  }
  const campaignLength = planRussianDumaBallot(input.turn).durationHours;
  if (input.turn < current.termEndTurn - campaignLength) return { kind: "wait" as const };
  const number = current.number + 1;
  if (!Number.isSafeInteger(number)) throw new Error("Duma convocation exceeds integer precision");
  return { kind: "open" as const, number, timing: planRussianDumaBallot(input.turn) };
}

/** Original constitutional Article96 gives later Dumas four years; clause7 limits only the first to two. */
export function russianDumaConvocationTermEnd(originalPollEndTurn: number, number: number) {
  if (
    !Number.isSafeInteger(originalPollEndTurn) ||
    originalPollEndTurn < 1 ||
    !Number.isSafeInteger(number) ||
    number < 1
  )
    throw new Error("Duma terms need safe original polls and convocation numbers");
  const end = originalPollEndTurn + (number === 1 ? 2 : 4) * TURNS_PER_YEAR;
  if (!Number.isSafeInteger(end)) throw new Error("Duma term exceeds integer precision");
  return end;
}

export function russianDumaConvocationOfficeCompatible(
  number: number,
  officeType: string | undefined,
  countryId: string | undefined
) {
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Duma compatibility needs a lawful convocation number");
  if (!officeType) return true;
  if (countryId !== "RU") return false;
  if (officeType === "dumaDeputy") return true;
  return (
    number === 1 && ["congressDeputy", "primeMinister", "parliamentaryCabinet"].includes(officeType)
  );
}
