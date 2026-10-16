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
  /** A zero opening needs no funding. A funded opening names the transfer that paid it. */
  openingFundingReceipt?: string;
}
