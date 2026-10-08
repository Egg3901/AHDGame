/**
 * Per-turn venture processing. Runs after operating cash has landed so the
 * funding guard sees the corporation's final balance for the turn.
 *
 * Money: each development turn debits liquidCapital with a guarded update that
 * also writes a receipt keyed by venture id. A crash between the debit and the
 * venture write replays from the receipt and never charges twice. The money is
 * a sink, like other product development spend.
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
} from "@/lib/currency/corporationCapital";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import {
  advanceBoost,
  advanceDevelopment,
  getVentureEvent,
  stackedBoostMultiplier,
} from "./engine";
import { liftedSectorIds, getVentureLine, type VentureSector } from "./lines";
import { sectorTurnRevenueAnchor } from "./revenue";
import { refundVentureReceipt } from "./refund";
import { PRODUCT_VENTURES, ventureDocument } from "./store";
import type { ProductVenture, VentureDomain } from "./types";

export type VentureNotifier = (inputs: NotificationInput[]) => Promise<void>;

export function ventureSector(sector: CorporateSector): VentureSector {
  return {
    sectorId: sector._id.toString(),
    sectorType: sector.sectorType,
    industryModel: sector.industryModel,
    strategyId: sector.strategyId,
    mediaDiscriminator: sector.mediaDiscriminator,
    capitalStock: sector.capitalStock,
    plantCount: sector.plantCount,
    mothballed: sector.mothballed,
  };
}

/** Multiplier per sector id from hits whose boost is running this turn. */
export async function loadVentureBoostBySectorId(
  db: Db,
  input: {
    turn: number;
    sectorsByCorp: ReadonlyMap<string, readonly CorporateSector[]>;
    enabled: Record<VentureDomain, boolean>;
  }
): Promise<Map<string, number>> {
  const released = await db
    .collection<ProductVenture>(PRODUCT_VENTURES)
    .find({ stage: "released", boostEndsTurn: { $gte: input.turn } })
    .toArray();
  const boostsBySector = new Map<string, number[]>();
  for (const venture of released) {
    if (!input.enabled[venture.domain]) continue;
    if ((venture.releasedTurn ?? Infinity) >= input.turn) continue;
    const sectors = input.sectorsByCorp.get(venture.corporationId) ?? [];
    const ids = liftedSectorIds({
      domain: venture.domain,
      lineId: venture.lineId,
      corporationId: venture.corporationId,
      sectors: sectors.map(ventureSector),
    });
    for (const id of ids) {
      const list = boostsBySector.get(id) ?? [];
      list.push(venture.boostFraction ?? 0);
      boostsBySector.set(id, list);
    }
  }
  return new Map([...boostsBySector].map(([id, boosts]) => [id, stackedBoostMultiplier(boosts)]));
}

interface FreshCorp {
  _id: ObjectId;
  liquidCapital?: number;
  liquidCurrencyCode?: string;
  countryId?: string;
  productVentureDebitsV1?: Corporation["productVentureDebitsV1"];
}

export interface ProcessVenturesArgs {
  db: Db;
  turn: number;
  corporations: readonly Corporation[];
  sectorsByCorp: ReadonlyMap<string, readonly CorporateSector[]>;
  exchangeRatesByCurrency: ReadonlyMap<CurrencyCode, number>;
  enabled: Record<VentureDomain, boolean>;
  notify?: VentureNotifier;
}

export interface ProcessVenturesResult {
  developed: number;
  released: number;
  flopped: number;
  paidAnchor: number;
  boosted: number;
}

const RESULT_TITLES = {
  hit: (name: string) => `${name} is a hit`,
  flop: (name: string) => `${name} flopped`,
};

export async function processProductVentures(
  args: ProcessVenturesArgs
): Promise<ProcessVenturesResult> {
  const result: ProcessVenturesResult = {
    developed: 0,
    released: 0,
    flopped: 0,
    paidAnchor: 0,
    boosted: 0,
  };
  const collection = args.db.collection<ProductVenture>(PRODUCT_VENTURES);
  const ventures = await collection
    .find({
      stage: { $in: ["development", "released"] },
      lastProcessedTurn: { $lt: args.turn },
    })
    .toArray();
  const live = ventures.filter((venture) => args.enabled[venture.domain]);
  if (live.length === 0) return result;

  const corpById = new Map(args.corporations.map((corp) => [corp._id.toString(), corp]));
  const notify = args.notify ?? createNotifications;
  const notifications: NotificationInput[] = [];

  const developing = live.filter((venture) => venture.stage === "development");
  const fresh = developing.length
    ? ((await args.db
        .collection<Corporation>("corporations")
        .find(
          {
            _id: {
              $in: [...new Set(developing.map((v) => v.corporationId))].map(
                (id) => new ObjectId(id)
              ),
            },
          },
          {
            projection: {
              liquidCapital: 1,
              liquidCurrencyCode: 1,
              countryId: 1,
              productVentureDebitsV1: 1,
            },
          }
        )
        .toArray()) as unknown as FreshCorp[])
    : [];
  const freshById = new Map(fresh.map((row) => [row._id.toString(), row]));

  for (const venture of developing) {
    const corp = corpById.get(venture.corporationId);
    const row = freshById.get(venture.corporationId);
    if (!corp || !row) continue;
    const fx = fxRateForCorpFromMap(row, args.exchangeRatesByCurrency);
    const receiptKey = `productVentureDebitsV1.${venture._id}`;
    const stored = row.productVentureDebitsV1?.[venture._id];
    let investmentAnchor = 0;
    let chargeAnchor = 0;

    if (stored?.turn === args.turn) {
      investmentAnchor = stored.investmentAnchor;
      chargeAnchor = stored.chargeAnchor;
    } else {
      const liquidAnchor = corpLiquidCapitalToAnchor(Math.max(0, row.liquidCapital ?? 0), row, fx);
      const chargeWanted = Math.min(venture.pendingChargeAnchor, liquidAnchor);
      const investmentWanted = Math.min(
        venture.fundingPerTurnAnchor,
        Math.max(0, liquidAnchor - chargeWanted)
      );
      const total = chargeWanted + investmentWanted;
      if (total > 0) {
        const local = anchorToCorpLiquidCapital(total, row, fx);
        const debit = await args.db.collection<Corporation>("corporations").updateOne(
          {
            _id: row._id,
            [`${receiptKey}.turn`]: { $ne: args.turn },
            $expr: { $gte: [{ $ifNull: ["$liquidCapital", 0] }, local] },
          },
          {
            $inc: { liquidCapital: -local },
            $set: {
              [receiptKey]: {
                turn: args.turn,
                amountAnchor: total,
                investmentAnchor: investmentWanted,
                chargeAnchor: chargeWanted,
                localAmount: local,
              },
            },
          } as never
        );
        if (debit.matchedCount === 1) {
          investmentAnchor = investmentWanted;
          chargeAnchor = chargeWanted;
          result.paidAnchor += total;
        }
      }
    }

    let step: ReturnType<typeof advanceDevelopment> = null;
    let current: ProductVenture | null = venture;
    for (let attempt = 0; attempt < 3 && current; attempt++) {
      const candidate = advanceDevelopment(current, {
        turn: args.turn,
        investmentPaidAnchor: investmentAnchor,
        chargePaidAnchor: chargeAnchor,
        averageQuality: corp.averageQuality,
      });
      if (!candidate) break;
      const write = await collection.replaceOne(
        { _id: current._id, rev: current.rev ?? 0, stage: "development" },
        ventureDocument({ ...candidate.venture, rev: (current.rev ?? 0) + 1 }) as ProductVenture
      );
      if (write.matchedCount === 1) {
        step = candidate;
        break;
      }
      // The CEO changed funding or answered a decision mid-turn: reload and
      // apply the same settled cash to the fresh document.
      current = await collection.findOne({ _id: venture._id });
    }
    if (!step) {
      // Cancelled (or otherwise closed) after the debit: hand the money back.
      // The receipt is the idempotency key, so a replay cannot refund twice.
      const closed = current === null || current.stage !== "development";
      const paid = investmentAnchor + chargeAnchor;
      if (closed && paid > 0) {
        const refunded = await refundVentureReceipt(args.db, row._id, venture._id, args.turn);
        if (refunded) result.paidAnchor -= paid;
      }
      continue;
    }
    result.developed += 1;
    if (step.completed) {
      await args.db
        .collection<Corporation>("corporations")
        .updateOne({ _id: row._id }, { $unset: { [receiptKey]: "" } } as never);
    }

    const humanOwner = corp.ceoType !== "npp" && corp.userId;
    if (humanOwner) {
      const base = { corporationId: venture.corporationId, ventureId: venture._id };
      for (const eventId of step.offered) {
        const def = getVentureEvent(eventId);
        if (!def || step.completed) continue;
        notifications.push({
          userId: corp.userId,
          type: "corp_product_event",
          title: `${venture.name}: ${def.title}`,
          message: `${def.body} Choose a response in the Product Studio. If you do not answer within a day, the default applies.`,
          metadata: { ...base, eventId },
        });
      }
      if (step.completed) {
        const hit = step.venture.outcome === "hit";
        const line = getVentureLine(venture.domain, venture.lineId);
        notifications.push({
          userId: corp.userId,
          type: "corp_product_result",
          title: (hit ? RESULT_TITLES.hit : RESULT_TITLES.flop)(venture.name),
          message: hit
            ? `${venture.name} (${line?.label ?? "product"}) is out at quality ${step.venture.finalQuality}. Revenue across your matching sectors rises ${Math.round((step.venture.boostFraction ?? 0) * 100)}% for the next three days.`
            : `${venture.name} (${line?.label ?? "product"}) did not find an audience at quality ${step.venture.finalQuality}. The money spent is not recovered and there is no ongoing penalty.`,
          metadata: { ...base, outcome: step.venture.outcome },
        });
      }
    }
    if (step.completed) {
      if (step.venture.outcome === "hit") result.released += 1;
      else result.flopped += 1;
    }
  }

  for (const venture of live.filter((v) => v.stage === "released")) {
    const corp = corpById.get(venture.corporationId);
    if (!corp) continue;
    const sectors = args.sectorsByCorp.get(venture.corporationId) ?? [];
    const lifted = new Set(
      liftedSectorIds({
        domain: venture.domain,
        lineId: venture.lineId,
        corporationId: venture.corporationId,
        sectors: sectors.map(ventureSector),
      })
    );
    const peers = ventures.filter(
      (peer) =>
        peer.corporationId === venture.corporationId &&
        peer.stage === "released" &&
        (peer.releasedTurn ?? Infinity) <= args.turn - 2 &&
        (peer.boostEndsTurn ?? 0) >= args.turn - 1
    );
    let uplift = 0;
    for (const sector of sectors) {
      if (!lifted.has(sector._id.toString())) continue;
      const priorBoosts = peers
        .filter(
          (peer) =>
            liftedSectorIds({
              domain: peer.domain,
              lineId: peer.lineId,
              corporationId: peer.corporationId,
              sectors: [ventureSector(sector)],
            }).length > 0
        )
        .map((peer) => peer.boostFraction ?? 0);
      const base =
        sectorTurnRevenueAnchor(sector, corp, args.exchangeRatesByCurrency) /
        stackedBoostMultiplier(priorBoosts);
      uplift += base * (venture.boostFraction ?? 0);
    }
    const next = advanceBoost(venture, { turn: args.turn, upliftAnchor: uplift });
    if (!next) continue;
    const write = await collection.replaceOne(
      { _id: venture._id, rev: venture.rev ?? 0, stage: "released" },
      ventureDocument({ ...next, rev: (venture.rev ?? 0) + 1 }) as ProductVenture
    );
    if (write.matchedCount === 1) result.boosted += 1;
  }

  await notify(notifications);
  return result;
}
