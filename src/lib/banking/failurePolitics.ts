import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import {
  BANK_FAILURE_MEMORY_TURNS,
  bankFailurePoliticalEffects,
  type BankFailurePoliticalEvent,
  type BankFailurePoliticalEffects,
} from "./rules/failurePolitics";

export const BANK_FAILURE_EVENTS = "bankFailurePoliticalEvents";
export async function loadBankFailureEffects(
  db: Db,
  turn: number,
  enabled?: boolean
): Promise<Map<string, BankFailurePoliticalEffects>> {
  if (enabled === undefined) {
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne(
        { _id: "default" },
        { projection: { bankFailurePoliticsEnabled: 1, privateBankingEnabled: 1 } }
      );
    enabled = config?.privateBankingEnabled === true && config?.bankFailurePoliticsEnabled === true;
  }
  if (!enabled) return new Map();
  let events = await db
    .collection<BankFailurePoliticalEvent>(BANK_FAILURE_EVENTS)
    .find(
      {
        $or: [
          { paidTurn: { $gt: turn - BANK_FAILURE_MEMORY_TURNS, $lte: turn } },
          { paidTurn: null },
        ],
      },
      {
        projection: {
          _id: 1,
          countryId: 1,
          paidTurn: 1,
          depositExposure: 1,
          taxpayerPaid: 1,
          gdp: 1,
        },
      }
    )
    .toArray();
  // The final immutable settlement projection may be recovered after the bank
  // already cleared its book. Activate that cohort in one write, not per bank.
  const pending = events.filter((event) => event.paidTurn == null);
  if (pending.length > 0) {
    const collection = db.collection<BankFailurePoliticalEvent>(BANK_FAILURE_EVENTS);
    const activated = await collection.bulkWrite(
      pending.map((event) => ({
        updateOne: {
          filter: { _id: event._id, paidTurn: null },
          update: { $set: { paidTurn: turn } },
        },
      }))
    );
    if (activated.matchedCount === pending.length) {
      events = events.map((event) =>
        event.paidTurn == null ? { ...event, paidTurn: turn } : event
      );
    } else {
      // Another phase may have activated the same receipts. Read its dates,
      // which are authoritative, instead of extending their decay window.
      const current = await collection
        .find(
          { _id: { $in: pending.map((event) => event._id) } },
          {
            projection: {
              _id: 1,
              countryId: 1,
              paidTurn: 1,
              depositExposure: 1,
              taxpayerPaid: 1,
              gdp: 1,
            },
          }
        )
        .toArray();
      const byId = new Map(current.map((event) => [event._id, event]));
      events = events.map((event) => byId.get(event._id) ?? event);
    }
  }
  return new Map(
    [...new Set(events.map((event) => event.countryId))].map((countryId) => [
      countryId,
      bankFailurePoliticalEffects(events, countryId, turn),
    ])
  );
}
export function bankFailureApprovalModifiers(
  effects?: BankFailurePoliticalEffects
): ActiveModifier[] {
  if (!effects || effects.approval === 0) return [];
  return [
    {
      id: "bank_failure_backstop",
      label: "Bank failure backstop",
      effect: effects.approval,
      marginEffect: 0,
      source: "banking",
    },
  ];
}
