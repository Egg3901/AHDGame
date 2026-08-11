import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { EventEligibility } from "@/lib/db/types/events";

export interface CharacterEventContext {
  characterId: ObjectId;
  countryId: CountryId;
  isPolitician: boolean;
  isCeo: boolean;
  isInElection: boolean;
  /** CEO's share ownership fraction (0–1). Only set for CEO characters. */
  ceoOwnershipFraction?: number;
}

export function matchesEligibility(ctx: CharacterEventContext, tags: EventEligibility[]): boolean {
  if (tags.includes("all")) {
    return true;
  }
  return tags.some((tag) => {
    switch (tag) {
      case "politician":
        return ctx.isPolitician;
      case "ceo":
        return ctx.isCeo;
      case "inElection":
        return ctx.isInElection;
      case "ceoConcentrated":
        return (ctx.ceoOwnershipFraction ?? 0) > 0.65;
      case "ceoVeryConcentrated":
        return (ctx.ceoOwnershipFraction ?? 0) > 0.8;
      default:
        return false;
    }
  });
}

export function isPerKindCooldownSatisfied(
  ledger: { perKindCooldowns: Record<string, number> } | null,
  kind: string,
  currentTurn: number
): boolean {
  if (!ledger) {
    return true;
  }
  const eligibleAt = ledger.perKindCooldowns[kind];
  if (eligibleAt === undefined) {
    return true;
  }
  return currentTurn >= eligibleAt;
}
