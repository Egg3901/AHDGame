import type { Db } from "mongodb";
import { createNotifications } from "@/lib/notifications";
import type { CountryConfig } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import type { Bill, Character } from "@/lib/db/types";
import type { BillLifecycleConfig, SponsorNotifier } from "../types";

const VOTING_HOURS = 24;

/**
 * Build the one-party sponsor notifier. Reproduces the legacy one-party
 * `notifySponsor` copy: `signed`/`failed` reference the lower-chamber short name;
 * `active_other` (the bicameral crossover, RU) uses the legacy chamber-neutral
 * crossover copy — a bill can originate in either chamber, so naming one would
 * be wrong half the time.
 */
function makeOnePartyNotifier(lowerLabel: string): SponsorNotifier {
  return async (db: Db, bill: Bill, status: Bill["status"]) => {
    if (status !== "signed" && status !== "failed" && status !== "active_other") return;
    if (!bill.sponsorId) return;
    try {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (!sponsor) return;

      const message =
        status === "signed"
          ? `Your bill "${bill.title}" has been enacted by the ${lowerLabel}.`
          : status === "failed"
            ? `Your bill "${bill.title}" has failed to pass the ${lowerLabel}.`
            : `Your bill "${bill.title}" passed its origin chamber and moves to the other chamber of the legislature.`;

      await createNotifications([
        {
          userId: sponsor.userId,
          type:
            status === "signed"
              ? "bill_signed"
              : status === "failed"
                ? "bill_failed_chamber"
                : "bill_passed_chamber",
          title:
            status === "signed"
              ? "Bill Enacted"
              : status === "failed"
                ? "Bill Failed"
                : "Bill Advances",
          message,
          metadata: { billId: bill._id.toString() },
        },
      ]);
    } catch {
      // Non-critical — don't halt processing.
    }
  };
}

/**
 * Build the bill-resolution config for a one-party state.
 *
 * - **Unicameral** (CN): single lower-chamber vote → immediate enactment on pass,
 *   failed on reject.
 * - **Bicameral** (RU: `legislature.bicameral` + `upperElectionSystem`): a bill
 *   must clear BOTH Supreme Soviet chambers (D8/D9 crossover). It starts in its
 *   origin chamber (`active`), crosses to the sibling chamber (`active_other`),
 *   and enacts only if the second chamber also approves; a second-chamber
 *   rejection kills it (no override chamber in a one-party state).
 *
 * One-party pass rule is always simple majority (nat/priv never escalates to
 * two-thirds in a one-party state), applied by the engine evaluator. Regime
 * mechanics live in the one-party orchestrator that calls the engine; the engine
 * resolves the bills (scoped + snapshotted, #0836/#0982) and returns the enacted
 * categories the drifts consume.
 */
export function buildOnePartyBillConfig(config: CountryConfig): BillLifecycleConfig {
  const lowerKey = config.legislature.lowerChamber.key;
  const upperKey =
    config.legislature.bicameral && config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
  const lowerLabel = config.legislature.lowerChamber.shortName;
  // CN's chamber key "npc" maps to officeType "npcDelegate" — must round-trip.
  const officeTypeFor = (b: { currentChamber: string }) =>
    getOfficeTypeForChamber(config.id, b.currentChamber);

  if (upperKey) {
    // Bicameral crossover: origin chamber → sibling chamber → enact.
    return {
      country: config.id,
      level: "national",
      originChambers: [lowerKey, upperKey],
      notifySponsor: makeOnePartyNotifier(lowerLabel),
      stages: [
        {
          kind: "chamberVote",
          status: "active",
          voteField: "votes",
          officeTypeFor,
          passRule: "simpleMajority",
          onReject: "fail",
          onPassStatus: "active_other",
          votingDurationHours: VOTING_HOURS,
        },
        {
          kind: "chamberVote",
          status: "active_other",
          voteField: "otherChamberVotes",
          officeTypeFor,
          passRule: "simpleMajority",
          onReject: "fail",
          onPassStatus: "signed",
          votingDurationHours: VOTING_HOURS,
          // Crossover: send to the chamber the bill did NOT originate in.
          chamberOnEnter: (b) => (b.currentChamber === lowerKey ? upperKey : lowerKey),
        },
      ],
    };
  }

  return {
    country: config.id,
    level: "national",
    originChambers: [lowerKey],
    notifySponsor: makeOnePartyNotifier(lowerLabel),
    stages: [
      {
        kind: "chamberVote",
        status: "active",
        voteField: "votes",
        officeTypeFor,
        passRule: "simpleMajority",
        onReject: "fail",
        onPassStatus: "signed",
        votingDurationHours: VOTING_HOURS,
      },
    ],
  };
}
