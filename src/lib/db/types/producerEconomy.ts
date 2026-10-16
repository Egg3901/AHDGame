import type { ProducerPayable } from "@/lib/market/producerMarket/payablesRules";
import type { ProducerOperatingResult } from "@/lib/market/producerMarket/production";

/** Cash-backed counterparties to producer sales and operating payments. */
export interface ProducerEconomyAccount {
  /** Stable identity within a world, including the world's epoch. */
  _id: string;
  worldEpoch: string;
  kind: "households" | "publicBuyer" | "operatingPayee";
  countryId: string;
  stateId?: string;
  currency: string;
  /** Native currency. Credited only by a balanced settlement. */
  cash: number;
  producerPayables?: ProducerPayablesState;
  /** A zero opening needs no funding. A funded opening names the transfer that paid it. */
  openingFundingReceipt?: string;
}

/** The sector's authoritative, per-turn, anchor-valued operating receipt. */
export interface ProducerSectorSettlement extends ProducerOperatingResult {
  worldEpoch: string;
  turn: number;
}

/** Absolute invoice balances; payments never re-expense a previous turn's bill. */
export interface ProducerPayablesState {
  worldEpoch: string;
  turn: number;
  claims: ProducerPayable[];
}
