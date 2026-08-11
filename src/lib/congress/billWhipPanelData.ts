import type { Db, ObjectId } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId, getPartyIdString } from "@/lib/db/partyLookup";
import type {
  Bill,
  BillWhip,
  ElectedOfficial,
  PoliticalParty,
  WhipIssuerRole,
} from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getChamberLeaderRole } from "@/lib/partyWhips/constraints";

const WHIP_ISSUER_ROLE_LABELS: Record<WhipIssuerRole, string> = {
  chair: "Chair",
  viceChair: "Vice Chair",
  admin: "Admin",
  speaker: "Speaker",
  majorityLeader: "Majority Leader",
  minorityLeader: "Minority Leader",
  majorityWhip: "Majority Whip",
  minorityWhip: "Minority Whip",
};

export interface BillWhipSummary {
  existingWhips: Array<{ direction: string; attemptNumber: number; issuedByRole?: string }>;
  canWhip: boolean;
}

export interface BillWhipPanelChamber {
  chamberKey: string;
  chamberLabel: string;
  playerWhip: BillWhipSummary;
  nppWhip: BillWhipSummary;
}

export interface BillWhipPanelData {
  party: {
    id: string;
    name: string;
    color: string;
  };
  chambers: BillWhipPanelChamber[];
}

interface BillWhipViewerContext {
  characterId: ObjectId | null;
  partyId: string | null;
  /** The viewer's own character country. Party sequentialIds collide across
   *  countries, so the panel must only render when this matches the bill's
   *  country — otherwise a foreign viewer's party resolves to an unrelated
   *  same-seqId party in the bill's country. */
  viewerCountryId: CountryId | null;
  isAdmin: boolean;
}

const ACTIONABLE_BILL_STATUSES = new Set([
  "active",
  "active_other",
  "veto_override",
  "override_shugiin",
]);

export function resolveWhipIssuerRole(
  whip: Pick<BillWhip, "issuedByCharacterId" | "issuedByRole">,
  party: Pick<PoliticalParty, "chairId" | "viceChairId">
): string | undefined {
  // Prefer the role stamped on the whip when it was issued — this covers
  // chamber leaders (Speaker / Floor Leader / Whip), not just the party chair.
  // Fall back to party-office inference for legacy whips predating issuedByRole.
  if (whip.issuedByRole) return WHIP_ISSUER_ROLE_LABELS[whip.issuedByRole];
  const issuerId = whip.issuedByCharacterId;
  if (!issuerId) return undefined;
  if (party.chairId?.equals(issuerId)) return "Chair";
  if (party.viceChairId?.equals(issuerId)) return "Vice Chair";
  return "Admin";
}

function buildSummary(
  whips: BillWhip[],
  maxAttempts: number,
  party: Pick<PoliticalParty, "chairId" | "viceChairId">
): BillWhipSummary {
  const existingWhips = whips
    .map((whip) => ({
      direction: whip.direction,
      attemptNumber: whip.attemptNumber,
      issuedByRole: resolveWhipIssuerRole(whip, party),
    }))
    .sort((left, right) => left.attemptNumber - right.attemptNumber);

  return {
    existingWhips,
    canWhip: existingWhips.length < maxAttempts,
  };
}

export async function buildBillWhipPanelData(
  db: Db,
  bill: Bill,
  countryId: CountryId,
  viewer: BillWhipViewerContext
): Promise<BillWhipPanelData | null> {
  if (!ACTIONABLE_BILL_STATUSES.has(bill.status)) return null;
  if (!viewer.characterId || !viewer.partyId) return null;
  // Cross-country guard: only whip on bills in your own country's legislature.
  // (Foreign viewers' party sequentialIds collide with bill-country parties.)
  if (viewer.viewerCountryId !== countryId) return null;

  const party = await findPartyBySequentialId(db, viewer.partyId, countryId);
  if (!party) return null;

  const config = getCountryConfig(countryId);
  const chamberOptions = [
    config.legislature.lowerChamber,
    ...(config.upperElectionSystem && config.legislature.upperChamber
      ? [config.legislature.upperChamber]
      : []),
  ];
  const activeChambers =
    bill.status === "veto_override"
      ? chamberOptions.map((chamber) => chamber.key)
      : chamberOptions
          .filter((chamber) => chamber.key === bill.currentChamber)
          .map((chamber) => chamber.key);

  if (activeChambers.length === 0) return null;

  const partyIdStr = getPartyIdString(party);

  // Access gate. Party Chair/Vice-Chair and admins can always whip. Chamber
  // leaders (Speaker / Floor Leader / Whip) can whip in the chamber(s) they
  // lead: the backend whip route already authorizes them, but this panel
  // historically only rendered for party officers, so whip officers could
  // never reach the UI (bug: scaffolded, never wired into the client).
  const isChair = party.chairId?.equals(viewer.characterId);
  const isViceChair = party.viceChairId?.equals(viewer.characterId);
  if (!viewer.isAdmin && !isChair && !isViceChair) {
    let isChamberLeader = false;
    for (const chamber of activeChambers) {
      if (await getChamberLeaderRole(db, viewer.characterId, chamber, partyIdStr)) {
        isChamberLeader = true;
        break;
      }
    }
    if (!isChamberLeader) return null;
  }
  // Resolve each chamber key to the office type its members are stored under
  // (CN: "npc" → "npcDelegate"; identity elsewhere). Querying the raw chamber
  // key matched no CN delegates, so the CN bill whip panel never rendered.
  const officeTypeByChamberKey = new Map(
    activeChambers.map((key) => [key, getOfficeTypeForChamber(countryId, key)])
  );
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      // Country-scoped: party sequentialIds collide across countries and some
      // office types (e.g. "senate") are shared between countries (bug #0699).
      countryId,
      party: partyIdStr,
      officeType: { $in: [...officeTypeByChamberKey.values()] },
    })
    .project({ officeType: 1 })
    .toArray();

  // Map matched office types back to their chamber keys so the chamber filter
  // below (which compares chamber.key) works for CN too.
  const partyMemberOfficeTypes = new Set(officials.map((official) => official.officeType));
  const chambersWithPartyMembers = new Set(
    activeChambers.filter((key) => partyMemberOfficeTypes.has(officeTypeByChamberKey.get(key)!))
  );
  if (chambersWithPartyMembers.size === 0) return null;

  const whips = await db
    .collection<BillWhip>("billWhips")
    .find({
      targetType: "bill",
      targetId: bill._id,
      partyId: partyIdStr,
      issuedBy: "nationalParty",
      chamber: { $in: activeChambers },
    })
    .toArray();

  const chambers = chamberOptions
    .filter(
      (chamber) => activeChambers.includes(chamber.key) && chambersWithPartyMembers.has(chamber.key)
    )
    .map((chamber) => {
      const chamberWhips = whips.filter((whip) => whip.chamber === chamber.key);
      return {
        chamberKey: chamber.key,
        chamberLabel: chamber.shortName,
        playerWhip: buildSummary(
          chamberWhips.filter((whip) => whip.audience === "character"),
          1,
          party
        ),
        nppWhip: buildSummary(
          chamberWhips.filter((whip) => whip.audience !== "character"),
          2,
          party
        ),
      };
    });

  if (chambers.length === 0) return null;

  return {
    party: {
      id: partyIdStr,
      name: party.name,
      color: getPartyHex(partyIdStr, party.color),
    },
    chambers,
  };
}
