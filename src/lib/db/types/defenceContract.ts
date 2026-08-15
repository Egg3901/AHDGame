import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";

/**
 * `pending` is where every contract starts: a minister awards it, and it does nothing until
 * the supplying CEO accepts. Only `active` delivers or draws on the appropriation.
 * `declined` is the CEO's refusal, kept distinct from the minister's `cancelled` so the
 * order book records who walked away.
 */
export type DefenceContractStatus = "pending" | "active" | "complete" | "cancelled" | "declined";

/**
 * A standing order between a country's defence seat and one of its OWN defence sectors.
 *
 * Domestic only, and that is a hard constraint rather than a simplification: the defence
 * appropriation is denominated in the country's local currency while a corporation carries
 * its own `liquidCurrencyCode` — which is *absent* on pre-forex corps and documented as
 * "treat as USD". Paying across a currency boundary would silently mis-denominate, and there
 * is no exchange-rate document at all for the six Eastern Bloc countries. Sharing a country
 * makes buyer and supplier share a currency by construction. Arms exports need their own
 * design, starting with that question.
 */
export interface DefenceContract {
  _id: ObjectId;
  /** The buying country. Equals the supplying corporation's `countryId` — see above. */
  countryId: CountryId;
  corporationId: ObjectId;
  /** The specific plant. Strategy — and therefore component — is per sector, not per corp. */
  sectorId: ObjectId;
  /**
   * Resolved from the sector's strategy when the contract is awarded, and FROZEN there. A CEO
   * who re-tools mid-contract does not silently start delivering tanks against an order for
   * submarines; the contract is for a component, and re-tooling makes it undeliverable rather
   * than differently-deliverable.
   */
  component: UnitDomain;
  lotsOrdered: number;
  lotsDelivered: number;
  /**
   * Fractional materiel produced but not yet turned into a whole delivered lot, carried turn to
   * turn. Always in [0, 1). Without it a plant producing under one lot per turn delivers nothing
   * forever, because each turn's sub-lot output was floored to zero and discarded.
   */
  deliveryCarry?: number;
  /** Struck at award, in the country's local currency. Does not drift with GDP afterwards. */
  pricePerLot: number;
  /** Quarter-window allocation reserved when this contract was awarded. */
  allocationWindowId?: string;
  /** Lots charged to that allocation. Used to release undelivered quota on cancellation. */
  allocatedLots?: number;
  /** Delivered lots whose payment was administratively recovered after an invalid over-award. */
  administrativeClawbackLots?: number;
  /** Local-currency amount recovered for administrativeClawbackLots. */
  administrativeClawbackAmount?: number;
  administrativeClawbackAt?: Date;
  administrativeClawbackRunId?: string;
  status: DefenceContractStatus;
  awardedTurn: number;
  updatedAt?: Date;
}
