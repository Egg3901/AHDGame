/**
 * Role lookups for the per-turn action and national-influence refresh that do
 * not live on `character.currentOffice`: opposition front benches, Nigerian
 * presiding officers, state party chairs and corporate CEOs.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types/corporation";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { LeadershipRole } from "@/lib/db/types/leadership";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import type { CeoNiTier } from "@/lib/actions/positionNiBonus";
import { loadOrganizationHeads } from "@/lib/internationalOrganizations/orgHeadAgenda";
import { resolveOppositionLeaderForCountry } from "@/lib/parliament/oppositionLeader";

/** CEOs of the largest listed corporations in a country earn the major tier. */
export const MAJOR_CEO_RANK = 10;
/**
 * Any other qualifying corporation must be listed and rank in the top half of
 * its country's listed corporations by market cap, so a shell cannot qualify.
 */
export const CEO_MARKET_CAP_TOP_FRACTION = 0.5;
/** Turns a character must have led the same corporation before it earns NI. */
export const CEO_NI_TENURE_TURNS = 12;

/** Turn a character was first seen running the corporation that earns CEO NI. */
export interface CeoNiTenure {
  corporationId: string;
  sinceTurn: number;
}

export interface OppositionRoles {
  leaderIds: Set<string>;
  shadowCabinetIds: Set<string>;
}

/**
 * Leaders of the Opposition and their shadow cabinets. A shadow cabinet only
 * counts while its party is the one the Leader of the Opposition leads, so a
 * stale bench left on a party that has since entered government earns nothing.
 */
export async function loadOppositionRoles(db: Db): Promise<OppositionRoles> {
  const [formations, governments] = await Promise.all([
    db
      .collection<GovernmentFormation>("governmentFormations")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray(),
    db
      .collection<ParliamentaryGovernment>("parliamentaryGovernments")
      .find({}, { projection: { _id: 1 } })
      .toArray(),
  ]);
  const countries = new Set<CountryId>([
    ...formations.map((f) => (f.countryId ?? f._id) as CountryId),
    ...governments.map((g) => g._id as CountryId),
  ]);
  const leaderIds = new Set<string>();
  const shadowCabinetIds = new Set<string>();
  for (const countryId of countries) {
    const opposition = await resolveOppositionLeaderForCountry(db, countryId);
    if (!opposition) continue;
    leaderIds.add(opposition.chairId.toString());
    for (const appointment of Object.values(opposition.partyDoc?.shadowCabinet ?? {})) {
      if (appointment?.characterId) shadowCabinetIds.add(appointment.characterId.toString());
    }
  }
  return { leaderIds, shadowCabinetIds };
}

/**
 * Nigerian presiding officers are written to `electedOfficials` rather than
 * `congressLeaders`; map them back onto their leadership roles.
 */
export async function loadPresidingOfficerRoles(
  db: Db
): Promise<{ characterId: ObjectId; role: LeadershipRole }[]> {
  const rows = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { officeType: { $in: ["speaker", "senatePresident"] }, characterId: { $ne: null } },
      { projection: { characterId: 1, officeType: 1 } }
    )
    .toArray();
  return rows.flatMap((row) =>
    row.characterId
      ? [
          {
            characterId: row.characterId,
            role: (row.officeType === "speaker"
              ? "speaker_ng_reps"
              : "president_ng_senate") as LeadershipRole,
          },
        ]
      : []
  );
}

/** Character ids of every seated state party chair. */
export async function loadStatePartyChairIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ chairId: { $ne: null } }, { projection: { chairId: 1 } })
    .toArray();
  return new Set(rows.flatMap((r) => (r.chairId ? [r.chairId.toString()] : [])));
}

/**
 * Character ids leading an international organisation: elected seats plus the
 * permanent leaders (e.g. the UK head of government heads the Commonwealth).
 */
export async function loadOrgHeadIds(db: Db): Promise<Set<string>> {
  const heads = await loadOrganizationHeads(db);
  return new Set(heads.map((head) => head.characterId.toString()));
}

export interface CeoCandidate {
  corporationId: string;
  tier: CeoNiTier;
}

/**
 * The best NI-qualifying corporation each player CEO runs. Only listed
 * (non-private) corporations with a character CEO count; ranking is by market
 * cap within the corporation's country.
 */
export async function loadCeoCandidates(db: Db): Promise<Map<string, CeoCandidate>> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      { isPrivate: { $ne: true }, imfInstitution: { $ne: true } },
      { projection: { _id: 1, countryId: 1, ceoId: 1, ceoType: 1, sharePrice: 1, totalShares: 1 } }
    )
    .toArray();
  const byCountry = new Map<string, typeof corps>();
  for (const corp of corps) {
    const list = byCountry.get(corp.countryId) ?? [];
    list.push(corp);
    byCountry.set(corp.countryId, list);
  }
  const best = new Map<string, CeoCandidate>();
  for (const list of byCountry.values()) {
    const ranked = [...list].sort(
      (a, b) =>
        (b.sharePrice ?? 0) * (b.totalShares ?? 0) - (a.sharePrice ?? 0) * (a.totalShares ?? 0)
    );
    const qualifyingCount = Math.ceil(ranked.length * CEO_MARKET_CAP_TOP_FRACTION);
    ranked.slice(0, qualifyingCount).forEach((corp, index) => {
      if (corp.ceoType && corp.ceoType !== "character") return;
      if (!corp.ceoId) return;
      const tier: CeoNiTier = index < MAJOR_CEO_RANK ? "major" : "standard";
      const ceoId = corp.ceoId.toString();
      const existing = best.get(ceoId);
      if (!existing || (existing.tier === "standard" && tier === "major")) {
        best.set(ceoId, { corporationId: corp._id.toString(), tier });
      }
    });
  }
  return best;
}

/**
 * Resolve this turn's CEO NI tier and the tenure stamp to persist. Tenure
 * restarts whenever the qualifying corporation changes, so moving between
 * corporations cannot skip the wait.
 */
export function resolveCeoNiTier(
  candidate: CeoCandidate | undefined,
  tenure: CeoNiTenure | undefined,
  currentTurn: number
): { tier: CeoNiTier | null; tenure: CeoNiTenure | null } {
  if (!candidate) return { tier: null, tenure: null };
  const nextTenure =
    tenure && tenure.corporationId === candidate.corporationId
      ? tenure
      : { corporationId: candidate.corporationId, sinceTurn: currentTurn };
  const qualified = currentTurn - nextTenure.sinceTurn >= CEO_NI_TENURE_TURNS;
  return { tier: qualified ? candidate.tier : null, tenure: nextTenure };
}
