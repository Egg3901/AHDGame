import type { Db } from "mongodb";
import {
  loadOrganizationSummaries,
  ensureFoundingMembershipsAndLeadership,
} from "@/lib/internationalOrganizations/service";
import {
  DEFAULT_ORG_DUES_RATE_ANNUAL,
  GDP_MILLIONS_TO_USD,
  INTERNATIONAL_ORGANIZATIONS,
  ORG_PROPOSAL_VOTING_TURNS,
  orgTributeRateAnnual,
} from "@/lib/constants/internationalOrganizations";
import { isIntOrgAlignmentEnabled } from "@/lib/alignment/featureFlag";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import { computeOrgDerived } from "@/lib/internationalOrganizations/orgDerivedMetrics";
import {
  getOrganizationFundsCollection,
  getOrganizationPosturesCollection,
} from "@/lib/db/collections";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { DEFAULT_ALERT_POSTURE } from "@/lib/constants/orgPosture";
import type { FederalBudget } from "@/lib/db/types";
import { getAllCountryAccess } from "@/lib/countryAccess";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import { loadUsdGdpByCountry } from "@/lib/internationalOrganizations/countryGdp";
import {
  loadGdpUsdMillionsByEntity,
  loadWorldGdpUsdMillions,
} from "@/lib/internationalOrganizations/entityGdp";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import {
  defenseSharePct,
  defenseSharePctFromMacroSectors,
} from "@/lib/internationalOrganizations/defensePledge";
import { loadBlocWarEntryStatusByDisplayOrg } from "@/lib/internationalOrganizations/warEntryStatus";

// Re-exported from its own module: `entityGdp` builds on it, and this view
// builds on `entityGdp`. Kept exported here so existing callers are unaffected.
export { loadUsdGdpByCountry };

export async function loadWorldOrganizationsView(db: Db) {
  await ensureFoundingMembershipsAndLeadership(db);
  const [summaries, currentTurn, alignmentFlag] = await Promise.all([
    loadOrganizationSummaries(db),
    getCurrentTurn(db),
    db
      .collection<{ intOrgAlignmentEnabled?: boolean }>("gameState")
      .findOne({ _id: "current" } as never, { projection: { intOrgAlignmentEnabled: 1 } }),
  ]);

  // Derived metrics are GDP-weighted across the WHOLE membership, not just the
  // countries with a CountryConfig: a macro-tier member has a real economy and
  // belongs in its bloc's weight. Background Nations have none modelled at all,
  // so they simply do not appear in the map and are left out of the weighting
  // rather than dragged in as zeroes.
  const allMembers = new Set<CountryId>();
  const allEntities = new Set<OrgMemberId>();
  for (const s of summaries) {
    for (const m of s.members) {
      allEntities.add(m.countryId);
      if (m.countryId in COUNTRY_CONFIGS) allMembers.add(m.countryId as CountryId);
    }
  }
  const preset = await loadWorldPreset(db);
  const warEntryByOrg = await loadBlocWarEntryStatusByDisplayOrg(db, summaries, preset);
  // Entity-wide throughout. `loadUsdGdpByCountry` used to be called here as
  // well, for a country-only member table; `loadGdpUsdMillionsByEntity` is a
  // superset of it (it starts from the same query and adds macro entities), so
  // keeping both would have been two reads for one answer.
  // One read for the whole sweep: the dues/tribute split needs it per org, and
  // `getAllCountryAccess` is two round-trips.
  const [access, gdpByEntity, worldGdpMillions] = await Promise.all([
    getAllCountryAccess(db),
    loadGdpUsdMillionsByEntity(db, [...allEntities], preset),
    loadWorldGdpUsdMillions(db, preset),
  ]);

  const fundsCol = await getOrganizationFundsCollection(db);
  const fundRows = await fundsCol.find({}).toArray();
  const fundByOrg = new Map(fundRows.map((f) => [f.organizationId, f] as const));

  const postureCol = await getOrganizationPosturesCollection(db);
  const postureRows = await postureCol.find({}).toArray();
  const postureByOrg = new Map(postureRows.map((p) => [p.organizationId, p.posture] as const));

  // Real defense-spending share per member (security flagship's 2%-of-GDP
  // pledge). Playable countries: federal defense outlay / national GDP — both
  // local, so the exchange rate cancels. The outlay uses the same enacted →
  // baseline cascade as the defense appropriation, so a country whose enacted
  // line is still empty is not silently unrated. Macro-tier members have no
  // federalBudget; their defense-sector share of capacity fills the gap.
  const defensePctByCountry = new Map<string, number>();
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ countryId: { $in: [...allMembers] } })
    .project<Pick<FederalBudget, "countryId" | "gdp" | "spending" | "baselineSpendingByCategory">>({
      countryId: 1,
      gdp: 1,
      "spending.byCategory.defense": 1,
      "baselineSpendingByCategory.defense": 1,
    })
    .toArray();
  for (const b of budgets) {
    const gdp = b.gdp ?? 0;
    const pct = defenseSharePct(
      resolveDefenseLineFrom({
        spending: b.spending,
        baselineSpendingByCategory: b.baselineSpendingByCategory,
        gdp,
      }),
      gdp
    );
    if (pct !== undefined) defensePctByCountry.set(b.countryId, pct);
  }

  const unratedEntities = [...allEntities].filter((id) => !defensePctByCountry.has(id));
  if (unratedEntities.length > 0) {
    const macros = await (
      await getMacroCountriesCollection(db)
    )
      .find({ entityId: { $in: unratedEntities } })
      .toArray();
    for (const macro of macros) {
      if (defensePctByCountry.has(macro.entityId)) continue;
      const pct = defenseSharePctFromMacroSectors(macro.sectors);
      if (pct !== undefined) defensePctByCountry.set(macro.entityId, pct);
    }
  }

  const organizations = summaries.map((s) => {
    // Priced members only. An unpriced member is not a zero-GDP member — it is
    // one the game does not model an economy for, and averaging it in as zero
    // would make a bloc look poorer for every flavour state it admits.
    const memberGdp = s.members
      .filter((m) => gdpByEntity.has(m.countryId))
      .map((m) => ({
        countryId: m.countryId as CountryId,
        gdpMillions: gdpByEntity.get(m.countryId) ?? 0,
      }));
    const fundRow = fundByOrg.get(s.id);
    return {
      ...s,
      identity: resolveOrgIdentity(
        s.id,
        s.def.isCustom ?? false,
        s.def.shortName,
        s.def.category,
        s.def.logoPath
      ),
      // Viewer-agnostic at the list level; the client recomputes `yourInfluence`
      // from `derived.members` against the viewer's own country.
      derived: computeOrgDerived(memberGdp, null, worldGdpMillions),
      fund: (() => {
        const fundCountry = (fundRow?.currencyCountryId ??
          s.def.foundingMembers[0] ??
          "US") as CountryId;
        const duesRateAnnual = fundRow?.duesRateAnnual ?? DEFAULT_ORG_DUES_RATE_ANNUAL;
        const fundRate = getGdpAnchorRate(fundCountry, preset);
        // Dues and tribute PARTITION the roll — `orgMembership` is explicit that
        // nobody is billed both and nobody is billed neither — so the projected
        // income has to split the same way the charge does. Summing every priced
        // member into the dues line, as this used to, billed France and Italy at
        // the dues rate on paper while the turn phase charged them tribute.
        const annualOf = (
          rows: typeof memberGdp,
          rate: number // annual, as a fraction of GDP
        ): number =>
          rate <= 0
            ? 0
            : Math.round(
                (rows.reduce((sum, m) => sum + Math.max(0, m.gdpMillions), 0) *
                  GDP_MILLIONS_TO_USD *
                  rate) /
                  fundRate
              );
        const votes = (id: string) => access[id as CountryId]?.enabledForPlayers === true;
        const annualDuesLocal = annualOf(
          memberGdp.filter((m) => votes(m.countryId)),
          duesRateAnnual
        );
        // Era- and org-scoped: only the two armed blocs levy it, and only in a
        // 1953 world, so every other organisation reports zero rather than a
        // figure nobody is ever charged.
        const tributeRateAnnual = orgTributeRateAnnual(s.id, preset);
        const annualTributeLocal = annualOf(
          memberGdp.filter((m) => !votes(m.countryId)),
          tributeRateAnnual
        );
        return {
          balanceLocal:
            fundRow?.balanceLocal ??
            (fundRow as { balanceUsd?: number } | undefined)?.balanceUsd ??
            0,
          duesRateAnnual,
          annualDuesLocal,
          tributeRateAnnual,
          annualTributeLocal,
          currencyCode: getCountryConfig(fundCountry, preset)?.currencyCode ?? "USD",
          currencyCountryId: fundCountry,
          // Era-scoped ₳-per-fund-unit rate, so the client converts USD catalog
          // costs without re-deriving it from the (era-blind) base config.
          usdToFundRate: fundRate,
        };
      })(),
      posture: postureByOrg.get(s.id) ?? DEFAULT_ALERT_POSTURE,
      defensePctByCountry: Object.fromEntries(
        s.members
          .map((m) => [m.countryId, defensePctByCountry.get(m.countryId)] as const)
          .filter((e): e is [OrgMemberId, number] => e[1] !== undefined)
      ),
      warEntryOperations: warEntryByOrg.get(s.id) ?? [],
    };
  });

  return {
    organizations,
    definitions: INTERNATIONAL_ORGANIZATIONS,
    currentTurn,
    proposalVotingWindowTurns: ORG_PROPOSAL_VOTING_TURNS,
    // Drives whether the per-org Influence tab is offered at all. Fail-closed,
    // like every other alignment surface: a world with the gate off must show
    // no trace of the feature, not a tab explaining it is unavailable. Read
    // from the db already in hand rather than letting the helper open its own.
    intOrgAlignmentEnabled: await isIntOrgAlignmentEnabled(alignmentFlag ?? {}),
  };
}
