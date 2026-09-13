import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryAccessFromDb } from "@/lib/countryAccess";
import {
  getOrganizationFundsCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import {
  DEFAULT_ORG_DUES_RATE_ANNUAL,
  GDP_MILLIONS_TO_USD,
  orgTributeRateAnnual,
} from "@/lib/constants/internationalOrganizations";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { memberDueUsd } from "@/lib/internationalOrganizations/organizationFund";
import { loadUsdGdpByCountry } from "@/lib/internationalOrganizations/countryGdp";

export type OrganizationContributionKind = "dues" | "tribute";

export interface OrganizationContributionLine {
  organizationId: string;
  kind: OrganizationContributionKind;
  /** Treasury debit per turn in the member country's local currency. */
  perTurn: number;
}

export interface OrganizationContributionPosition {
  /** Sum of all recurring organization treasury debits per turn. */
  perTurn: number;
  lines: OrganizationContributionLine[];
}

/**
 * Price one organization's recurring contribution in the member country's
 * local currency. The turn phase uses this same GDP, rate and currency path
 * before debiting the treasury.
 */
export function organizationContributionPerTurn(args: {
  countryId: CountryId;
  gdpUsdMillions: number;
  rateAnnual: number;
  preset: string;
}): number {
  if (!(args.gdpUsdMillions > 0) || !(args.rateAnnual > 0)) return 0;
  const dueUsd = memberDueUsd(args.gdpUsdMillions * GDP_MILLIONS_TO_USD, args.rateAnnual);
  if (!(dueUsd > 0) || !Number.isFinite(dueUsd)) return 0;
  return Math.round(dueUsd / getGdpAnchorRate(args.countryId, args.preset));
}

/**
 * Read the recurring organization contributions that the turn phase will
 * debit from one country's treasury.
 *
 * Player-enabled countries pay each member-voted dues rate. Non-enabled
 * members pay tribute only in the two armed blocs and only in a 1953 world.
 * This is deliberately a read-only mirror: the turn phase remains the sole
 * writer of treasury balances and organization funds.
 */
export async function loadOrganizationContributions(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<OrganizationContributionPosition> {
  const membershipsCollection = await getOrganizationMembershipsCollection(db);
  const memberships = await membershipsCollection
    .find({ countryId }, { projection: { organizationId: 1 } })
    .toArray();
  const organizationIds = [...new Set(memberships.map((m) => m.organizationId))];
  if (organizationIds.length === 0) return { perTurn: 0, lines: [] };

  const activePreset = preset ?? (await loadWorldPreset(db));
  const fundsCollection = await getOrganizationFundsCollection(db);
  const [access, gdpByCountry, fundRows] = await Promise.all([
    getCountryAccessFromDb(db, countryId),
    loadUsdGdpByCountry(db, [countryId], activePreset),
    fundsCollection
      .find({ organizationId: { $in: organizationIds } })
      .project({ organizationId: 1, duesRateAnnual: 1 })
      .toArray(),
  ]);
  const gdpUsdMillions = gdpByCountry.get(countryId) ?? 0;
  if (!(gdpUsdMillions > 0) || !Number.isFinite(gdpUsdMillions)) {
    return { perTurn: 0, lines: [] };
  }

  const duesRateByOrganization = new Map(
    fundRows.map((row) => [row.organizationId, row.duesRateAnnual] as const)
  );
  const lines: OrganizationContributionLine[] = [];

  for (const organizationId of organizationIds) {
    const tributeRateAnnual = orgTributeRateAnnual(organizationId, activePreset);
    // The turn phase uses tribute only for non-enabled members of an armed
    // bloc in a 1953 world. Non-enabled members of every other organization
    // still pay ordinary dues; that is the post-#1156 partition.
    const paysTribute = !access.enabledForPlayers && tributeRateAnnual > 0;
    const kind: OrganizationContributionKind = paysTribute ? "tribute" : "dues";
    const rateAnnual = paysTribute
      ? tributeRateAnnual
      : (duesRateByOrganization.get(organizationId) ?? DEFAULT_ORG_DUES_RATE_ANNUAL);
    if (!(rateAnnual > 0)) continue;

    const perTurn = organizationContributionPerTurn({
      countryId,
      gdpUsdMillions,
      rateAnnual,
      preset: activePreset,
    });
    if (perTurn > 0) lines.push({ organizationId, kind, perTurn });
  }

  return {
    perTurn: lines.reduce((sum, line) => sum + line.perTurn, 0),
    lines,
  };
}
