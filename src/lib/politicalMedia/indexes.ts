import type { CreateIndexesOptions, IndexSpecification } from "mongodb";
import { POLITICAL_MEDIA_ORDER_KIND } from "./journal";

export interface PoliticalMediaIndexSpec {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
}

/** Shared by fresh world seeding and the live-world startup migration. */
export const POLITICAL_MEDIA_ORDER_INDEXES: readonly PoliticalMediaIndexSpec[] = [
  {
    collection: "bankMoneyMoves",
    keys: { kind: 1, status: 1, "politicalMediaOrder.status": 1 },
    options: {
      name: "bankMoneyMoves_politicalMedia_status",
      background: true,
      partialFilterExpression: { kind: POLITICAL_MEDIA_ORDER_KIND },
    },
  },
  {
    collection: "bankMoneyMoves",
    keys: { kind: 1, status: 1, "politicalMediaOrder.settlementPlan.plannedTurn": 1 },
    options: {
      name: "bankMoneyMoves_politicalMedia_plannedTurn",
      background: true,
      partialFilterExpression: { kind: POLITICAL_MEDIA_ORDER_KIND },
    },
  },
];
