/**
 * What a bank charter may do, decided in one place.
 *
 * Charter type used to be re-derived at every call site: six copies of "is
 * this a deposit taker", a `$in: ["retail", "universal"]` in the turn query,
 * an `=== "investment"` in the lending cap, another in the rate setter, another
 * in the discount window, a `type === "investment" || type === "universal"` in
 * the solvency pass, the interbank module and the prop desk. They agreed, until
 * one of them did not: the turn query excluded investment charters from loan
 * servicing while origination admitted them, and a loan nobody serviced was the
 * result.
 *
 * This module answers every capability question from one table. Callers ask
 * "may this charter accept a player deposit" and get a decision with a reason,
 * never a charter type to compare against. The reason is what the player sees
 * when the answer is no, so it is part of the contract rather than an error
 * string invented at the call site.
 */

import type { BankCharterStatus, BankCharterType } from "@/lib/db/types/bank";

export type CapabilityKey =
  /** Player savings may be pointed at (later: deposited with) this bank. */
  | "acceptPlayerDeposits"
  /** NPC household deposits flow into this bank's vault. */
  | "acceptNpcFunding"
  /** The bank originates the NPC household loan book. */
  | "householdLending"
  /** Named loans to corporations. */
  | "namedCorporationLending"
  /** Named loans to characters. */
  | "namedCharacterLending"
  /** Lends surplus deposits to other banks. */
  | "interbankLending"
  /** Borrows on the interbank market. */
  | "interbankBorrowing"
  /** Runs a proprietary trading book. */
  | "proprietaryTrading"
  /** Draws emergency liquidity from the central bank's window. */
  | "discountWindow"
  /** Draws on the central bank's collateralized margin line. */
  | "centralBankMargin"
  /** Its named loan book is serviced every turn. */
  | "serviceLoanBook"
  /** The CEO sets deposit and lending offsets. */
  | "setRates"
  /** Financial-sector capacity is split with a branch network. */
  | "branchNetwork";

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  "acceptPlayerDeposits",
  "acceptNpcFunding",
  "householdLending",
  "namedCorporationLending",
  "namedCharacterLending",
  "interbankLending",
  "interbankBorrowing",
  "proprietaryTrading",
  "discountWindow",
  "centralBankMargin",
  "serviceLoanBook",
  "setRates",
  "branchNetwork",
];

export type CapabilityDenial =
  /** The private banking kill switch is off. */
  | "banking_disabled"
  /** The proprietary-trading kill switch is off. */
  | "prop_trading_disabled"
  /** The corporation holds no charter at all. */
  | "no_charter"
  /** The charter exists but is revoked or failed. */
  | "charter_inactive"
  /** The charter type does not carry this capability. */
  | "charter_type";

export interface CapabilityResult {
  allowed: boolean;
  reason?: CapabilityDenial;
}

export type CharterCapabilities = Readonly<Record<CapabilityKey, CapabilityResult>>;

/** The two switches a capability can depend on. */
export interface CapabilityPolicy {
  privateBanking: boolean;
  propTrading: boolean;
}

/** Everything on: the structural answer, before any kill switch. */
export const CAPABILITY_POLICY_ALL_ON: CapabilityPolicy = Object.freeze({
  privateBanking: true,
  propTrading: true,
});

export type CharterLike = { type: BankCharterType; status: BankCharterStatus } | null | undefined;

/**
 * Capabilities each charter TYPE carries structurally, before switches and
 * status. `prop` marks the ones that also need the proprietary-trading switch:
 * interbank activity, the margin line and the prop desk were shipped together
 * behind it and are killed together.
 */
const BY_TYPE: Readonly<Record<BankCharterType, ReadonlySet<CapabilityKey>>> = {
  retail: new Set<CapabilityKey>([
    "acceptPlayerDeposits",
    "acceptNpcFunding",
    "householdLending",
    "namedCorporationLending",
    "namedCharacterLending",
    "interbankLending",
    "discountWindow",
    "serviceLoanBook",
    "setRates",
    "branchNetwork",
  ]),
  universal: new Set<CapabilityKey>(CAPABILITY_KEYS),
  investment: new Set<CapabilityKey>([
    "namedCorporationLending",
    "interbankBorrowing",
    "proprietaryTrading",
    "centralBankMargin",
    "serviceLoanBook",
  ]),
};

const NEEDS_PROP_TRADING: ReadonlySet<CapabilityKey> = new Set<CapabilityKey>([
  "interbankLending",
  "interbankBorrowing",
  "proprietaryTrading",
  "centralBankMargin",
]);

function denied(reason: CapabilityDenial): CapabilityResult {
  return { allowed: false, reason };
}

const ALLOWED: CapabilityResult = Object.freeze({ allowed: true });

function fill(result: (key: CapabilityKey) => CapabilityResult): CharterCapabilities {
  const out = {} as Record<CapabilityKey, CapabilityResult>;
  for (const key of CAPABILITY_KEYS) out[key] = result(key);
  return Object.freeze(out);
}

/**
 * The capability set for one charter under one policy.
 *
 * Denials are ordered by how far the answer is from being yes: a kill switch
 * beats a missing charter, a missing charter beats a dead one, a dead one beats
 * the wrong type. The order matters because the reason is shown to a player,
 * and "this bank cannot take deposits" is the wrong thing to tell someone whose
 * real problem is that banking is switched off.
 */
export function charterCapabilities(
  charter: CharterLike,
  policy: CapabilityPolicy = CAPABILITY_POLICY_ALL_ON
): CharterCapabilities {
  if (!policy.privateBanking) return fill(() => denied("banking_disabled"));
  if (!charter) return fill(() => denied("no_charter"));
  if (charter.status !== "active") return fill(() => denied("charter_inactive"));
  const structural = BY_TYPE[charter.type] ?? new Set<CapabilityKey>();
  return fill((key) => {
    if (!structural.has(key)) return denied("charter_type");
    if (NEEDS_PROP_TRADING.has(key) && !policy.propTrading) {
      return denied("prop_trading_disabled");
    }
    return ALLOWED;
  });
}

/** Shorthand for the common one-question call. */
export function charterMay(
  charter: CharterLike,
  key: CapabilityKey,
  policy: CapabilityPolicy = CAPABILITY_POLICY_ALL_ON
): boolean {
  return charterCapabilities(charter, policy)[key].allowed;
}

/**
 * Structural capabilities of a charter TYPE, ignoring status and switches.
 * For the places that reason about a type a bank might move to.
 */
export function charterTypeMay(type: BankCharterType, key: CapabilityKey): boolean {
  return BY_TYPE[type]?.has(key) ?? false;
}

const CAPABILITY_LABEL: Readonly<Record<CapabilityKey, string>> = {
  acceptPlayerDeposits: "hold player savings",
  acceptNpcFunding: "take household deposits",
  householdLending: "lend to households",
  namedCorporationLending: "lend to corporations",
  namedCharacterLending: "lend to individuals",
  interbankLending: "lend on the interbank market",
  interbankBorrowing: "borrow on the interbank market",
  proprietaryTrading: "run a proprietary book",
  discountWindow: "draw on the discount window",
  centralBankMargin: "draw on the central bank margin line",
  serviceLoanBook: "service a loan book",
  setRates: "set deposit and lending rates",
  branchNetwork: "run a branch network",
};

const TYPE_LABEL: Readonly<Record<BankCharterType, string>> = {
  retail: "A retail bank",
  investment: "An investment bank",
  universal: "A universal bank",
};

/**
 * One sentence a player can act on, for each way a capability can be denied.
 * The call site adds nothing; a second phrasing of the same rule is a second
 * chance for the rule and its explanation to drift apart.
 */
export function capabilityMessage(
  key: CapabilityKey,
  reason: CapabilityDenial,
  charterType?: BankCharterType
): string {
  const verb = CAPABILITY_LABEL[key];
  switch (reason) {
    case "banking_disabled":
      return "Private banking is not enabled.";
    case "prop_trading_disabled":
      return "Bank trading and interbank facilities are switched off right now.";
    case "no_charter":
      return "This corporation has no bank charter.";
    case "charter_inactive":
      return "This bank's charter is no longer active.";
    case "charter_type":
      return `${charterType ? TYPE_LABEL[charterType] : "This bank"} cannot ${verb}.`;
  }
}
