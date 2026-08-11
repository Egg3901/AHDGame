import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import type {
  State,
  PoliticalParty,
  DemographicCategory,
  StateDemographics,
  StateMetrics,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CountryId } from "@/lib/constants/countries";

export interface EasternBlocSeedConfig {
  countryId: CountryId;
  categoryId: string; // e.g. "hu_voterGroups"
  regions: State[];
  parties: PartySeed[];
  categories: DemographicCategory[];
  metrics: StateMetrics[];
  baselines: StateMetricBaseline[];
}

/**
 * Generic seeder for a Warsaw-Pact one-party state: regions, ruling/bloc parties,
 * model-derived demographics, metrics, and baselines. Region/metric/baseline ids
 * are expected to be country-prefixed (e.g. HU_CEN). 1979-preset only.
 */
export async function seedEasternBlocCountry(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  cfg: EasternBlocSeedConfig
) {
  const { countryId, categoryId, regions, parties, categories, metrics, baselines } = cfg;

  // Warsaw-Pact one-party states + their communist rosters only existed in the
  // Cold-War (1953/1979) eras. In 1991/2019 the successor democracies own this
  // landmass, so skip entirely rather than seeding a Soviet-era structure into a
  // post-Soviet world (refs #3269). Matches the RU-regions era gate.
  const { isEasternBlocEra } = await import("@/lib/seeds/presetSelector");
  if (!isEasternBlocEra(preset)) {
    log(`[${countryId}] skipping Eastern-bloc seed — not a Cold-War era (preset ${preset})`);
    return;
  }

  const regionIds = regions.map((r) => r._id);

  if (reset) {
    await db.collection("states").deleteMany({ countryId });
    await db.collection("demographicCategories").deleteMany({ _id: categoryId as never });
    await db.collection("stateDemographics").deleteMany({ countryId });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId });
    await db.collection("macroMetrics").deleteMany({ _id: { $in: regionIds } as never });
    await db.collection("stateBaselines").deleteMany({ _id: { $in: regionIds } as never });
  }

  for (const region of regions) {
    const { _id, ...regionData } = region;
    await db.collection<State>("states").updateOne({ _id }, { $set: regionData }, { upsert: true });
  }

  const { isPartyValidForPreset, prunePresetMismatchedDefaultParties } =
    await import("@/lib/seeds/ensureDefaultParties");
  // Self-heal: drop wrong-era defaults (e.g. MSZMP / PCR) that survived a
  // partial reseed before the validForPresets gate existed.
  const pruned = await prunePresetMismatchedDefaultParties(db, parties, preset);
  if (pruned > 0) {
    log(`[${countryId}] pruned ${pruned} preset-mismatched default party(s) for ${preset}`);
  }
  const filtered = parties.filter((party) => isPartyValidForPreset(party, preset));
  const now = new Date();
  for (const party of filtered) {
    const { seedOrder: _s, validForPresets: _v, ...partyData } = party;
    void _s;
    void _v;
    const existing = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ name: party.name, countryId: party.countryId });
    if (existing) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: existing._id }, { $set: { ...partyData, updatedAt: now } });
    } else {
      const sequentialId = await getNextSequentialId(db, "party", party.countryId);
      await db.collection<PoliticalParty>("politicalParties").insertOne({
        _id: new ObjectId(),
        sequentialId,
        ...partyData,
        tier: resolveSeedPartyTier(party, preset),
        transactionApprovalMode: partyData.transactionApprovalMode ?? "double",
        createdAt: now,
        updatedAt: now,
      } as PoliticalParty);
    }
  }

  for (const cat of categories) {
    const { _id, ...catData } = cat;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id }, { $set: catData }, { upsert: true });
  }

  const { getCountryLayer1Model, buildModelRegionDemographics } =
    await import("@/lib/seeds/international");
  const { eraForPreset } = await import("@/lib/seeds/presetSelector");
  const era = eraForPreset(preset);
  const model = getCountryLayer1Model(countryId, era);
  if (model) {
    for (const raw of buildModelRegionDemographics(model)) {
      const { _id, ...demoData } = raw;
      await db
        .collection<StateDemographics>("stateDemographics")
        .updateOne({ _id }, { $set: demoData }, { upsert: true });
    }
  }

  // SP5: split write — macro slice -> macroMetrics (all countries), political
  // remainder -> stateMetrics (non-playables). countryId stamped for routing.
  await writeSplitMetricsBulk(
    db,
    metrics.map((m) => ({ ...m, countryId: countryId }) as StateMetrics)
  );
  for (const b of baselines) {
    const { _id, ...baselineData } = b;
    await db
      .collection<StateMetricBaseline>("stateBaselines")
      .updateOne({ _id }, { $set: baselineData }, { upsert: true });
  }

  log(
    `[${countryId}] Seeded ${regions.length} regions, ${parties.length} parties, metrics + baselines (era ${era})`
  );
}

/** Generic FY1979 budget seeder (national budget + enacted laws + state budgets + issuer). */
export async function seedEasternBlocBudget(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string,
  countryId: CountryId
) {
  // Bloc budgets belong to the Cold-War (1953/1979) one-party states only; skip in
  // post-Soviet eras so a Soviet-era budget never lands in a 1991/2019 world (#3269).
  const { isEasternBlocEra } = await import("@/lib/seeds/presetSelector");
  if (!isEasternBlocEra(preset)) {
    log(`[${countryId}] skipping Eastern-bloc budget — not a Cold-War era (preset ${preset})`);
    return;
  }

  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId });
    const ids = (
      await db.collection("states").find({ countryId }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (ids.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: ids }, countryId });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId });
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const national = getInitialNationalBudgetsForPreset(preset).find(
    (b) => b.countryId === countryId
  );
  if (!national) {
    log(`[${countryId}] no national budget config for preset ${preset} — skipping`);
    return;
  }
  const fiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === countryId)
      ?.fiscalYear ?? 1979;
  {
    const { _id, ...budgetData } = national;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
  }

  const laws = generateDefaultEnactedLaws(preset).filter((l) => l.countryId === countryId);
  for (const law of laws) {
    const { _id, ...lawWithoutId } = law;
    const unset: Record<string, ""> = {};
    if (law.gdpPerCapitaMultiplier === undefined) unset.gdpPerCapitaMultiplier = "";
    if (law.annualCostPerCapita === undefined) unset.annualCostPerCapita = "";
    if (law.annualCostUsd === undefined) unset.annualCostUsd = "";
    if (law.gdpCostFraction === undefined) unset.gdpCostFraction = "";
    if (law.incomeCostFraction === undefined) unset.incomeCostFraction = "";
    const update: Record<string, unknown> = { $set: lawWithoutId, $setOnInsert: { _id } };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    await db.collection<EnactedLaw>("enactedLaws").updateOne(
      {
        legislationTypeId: law.legislationTypeId,
        scope: law.scope,
        countryId: law.countryId,
        repealedAt: { $exists: false },
      },
      update,
      { upsert: true }
    );
  }

  // Regional gdp is already normalized to the authored national GDP by the
  // single reconcile pass at the end of `seedAllCountryData`, which this budget
  // block runs after. It used to be repeated here, back when bloc regions were
  // seeded later than that pass; they are not any more, and nothing between the
  // two writes `state.gdp`, so the repeat was a no-op. See reconcileStateGdp.ts
  // for the ordering contract this now depends on.
  const states = await db.collection<State>("states").find({ countryId }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  for (const budget of generateStateBudgets(statesForBudgets, fiscalYear)) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }

  // Command Economy v2 (P0): when `commandEconomyEnabled` is on, this satellite
  // gets the same per-commanding-height SOE split as RU/CN/DD (see
  // `generateCountryOwnedSeedData` / `WARSAW_PACT_SOE_SPEC`). Previously this
  // call omitted the flag entirely (defaulting to `false`), so PL/HU/CS/BG/RO
  // NEVER got their SOE stack even with the feature on and a non-empty
  // `COMMAND_ECONOMY_SOE_SECTORS` entry — the seed path silently skipped them.
  const easternBlocGameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const corpData = generateCountryOwnedSeedData(
    statesForBudgets,
    preset,
    easternBlocGameConfig?.commandEconomyEnabled === true
  ).filter((e) => e.corporation.countryOwnerId === countryId);
  const corpOps: AnyBulkWriteOperation<Corporation>[] = [];
  const sectorOps: AnyBulkWriteOperation<CorporateSector>[] = [];
  for (const entry of corpData) {
    const { _id: corpId, ...corpFields } = entry.corporation;
    corpOps.push({
      updateOne: { filter: { _id: corpId }, update: { $set: corpFields }, upsert: true },
    });
    for (const sector of entry.sectors) {
      const { _id: _sid, ...sectorData } = sector;
      sectorOps.push({
        updateOne: {
          filter: { corporationId: corpId, stateId: sector.stateId, sectorType: sector.sectorType },
          update: { $set: sectorData },
          upsert: true,
        },
      });
    }
  }
  // Corporations before sectors, preserving the original interleaving's
  // invariant: a sector's owning corporation always exists first.
  if (corpOps.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(corpOps, { ordered: true });
  }
  if (sectorOps.length > 0) {
    await db
      .collection<CorporateSector>("corporateSectors")
      .bulkWrite(sectorOps, { ordered: true });
  }
  log(
    `[${countryId}] Seeded national + ${states.length} state budgets, ${laws.length} laws${corpData.length ? `, ${corpData.length} issuer(s)` : ""}`
  );
}
