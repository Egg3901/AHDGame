import type { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";

/**
 * Private supply agreement (bilateral, both-consent). A supplier corp commits
 * to sell a commodity to a buyer corp off the open market: in clearing, the
 * supplier's contracted output is filled FIRST (before the loyal-slice and
 * cheapest-first passes) and that volume leaves the open market. The supplier's
 * excess flows to the market; if the supplier can't cover the cap, the buyer's
 * shortfall is bought on the market as normal.
 *
 * The agreed price is expressed as a premium/discount vs the prevailing market
 * price, bounded to ±SUPPLY_AGREEMENT_PRICE_BAND so a contract can favour either
 * side but cannot become a disguised gift or a gouge.
 *
 * Gated by gameConfig.supplyAgreementsEnabled.
 */
export interface SupplyAgreement {
  _id?: ObjectId;
  supplierCorpId: ObjectId;
  buyerCorpId: ObjectId;
  commodity: CommodityType;
  /** Max units per turn the supplier commits (its output is capped to this for the buyer). */
  volumeCap: number;
  /**
   * What `volumeCap` was validated AGAINST when the contract was signed, and
   * therefore whether the shortfall penalty may be assessed against it.
   *
   * `"scaledCapacity"` means the propose-time check actually ran and sized the
   * cap against the supplier's usable output. Absent means it did not — every
   * contract signed before the plants tier existed, when `volumeCap` was an
   * unbounded number with no physical basis at all. Those are grandfathered out
   * of damages by {@link computeSupplyAgreementSettlements}: assessing them
   * would start charging `CONTRACT_SHORTFALL_PENALTY` every turn, at the flip,
   * against a promise no plant was ever sized to meet and with no chance to
   * renegotiate first. They still settle their price premium, and they become
   * damage-eligible the moment the parties re-sign.
   *
   * Optional rather than defaulted: `undefined` must keep meaning "unknown
   * basis", so a future writer that forgets to stamp it fails safe.
   */
  volumeCapBasis?: "scaledCapacity";
  /**
   * Agreed price as a fraction offset from market: 0 = at market, +0.2 = 20%
   * above, −0.2 = 20% below. Bounded to ±SUPPLY_AGREEMENT_PRICE_BAND.
   */
  pricePremium: number;
  /** Exclusive = the supplier sells this commodity ONLY to the buyer (no market sales). */
  exclusive: boolean;
  /**
   * `"cancelling"` is the NOTICE state (C6). A live contract cannot be torn up
   * instantly: cancelling it stamps {@link CONTRACT_CANCEL_NOTICE_TURNS} turns
   * of notice during which the contract still delivers AND still settles, and
   * only then becomes `"cancelled"`. Without it, cancellation was a free option
   * — a supplier watched its own production, cancelled on any turn it was going
   * to miss its volume, and the shortfall penalty only ever hit the players who
   * forgot to click.
   */
  status: "pending" | "active" | "cancelling" | "cancelled";
  /**
   * Turn on which a `"cancelling"` contract stops delivering and settling.
   * Absent on every other status.
   */
  cancelEffectiveTurn?: number;
  proposedByCorpId: ObjectId;
  /**
   * C5 transfer pricing: cumulative ₳ of profit this contract has shifted out
   * of one country and into another, while both parties were in the same
   * formalized group. Reset to zero when the tax authority assesses. Absent on
   * every arm's-length or single-country contract, which is most of them.
   */
  transferPricingExposureAnchor?: number;
  lastTransferPricingAuditTurn?: number;
  /** Latest turn this agreement was evaluated for physical delivery. */
  lastDeliveryTurn?: number;
  /** Units this agreement delivered to its named buyer on lastDeliveryTurn. */
  lastDeliveredUnits?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Contracts meet physics (plants tier).
 *
 * How much a supplier may promise ABOVE what its plants can physically make.
 * Before this, `volumeCap` was an unbounded number: a corp with one small plant
 * could sign a contract for a million units, take the guaranteed contracted
 * fill in clearing (which is capped by real output anyway) and never face a
 * consequence for the promise it could not keep. The cap is validated at
 * PROPOSE time against the supplier's capacity-implied units for that commodity
 * (Σ capacity × mix weight across its sectors).
 *
 * 1.2 (20% headroom) rather than exactly 1.0 on purpose: capacity is a running
 * figure that depreciates and grows between the moment a contract is drafted
 * and the moment it settles, build orders land mid-contract, and a supplier
 * should be able to contract slightly ahead of a plant it is currently
 * building. Tighter than that and ordinary capacity noise rejects honest
 * contracts; looser and the promise stops meaning anything.
 */
export const CONTRACT_OVERCOMMIT_TOLERANCE = 1.2;

/**
 * Penalty rate for failing to deliver contracted volume, as a fraction of the
 * market value of the undelivered units: the supplier pays the buyer
 * `shortfallUnits × currentPrice × CONTRACT_SHORTFALL_PENALTY`.
 *
 * 0.5 is deliberately below 1.0. A full-value penalty would make breach
 * strictly worse than never contracting, which turns every contract into a
 * gamble on next turn's production and kills the mechanic; at half the market
 * value the buyer is meaningfully compensated for having to cover the shortfall
 * on the open market (typically at a worse price than the contract locked),
 * breaking even in the usual case, while over-promising stays a real but
 * survivable mistake. Only charged when the supplier UNDER-PRODUCED against its
 * contracted volume — a delivery gap caused by weak market demand is not the
 * supplier's breach.
 */
export const CONTRACT_SHORTFALL_PENALTY = 0.5;

/**
 * Turns of notice a live supply agreement takes to cancel (C6).
 *
 * Cancellation used to take effect instantly and cost nothing, at any moment,
 * from either side. That made the shortfall penalty voluntary: the supplier
 * knows its own production before settlement, so it could cancel on exactly the
 * turns it was going to be short and keep the contract on the turns it was not.
 * A penalty you can always opt out of is not a penalty — it is a tax on
 * forgetfulness.
 *
 * Notice, rather than a break fee, is the honest fix here: the damages a break
 * fee would have to price are only knowable at settlement (they depend on the
 * turn's actual production and the turn's clearing price), so a fee charged at
 * the moment of cancellation would be a guess. Serving notice charges the
 * REAL thing — four more turns of the contract as written, settled normally,
 * penalties and all — and it is also what a supply contract does in life.
 *
 * 4 turns ≈ a sixth of a financial day: long enough that cancelling to dodge a
 * known-bad settlement does not work (the bad turn settles anyway), short
 * enough that exiting a contract is a real option rather than a life sentence.
 * PROVISIONAL: worldsim re-tunes.
 */
export const CONTRACT_CANCEL_NOTICE_TURNS = 4;

/**
 * Ceiling on shortfall damages from ONE settlement, as a fraction of that
 * contract's own notional value for the period (`volumeCap × unit price`).
 *
 * Uncapped damages were an unbounded wire between two consenting corps: sign a
 * contract for an absurd volume, never produce it, and the supplier pays the
 * buyer `shortfall × price × 0.5` every turn, for ever. Two colluding players
 * could move any amount of cash in either direction with no counterparty and no
 * limit — the volume cap is set by the same two people signing.
 *
 * 0.25 of notional is a real penalty for a real miss (a supplier that delivers
 * nothing pays a quarter of the contract's value per turn) while bounding the
 * per-turn wire to something the contract's own stated size justifies.
 * PROVISIONAL: worldsim re-tunes.
 */
export const CONTRACT_DAMAGES_CAP_FRACTION = 0.25;

/** Maximum contract price deviation from market (±35%). */
export const SUPPLY_AGREEMENT_PRICE_BAND = 0.35;

/** Clamp a proposed price premium into the legal band. */
export function clampAgreementPremium(premium: number): number {
  if (!Number.isFinite(premium)) return 0;
  return Math.max(-SUPPLY_AGREEMENT_PRICE_BAND, Math.min(SUPPLY_AGREEMENT_PRICE_BAND, premium));
}

/** True when a proposed premium is within the legal band (for validation/reject). */
export function isAgreementPremiumLegal(premium: number): boolean {
  return (
    Number.isFinite(premium) &&
    premium >= -SUPPLY_AGREEMENT_PRICE_BAND &&
    premium <= SUPPLY_AGREEMENT_PRICE_BAND
  );
}
