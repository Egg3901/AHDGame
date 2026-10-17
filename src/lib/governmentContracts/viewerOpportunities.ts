/** Viewer-scoped, read-only discovery. Batch inputs before evaluating every candidate. */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector, DefenceContract, FederalBudget } from "@/lib/db/types";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { getGameState } from "@/lib/gameState";
import { resolveGameYear } from "@/lib/era/era";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import {
  defenceContractLotCaps,
  defenceContractWindow,
} from "@/lib/military/defenceContractLimits";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { isProcurementBlocked } from "@/lib/military/procurementGate";
import { hasCurrentTenderCapacity } from "./rules/viewerCapacity";
import type { GovernmentTender } from "./types";
export async function viewerTenderIds(
  db: Db,
  countryId: CountryId,
  rows: Pick<GovernmentTender, "_id" | "terms" | "publishedTurn">[],
  turn: number,
  userId: string,
  corporationId?: string
): Promise<string[]> {
  if (!ObjectId.isValid(userId) || !rows.length) return [];
  const corps = (
    await db
      .collection<Corporation>("corporations")
      .find(
        {
          userId: new ObjectId(userId),
          ceoVacant: { $ne: true },
          ...(corporationId ? { _id: new ObjectId(corporationId) } : {}),
        },
        {
          projection: {
            userId: 1,
            type: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
            unlockedTechNodeIds: 1,
            techDecadeLane: 1,
            ceoType: 1,
            caretakerCeo: 1,
            ownershipState: 1,
            countryOwnerId: 1,
          },
        }
      )
      .toArray()
  ).filter((c) => !isNppOwned(c));
  if (!corps.length) return [];
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: corps.map((c) => c._id) } },
      { projection: { corporationId: 1, stateId: 1, sectorType: 1, strategyId: 1, revenue: 1 } }
    )
    .toArray();
  const defence = rows.filter((r) => r.terms.type === "defence");
  const [game, budget, ratios, allocations, contracts, gate] = defence.length
    ? await Promise.all([
        getGameState(db),
        db.collection<FederalBudget>("federalBudget").findOne(
          { countryId },
          {
            projection: {
              gdp: 1,
              militaryPriceBaselineGdp: 1,
              "spending.byCategory.defense": 1,
              "baselineSpendingByCategory.defense": 1,
            },
          }
        ),
        loadDefencePriceRatios(db),
        db
          .collection<{ _id: string; supplierAmounts?: Record<string, number> }>(
            "defenceProcurementAllocations"
          )
          .find(
            {
              _id: {
                $in: [
                  ...new Set(
                    defence.map((r) => defenceContractWindow(countryId, r.publishedTurn).id)
                  ),
                ],
              },
            },
            { projection: { supplierAmounts: 1 } }
          )
          .toArray(),
        db
          .collection<DefenceContract>("defenceContracts")
          .find(
            {
              sectorId: { $in: sectors.map((s) => s._id) },
              status: { $in: ["pending", "active"] },
            },
            { projection: { sectorId: 1, assignedFactories: 1 } }
          )
          .toArray(),
        isProcurementBlocked(db, countryId, turn),
      ])
    : [null, null, new Map(), [], [], { blocked: false }];
  const preset = game?.preset ?? DEFAULT_SEED_PRESET;
  const year =
    resolveGameYear(game ?? {}) ??
    getStartingYearForPreset(preset) + Math.floor((turn - 1) / TURNS_PER_YEAR);
  const byCorp = new Map<string, (CorporateSector & { id: string })[]>();
  for (const s of sectors) {
    const key = s.corporationId.toHexString();
    const group = byCorp.get(key) ?? [];
    group.push({ ...s, id: s._id.toHexString() });
    byCorp.set(key, group);
  }
  const commitments = new Map<string, DefenceContract[]>();
  for (const c of contracts) {
    const key = c.sectorId.toHexString();
    const group = commitments.get(key) ?? [];
    group.push(c);
    commitments.set(key, group);
  }
  const byWindow = new Map(allocations.map((a) => [a._id, a.supplierAmounts ?? {}]));
  const anchor = budget
    ? lotPrice(countryId, militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp))
    : null;
  const maximumGrade = maxTechTierForPreset(preset);
  const procurementNotional = defenceContractLotCaps(
    resolveDefenseLineFrom(budget),
    1
  ).procurementNotional;
  return rows
    .filter(
      (row) =>
        !(row.terms.type === "defence" && gate.blocked) &&
        corps.some((corp) =>
          hasCurrentTenderCapacity({
            terms: row.terms,
            countryId,
            corporation: corp,
            sectors: byCorp.get(corp._id.toHexString()) ?? [],
            commitments,
            year,
            maximumGrade,
            anchor,
            ratios,
            procurementNotional,
            supplierAmount:
              byWindow.get(defenceContractWindow(countryId, row.publishedTurn).id)?.[
                corp._id.toHexString()
              ] ?? 0,
            stateOwned: isStateOwned(corp),
          })
        )
    )
    .map((r) => r._id);
}
