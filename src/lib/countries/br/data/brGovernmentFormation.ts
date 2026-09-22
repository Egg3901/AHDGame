import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ElectedOfficial } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

/**
 * Build the BR governmentFormations doc.
 *
 * When a president is already seated (1953-default seeds a generic PTB NPP via
 * BR_EXECUTIVE_1953), the formation starts FORMED with `presidentNppId` linked —
 * same rationale as RU's Premier link and the US executive seed. Without that
 * link, `appointNppPresident` early-returns on the seated official and never
 * stamps `presidentNppId`, leaving the NPP governing brain without a head.
 *
 * When no president is seated (other presets / vacant / priors), status stays
 * `pending` so turn-time seating can form the government.
 *
 * majorityThreshold and totalSeats match COUNTRY_CONFIGS.BR:
 *   - coalitionThreshold: 257 (513 / 2 + 1, Chamber of Deputies majority)
 *   - legislature.lowerChamber.seats: 513
 *
 * Brazil has a presidential system; the President is both head of state
 * and head of government. The National Congress comprises the Chamber of
 * Deputies (lower, 513 seats) and the Federal Senate (upper, 81 seats).
 */
export async function buildBrGovernmentFormation(
  db: Db,
  now: Date
): Promise<Omit<GovernmentFormation, "createdAt" | "updatedAt">> {
  const config = COUNTRY_CONFIGS.BR;
  const totalSeats = config.legislature.lowerChamber.seats;
  const majorityThreshold = config.coalitionThreshold;

  const president = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ countryId: "BR", officeType: "president" });

  const hasPresident = Boolean(president?.nppId || president?.characterId);

  return {
    _id: "BR",
    countryId: "BR",
    cycle: 1,
    status: hasPresident ? "formed" : "pending",
    formationType: hasPresident ? "majority" : null,
    lostMajority: false,
    pmCharacterId: null,
    pmNppId: null,
    pmName: hasPresident ? (president?.characterName ?? null) : null,
    presidentNppId: president?.nppId ?? null,
    presidentName: hasPresident ? (president?.characterName ?? null) : null,
    governingPartyId: hasPresident ? (president?.party ?? null) : null,
    coalitionId: null,
    coalitionPartyIds: null,
    // Chamber may still be vacant at seed time (1953 democracies start vacant).
    totalSeatsSupporting: 0,
    majorityThreshold,
    seatsByParty: {},
    totalSeats,
    activeVoteId: null,
    formedAt: hasPresident ? now : null,
    formedTurn: hasPresident ? 1 : null,
    collapsedAt: null,
  };
}
