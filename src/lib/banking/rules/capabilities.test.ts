import { describe, expect, it } from "vitest";
import type { BankCharterStatus, BankCharterType } from "@/lib/db/types/bank";
import {
  CAPABILITY_KEYS,
  capabilityMessage,
  charterCapabilities,
  charterMay,
  charterTypeMay,
  type CapabilityKey,
} from "./capabilities";

const TYPES: BankCharterType[] = ["retail", "investment", "universal"];
const STATUSES: BankCharterStatus[] = ["active", "revoked", "failed"];

/**
 * The structural table, written out so a change to the rules module has to be
 * matched by a change here. Every key not listed for a type is denied with
 * `charter_type`.
 */
const STRUCTURAL: Record<BankCharterType, CapabilityKey[]> = {
  retail: [
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
  ],
  investment: [
    "namedCorporationLending",
    "interbankBorrowing",
    "proprietaryTrading",
    "centralBankMargin",
    "serviceLoanBook",
  ],
  universal: [...CAPABILITY_KEYS],
};

const PROP_GATED: CapabilityKey[] = [
  "interbankLending",
  "interbankBorrowing",
  "proprietaryTrading",
  "centralBankMargin",
];

function allowedKeys(charter: Parameters<typeof charterCapabilities>[0], policy = undefined) {
  const caps = charterCapabilities(charter, policy);
  return CAPABILITY_KEYS.filter((key) => caps[key].allowed);
}

describe("charterCapabilities matrix", () => {
  describe.each(TYPES)("%s charter", (type) => {
    it.each(STATUSES)("status %s with every switch on", (status) => {
      const caps = charterCapabilities({ type, status });
      if (status !== "active") {
        for (const key of CAPABILITY_KEYS) {
          expect(caps[key]).toEqual({ allowed: false, reason: "charter_inactive" });
        }
        return;
      }
      for (const key of CAPABILITY_KEYS) {
        const structural = STRUCTURAL[type].includes(key);
        expect(caps[key], `${type}.${key}`).toEqual(
          structural ? { allowed: true } : { allowed: false, reason: "charter_type" }
        );
      }
    });

    it("loses only the prop-gated capabilities when prop trading is off", () => {
      const on = charterCapabilities({ type, status: "active" });
      const off = charterCapabilities(
        { type, status: "active" },
        { privateBanking: true, propTrading: false }
      );
      for (const key of CAPABILITY_KEYS) {
        if (PROP_GATED.includes(key) && on[key].allowed) {
          expect(off[key]).toEqual({ allowed: false, reason: "prop_trading_disabled" });
        } else {
          expect(off[key]).toEqual(on[key]);
        }
      }
    });

    it("denies everything with banking off, whatever the prop switch says", () => {
      for (const propTrading of [true, false]) {
        const caps = charterCapabilities(
          { type, status: "active" },
          { privateBanking: false, propTrading }
        );
        for (const key of CAPABILITY_KEYS) {
          expect(caps[key]).toEqual({ allowed: false, reason: "banking_disabled" });
        }
      }
    });
  });

  it("denies everything for a corporation with no charter", () => {
    for (const charter of [null, undefined]) {
      const caps = charterCapabilities(charter);
      for (const key of CAPABILITY_KEYS) {
        expect(caps[key]).toEqual({ allowed: false, reason: "no_charter" });
      }
    }
  });

  it("ranks the kill switch above a missing charter", () => {
    const caps = charterCapabilities(null, { privateBanking: false, propTrading: true });
    expect(caps.acceptPlayerDeposits.reason).toBe("banking_disabled");
  });

  it("returns frozen results so a caller cannot edit the table", () => {
    const caps = charterCapabilities({ type: "retail", status: "active" });
    expect(Object.isFrozen(caps)).toBe(true);
    expect(() => {
      (caps as Record<string, unknown>).acceptPlayerDeposits = { allowed: false };
    }).toThrow();
  });

  it("keeps the deposit-taking set and the household-lending set identical", () => {
    for (const type of TYPES) {
      expect(charterTypeMay(type, "acceptPlayerDeposits")).toBe(
        charterTypeMay(type, "householdLending")
      );
      expect(charterTypeMay(type, "acceptNpcFunding")).toBe(
        charterTypeMay(type, "householdLending")
      );
    }
  });

  it("services the loan book of every active charter type", () => {
    for (const type of TYPES) {
      expect(charterMay({ type, status: "active" }, "serviceLoanBook")).toBe(true);
      expect(charterMay({ type, status: "active" }, "namedCorporationLending")).toBe(true);
    }
  });

  it("closes household and individual lending to an investment bank", () => {
    expect(allowedKeys({ type: "investment", status: "active" })).toEqual(STRUCTURAL.investment);
  });
});

describe("capabilityMessage", () => {
  it("names the charter type when the type is the reason", () => {
    expect(capabilityMessage("acceptPlayerDeposits", "charter_type", "investment")).toBe(
      "An investment bank cannot hold player savings."
    );
    expect(capabilityMessage("centralBankMargin", "charter_type", "retail")).toBe(
      "A retail bank cannot draw on the central bank margin line."
    );
  });

  it("does not blame the charter when a switch is the reason", () => {
    expect(capabilityMessage("proprietaryTrading", "prop_trading_disabled")).not.toContain(
      "bank cannot"
    );
    expect(capabilityMessage("acceptNpcFunding", "banking_disabled")).toBe(
      "Private banking is not enabled."
    );
  });

  it("has a sentence for every key and reason", () => {
    for (const key of CAPABILITY_KEYS) {
      for (const reason of [
        "banking_disabled",
        "prop_trading_disabled",
        "no_charter",
        "charter_inactive",
        "charter_type",
      ] as const) {
        expect(capabilityMessage(key, reason, "universal")).toMatch(/\.$/);
      }
    }
  });
});
