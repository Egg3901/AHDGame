import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector, Notification } from "@/lib/db/types";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getGameState } from "@/lib/gameState";
import { resolveGameYear } from "@/lib/era/era";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import {
  defenceContractLotCaps,
  defenceContractWindow,
} from "@/lib/military/defenceContractLimits";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { hasTenderOpportunity } from "./rules/opportunities";
import { canBid } from "./rules";
import type { GovernmentTender } from "./types";

/** One projected read per dataset, then one idempotent bulk write per published tender. */
export async function notifyTenderBidders(
  db: Db,
  tender: GovernmentTender,
  turn: number,
  now: Date
) {
  if (!canBid(tender, turn)) return;
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      {
        userId: { $type: "objectId" },
        ceoVacant: { $ne: true },
        ...(tender.terms.type === "defence"
          ? { countryId: tender.countryId }
          : { type: "extraction" }),
      },
      {
        projection: {
          name: 1,
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
    .toArray();
  const humans = corps.filter((c) => !isNppOwned(c));
  if (!humans.length) return;
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        corporationId: { $in: humans.map((c) => c._id) },
        ...(tender.terms.type === "extraction"
          ? { stateId: tender.terms.stateId }
          : { sectorType: "defense" }),
      },
      { projection: { corporationId: 1, stateId: 1, sectorType: 1, strategyId: 1, revenue: 1 } }
    )
    .toArray();
  let year = 0,
    maximumGrade = 0,
    anchor: number | null = null,
    procurementNotional = 0;
  let ratios: ReadonlyMap<import("@/lib/constants/commodities").CommodityType, number> = new Map();
  let supplierAmounts: Record<string, number> = {};
  if (tender.terms.type === "defence") {
    const [game, prices, allocation] = await Promise.all([
      getGameState(db),
      loadDefencePriceRatios(db),
      db
        .collection<{ _id: string; supplierAmounts?: Record<string, number> }>(
          "defenceProcurementAllocations"
        )
        .findOne(
          { _id: defenceContractWindow(tender.countryId, tender.publishedTurn).id },
          { projection: { supplierAmounts: 1 } }
        ),
    ]);
    const preset = game?.preset ?? DEFAULT_SEED_PRESET;
    const budget = await ensureFederalBudget(db, tender.countryId, preset);
    if (!budget) return;
    year =
      resolveGameYear(game ?? {}) ??
      getStartingYearForPreset(preset) + Math.floor((turn - 1) / TURNS_PER_YEAR);
    maximumGrade = maxTechTierForPreset(preset);
    anchor = lotPrice(
      tender.countryId,
      militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp)
    );
    ratios = prices;
    procurementNotional = defenceContractLotCaps(
      resolveDefenseLineFrom(budget),
      1
    ).procurementNotional;
    supplierAmounts = allocation?.supplierAmounts ?? {};
  }
  const byCorp = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const id = sector.corporationId.toHexString();
    const plants = byCorp.get(id) ?? [];
    plants.push(sector);
    byCorp.set(id, plants);
  }
  const recipients = new Map<string, { userId: ObjectId; names: string[]; ids: string[] }>();
  for (const corp of humans) {
    const id = corp._id.toHexString();
    if (
      !hasTenderOpportunity({
        terms: tender.terms,
        countryId: tender.countryId,
        corporation: corp,
        sectors: byCorp.get(id) ?? [],
        year,
        maximumGrade,
        anchor,
        ratios,
        procurementNotional,
        supplierAmount: supplierAmounts[id] ?? 0,
        stateOwned: isStateOwned(corp),
      })
    )
      continue;
    const userId = corp.userId!;
    const key = userId.toHexString();
    const entry = recipients.get(key) ?? { userId, names: [], ids: [] };
    entry.names.push(corp.name);
    entry.ids.push(id);
    recipients.set(key, entry);
  }
  if (!recipients.size) return;
  await db.collection<Notification>("notifications").bulkWrite(
    [...recipients.values()].map((recipient) => ({
      updateOne: {
        filter: {
          _id: new ObjectId(
            createHash("sha256")
              .update(
                "government-contract-open:" + tender._id + ":" + recipient.userId.toHexString()
              )
              .digest("hex")
              .slice(0, 24)
          ),
        },
        update: {
          $setOnInsert: {
            userId: recipient.userId,
            type: "government_contract_opened" as const,
            read: false,
            createdAt: now,
            title: "Government Contract Open for Bids",
            message: `${COUNTRY_CONFIGS[tender.countryId].name} published "${tender.title}". ${recipient.names[0]}${recipient.names.length > 1 ? ` and ${recipient.names.length - 1} other corporations you manage` : ""} may bid. Bidding closes on turn ${tender.closesTurn}; the government then selects a winner before turn ${tender.awardDeadlineTurn}. Review the requirements and submit a bid.`,
            metadata: {
              tenderId: tender._id,
              countryId: tender.countryId,
              contractType: tender.terms.type,
              closesTurn: tender.closesTurn,
              awardDeadlineTurn: tender.awardDeadlineTurn,
              corporationIds: recipient.ids,
            },
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}
