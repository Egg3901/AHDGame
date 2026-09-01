import { describe, it, expect } from "vitest";
import {
  isOfferLive,
  validatePeaceOffer,
  withdrawalGate,
  sideWouldEmpty,
  maxIndemnityForGdp,
  partyDisplayName,
  PEACE_INDEMNITY_MAX_GDP_SHARE,
} from "../peaceOffer";
import { PEACE_OFFER_DURATION_TURNS, TRUCE_TURNS } from "@/lib/db/types/peaceOffer";
import type { ConflictDoc } from "@/lib/db/types/conflict";

const conflict = {
  _id: "t1",
  status: "active",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state" },
} as unknown as ConflictDoc;

const term = { kind: "indemnity", payer: "UK", amount: 100 } as const;

describe("isOfferLive", () => {
  it("is live while pending and inside the window", () => {
    expect(isOfferLive({ status: "pending", expiresTurn: 50 }, 49)).toBe(true);
  });

  it("is dead ON the expiry turn", () => {
    expect(isOfferLive({ status: "pending", expiresTurn: 50 }, 50)).toBe(false);
  });

  it("is dead past the window even though status still says pending", () => {
    // The lazy-expiry rule. A reader checking only `status` would accept this.
    expect(isOfferLive({ status: "pending", expiresTurn: 50 }, 51)).toBe(false);
  });

  it("is dead once resolved, whatever the turn", () => {
    for (const status of ["accepted", "rejected", "withdrawn", "expired"] as const) {
      expect(isOfferLive({ status, expiresTurn: 999 }, 1)).toBe(false);
    }
  });
});

describe("validatePeaceOffer", () => {
  it("accepts opposed belligerents", () => {
    expect(validatePeaceOffer(conflict, "UK", "CN", term, "UK")).toEqual({ ok: true });
  });

  it("refuses a resolved war", () => {
    const done = { ...conflict, status: "resolved" } as ConflictDoc;
    expect(validatePeaceOffer(done, "UK", "CN", term, "UK").ok).toBe(false);
  });

  it("refuses two countries on the SAME side", () => {
    const r = validatePeaceOffer(
      conflict,
      "US",
      "UK",
      {
        kind: "indemnity" as const,
        payer: "US",
        amount: 0,
      },
      "US"
    );
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/same side/i);
  });

  it("refuses a country that is not in the war", () => {
    const r = validatePeaceOffer(conflict, "UK", "RU", term, "UK");
    expect(r.ok).toBe(false);
    // Its own message: "not in this war" is a different problem from "same side",
    // and an offerer can only act on the right one.
    expect((r as { error: string }).error).toMatch(/belligerent/i);
  });

  it("refuses a generated enemy — there is nobody to negotiate with", () => {
    // A generated side is defined by an EMPTY roster, which is the realistic shape.
    const gen = {
      ...conflict,
      sideB: { label: "Insurgents", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    const r = validatePeaceOffer(gen, "UK", "CN", term, "UK");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/no government/i);
  });

  it("names the generated problem, NOT a roster problem", () => {
    // Ordering regression. A generated side has countries: [], so a membership
    // check running first would report "must be belligerents" — true but useless,
    // since no roster edit could ever make that offer valid.
    const gen = {
      ...conflict,
      sideB: { label: "Insurgents", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    const r = validatePeaceOffer(gen, "UK", "CN", term, "UK");
    expect((r as { error: string }).error).not.toMatch(/belligerent/i);
  });

  it("refuses a negative indemnity", () => {
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        {
          kind: "indemnity" as const,
          payer: "UK",
          amount: -1,
        },
        "UK"
      ).ok
    ).toBe(false);
  });

  it("refuses a NaN indemnity", () => {
    // `amount < 0` would let NaN through, and NaN would then be $inc'd into a
    // treasury. The check is written as !(amount >= 0) precisely for this.
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        {
          kind: "indemnity" as const,
          payer: "UK",
          amount: NaN,
        },
        "UK"
      ).ok
    ).toBe(false);
  });

  it("refuses a payer who is not one of the two parties", () => {
    // US is a belligerent, but not a party to THIS offer — it cannot be billed for
    // a deal it is not in.
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        {
          kind: "indemnity" as const,
          payer: "US",
          amount: 5,
        },
        "UK"
      ).ok
    ).toBe(false);
  });

  it("accepts a zero indemnity — that is a white peace", () => {
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        {
          kind: "indemnity" as const,
          payer: "UK",
          amount: 0,
        },
        "UK"
      )
    ).toEqual({
      ok: true,
    });
  });

  it("accepts EITHER party as payer", () => {
    // A winning country may pay to disengage from a war it no longer wants.
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        {
          kind: "indemnity" as const,
          payer: "CN",
          amount: 5,
        },
        "UK"
      )
    ).toEqual({
      ok: true,
    });
  });

  it("does not care whether the payer can afford it", () => {
    // Deliberate: treasuryBalance is a signed position, and a country already in
    // debt must still be able to buy peace. (No cap passed — affordability and the
    // GDP ceiling are separate concerns; the ceiling is exercised below.)
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        {
          kind: "indemnity" as const,
          payer: "UK",
          amount: 1e15,
        },
        "UK"
      )
    ).toEqual({
      ok: true,
    });
  });

  it("refuses an indemnity above the payer's GDP-share ceiling when a cap is passed", () => {
    // The exploit: without a ceiling, `amount: 1e15` is accepted and moved on
    // accept, draining the payer treasury arbitrarily. With the GDP cap it is
    // rejected at offer time.
    const r = validatePeaceOffer(
      conflict,
      "UK",
      "CN",
      { kind: "indemnity" as const, payer: "UK", amount: 1e15 },
      "UK",
      1000
    );
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/GDP/i);
  });

  it("accepts an indemnity exactly at the ceiling", () => {
    expect(
      validatePeaceOffer(
        conflict,
        "UK",
        "CN",
        { kind: "indemnity" as const, payer: "UK", amount: 1000 },
        "UK",
        1000
      )
    ).toEqual({
      ok: true,
    });
  });
});

describe("maxIndemnityForGdp", () => {
  it("is the configured multiple of GDP", () => {
    expect(maxIndemnityForGdp(500)).toBe(500 * PEACE_INDEMNITY_MAX_GDP_SHARE);
  });

  it("is null when GDP is missing or non-positive (no assumed fallback)", () => {
    // Same stance as unitPurchasePrice: an assumed GDP is an uncapped indemnity by
    // the back door, so a no-GDP payer gets no ceiling to compute an offer against.
    expect(maxIndemnityForGdp(0)).toBeNull();
    expect(maxIndemnityForGdp(-1)).toBeNull();
    expect(maxIndemnityForGdp(null)).toBeNull();
    expect(maxIndemnityForGdp(undefined)).toBeNull();
    expect(maxIndemnityForGdp(NaN)).toBeNull();
  });
});

describe("sideWouldEmpty", () => {
  it("returns null while allies remain", () => {
    expect(sideWouldEmpty(conflict, "UK")).toBeNull();
  });

  it("names the side that empties when the last member leaves", () => {
    expect(sideWouldEmpty(conflict, "CN")).toBe("B");
  });

  it("returns null for a country not on either roster", () => {
    expect(sideWouldEmpty(conflict, "RU")).toBeNull();
  });

  it("names side A when A is the one that would empty", () => {
    const solo = {
      ...conflict,
      sideA: { label: "UK", countries: ["UK"], kind: "state" },
    } as unknown as ConflictDoc;
    expect(sideWouldEmpty(solo, "UK")).toBe("A");
  });

  it("accepts a set of leavers and empties the side when they are all of it", () => {
    const pact = {
      sideA: { label: "US", countries: ["US"], kind: "state" },
      sideB: { label: "Pact", countries: ["DD", "RU"], kind: "coalition" },
    } as unknown as ConflictDoc;
    // Treaty release takes DD and RU out together. Asked about DD alone this returns
    // null, and the war would sit active with an empty side B and no winner.
    expect(sideWouldEmpty(pact, ["DD", "RU"])).toBe("B");
    expect(sideWouldEmpty(pact, ["DD"])).toBeNull();
  });

  it("ignores leavers that are not on the side", () => {
    const pact = {
      sideA: { label: "US", countries: ["US"], kind: "state" },
      sideB: { label: "Pact", countries: ["DD"], kind: "state" },
    } as unknown as ConflictDoc;
    expect(sideWouldEmpty(pact, ["DD", "PL"])).toBe("B");
  });

  // A generated side carries `countries: []`. Without the length guard an `every` over
  // an empty array is vacuously true and every insurgency would read as "emptied".
  it("never names a side that was already empty", () => {
    const generated = {
      sideA: { label: "Gov", countries: ["CN"], kind: "state" },
      sideB: { label: "Rebels", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    expect(sideWouldEmpty(generated, ["CN"])).toBe("A");
  });
});

describe("validatePeaceOffer treaty bar", () => {
  const pact = {
    status: "active",
    sideA: { label: "US", countries: ["US"], kind: "state" },
    sideB: { label: "Pact", countries: ["DD", "RU"], kind: "coalition" },
    treatyEntries: [
      { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 5 },
    ],
  } as unknown as ConflictDoc;

  it("lets an auto-joined ally buy its OWN way out while its ally fights on", () => {
    // THE SEPARATE-PEACE BAR IS GONE, and this test is where it used to be asserted.
    // It kept a country a treaty had dragged in fighting until the member it came to
    // defend settled, which left it with no exit it could reach itself. Peeling a
    // coalition apart is now something the other side must pay for and the guest must
    // agree to, which is a price rather than a formality.
    const res = validatePeaceOffer(
      pact,
      "RU",
      "US",
      { kind: "indemnity" as const, payer: "RU", amount: 0 },
      "RU"
    );
    expect(res.ok).toBe(true);
  });

  it("allows the ally once the defended country has left the war", () => {
    const settled = {
      ...pact,
      sideB: { label: "Pact", countries: ["RU"], kind: "coalition" },
    } as unknown as ConflictDoc;
    expect(
      validatePeaceOffer(
        settled,
        "RU",
        "US",
        {
          kind: "indemnity" as const,
          payer: "RU",
          amount: 0,
        },
        "RU"
      ).ok
    ).toBe(true);
  });

  it("never bars the defended country itself", () => {
    expect(
      validatePeaceOffer(
        pact,
        "DD",
        "US",
        { kind: "indemnity" as const, payer: "DD", amount: 0 },
        "DD"
      ).ok
    ).toBe(true);
  });

  // The OFFERER is the country that leaves (acceptPeace sets leaver = offer.fromCountry).
  // An attacker offering peace to an auto-joined ally is the attacker giving up, and must
  // not be refused.
  it("never bars the attacker from offering peace to an ally", () => {
    expect(
      validatePeaceOffer(
        pact,
        "US",
        "RU",
        { kind: "indemnity" as const, payer: "US", amount: 0 },
        "US"
      ).ok
    ).toBe(true);
  });

  it("leaves a conflict with no treaty entries unaffected", () => {
    const plain = { ...pact, treatyEntries: undefined } as unknown as ConflictDoc;
    expect(
      validatePeaceOffer(
        plain,
        "RU",
        "US",
        { kind: "indemnity" as const, payer: "RU", amount: 0 },
        "RU"
      ).ok
    ).toBe(true);
  });
});

describe("constants", () => {
  it("stands an offer for 72 turns and a truce for 240", () => {
    // Player-facing copy renders from these, so a change here changes the UI too.
    expect(PEACE_OFFER_DURATION_TURNS).toBe(72);
    expect(TRUCE_TURNS).toBe(240);
  });
});

describe("findLiveOffer", () => {
  function stub(rows: unknown[]) {
    return {
      collection: () => ({ find: () => ({ toArray: async () => rows }) }),
    } as unknown as import("mongodb").Db;
  }

  it("ignores a stored-pending row whose window has passed", async () => {
    // The lazy-expiry rule at the query layer. Querying `status: "pending"` alone
    // would hand back a dead offer and let it be accepted.
    const { findLiveOffer } = await import("@/lib/db/collections/peaceOffers");
    const rows = [{ status: "pending", expiresTurn: 10 }];
    expect(await findLiveOffer(stub(rows), "t1", "UK", "CN", 11)).toBeNull();
  });

  it("returns the row while it is still inside its window", async () => {
    const { findLiveOffer } = await import("@/lib/db/collections/peaceOffers");
    const rows = [{ status: "pending", expiresTurn: 10 }];
    expect(await findLiveOffer(stub(rows), "t1", "UK", "CN", 9)).not.toBeNull();
  });
});

describe("the buy-out gate", () => {
  /** US (side A) vs DD + RU, RU dragged in under the Pact. The live shape. */
  const war = (over: Partial<ConflictDoc> = {}) =>
    ({
      _id: "w2",
      status: "active",
      sideA: { label: "United States", countries: ["US"], kind: "state" },
      sideB: { label: "East Germany", countries: ["DD", "RU"], kind: "coalition" },
      treatyEntries: [
        { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 415 },
      ],
      control: 100,
      controlStart: 100,
      ...over,
    }) as unknown as ConflictDoc;

  const buyOut = (
    c: ConflictDoc,
    to: "DD" | "RU",
    term = { kind: "indemnity" as const, payer: "US" as const, amount: 10 }
  ) => validatePeaceOffer(c, "US", to, term, to, 1e12);

  it("allows peeling a guest off, because the side still stands", () => {
    // RU leaving leaves DD fighting. This is the coalition-peeling the wiki has
    // advised as strategy since before it was possible.
    expect(buyOut(war(), "RU").ok).toBe(true);
  });

  it("refuses buying the war outright from a standing start", () => {
    // DD leaving takes RU with it as its treaty guest, so side B empties and the war
    // is simply bought. At the opening line the US has taken no ground for it.
    const res = buyOut(war(), "DD");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not far enough forward/i);
  });

  it("allows it once the front is deep enough in your favour", () => {
    // Side A wins as control falls toward 0, so 25 is three quarters of the way.
    expect(buyOut(war({ control: 25 }), "DD").ok).toBe(true);
  });

  it("refuses it just short of the threshold", () => {
    expect(buyOut(war({ control: 26 }), "DD").ok).toBe(false);
  });

  it("does not credit the other side's gains to you", () => {
    // The line has moved AGAINST the US here. `progressForSide` reads zero for a
    // losing side rather than reading its opponent's push as its own.
    const losing = war({ control: 100, controlStart: 40 });
    expect(buyOut(losing, "DD").ok).toBe(false);
  });

  it("always allows a WHITE PEACE, however the war is going", () => {
    // It records no victor and moves nothing, so nothing is bought: a war fought
    // over a question ends with the question still open.
    expect(buyOut(war(), "DD", { kind: "white_peace" } as never).ok).toBe(true);
  });

  it("refuses buying out the opposing PRINCIPAL even when its side still stands", () => {
    // Poland joined on its own rather than under the Pact, so DD leaving releases
    // nobody and the roster does not empty. The war ends anyway, because both
    // principals settled it — so this is a buy-out and the gate has to see it.
    const withJoiner = war({
      sideB: { label: "East Germany", countries: ["DD", "PL"], kind: "coalition" },
      treatyEntries: [],
      joinTurns: [{ countryId: "PL", turn: 20, control: 100 }],
    } as unknown as Partial<ConflictDoc>);
    const res = buyOut(withJoiner, "DD");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not far enough forward/i);
  });

  it("allows that buy-out once the front is deep enough", () => {
    const withJoiner = war({
      sideB: { label: "East Germany", countries: ["DD", "PL"], kind: "coalition" },
      treatyEntries: [],
      joinTurns: [{ countryId: "PL", turn: 20, control: 100 }],
      control: 25,
    } as unknown as Partial<ConflictDoc>);
    expect(buyOut(withJoiner, "DD").ok).toBe(true);
  });

  it("still allows peeling a mere JOINER off the opposing side", () => {
    // PL is not its side's principal, so its departure decides nothing and the gate
    // stays out of the way however the front looks.
    const withJoiner = war({
      sideB: { label: "East Germany", countries: ["DD", "PL"], kind: "coalition" },
      treatyEntries: [],
      joinTurns: [{ countryId: "PL", turn: 20, control: 100 }],
    } as unknown as Partial<ConflictDoc>);
    expect(
      validatePeaceOffer(
        withJoiner,
        "US",
        "PL",
        { kind: "indemnity" as const, payer: "US", amount: 10 },
        "PL",
        1e12
      ).ok
    ).toBe(true);
  });

  it("says WHY the departure ends the war, so the copy can tell the truth", () => {
    // The two roads end the war for different reasons, and the panel says something
    // false if it assumes the roster one: on the principal road the losing side is
    // still full of allies.
    const joined = {
      sideB: { label: "East Germany", countries: ["DD", "PL"], kind: "coalition" },
      treatyEntries: [],
      joinTurns: [{ countryId: "PL", turn: 20, control: 100 }],
    } as unknown as Partial<ConflictDoc>;
    expect(withdrawalGate(war(joined), "US", "DD").endsWarReason).toBe("principals");
    expect(withdrawalGate(war(), "US", "DD").endsWarReason).toBe("roster");
    expect(withdrawalGate(war(joined), "US", "PL").endsWarReason).toBe(null);
  });

  it("refuses a reunification the challenger itself withdraws under", () => {
    // "We leave the war AND Germany reunifies on our terms" is winning the question
    // by surrendering: the departure hands the war to the incumbent while the term
    // settles the crisis for the challenger. The two cannot both be true.
    const res = validatePeaceOffer(
      war(),
      "DD",
      "US",
      { kind: "reunification" as const },
      "DD",
      null,
      "presidential",
      null,
      { challenger: "DD" }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/withdraw|leave/i);
  });

  it("allows a reunification the OTHER side withdraws under", () => {
    const res = validatePeaceOffer(
      war(),
      "DD",
      "US",
      { kind: "reunification" as const },
      "US",
      null,
      "presidential",
      null,
      { challenger: "DD" }
    );
    expect(res.ok).toBe(true);
  });

  it("never gates an offer to leave YOURSELF", () => {
    // Walking away is always yours to propose, whatever the ground looks like.
    expect(validatePeaceOffer(war(), "US", "DD", { kind: "white_peace" as const }, "US").ok).toBe(
      true
    );
    expect(
      validatePeaceOffer(
        war(),
        "US",
        "DD",
        { kind: "indemnity" as const, payer: "US", amount: 10 },
        "US",
        1e12
      ).ok
    ).toBe(true);
  });

  it("refuses a leaver who is not a party to the deal", () => {
    expect(
      validatePeaceOffer(
        war(),
        "US",
        "DD",
        { kind: "indemnity" as const, payer: "US", amount: 10 },
        "RU" as never,
        1e12
      ).ok
    ).toBe(false);
  });
});

describe("partyDisplayName", () => {
  const choices = [
    { id: 1, name: "Sozialdemokratische Partei", abbreviation: "SPD" },
    { id: 7, name: "Sozialistische Einheitspartei" },
  ];

  it("prefers the abbreviation, which is what a field value and a clause both want", () => {
    expect(partyDisplayName(choices, 1)).toBe("SPD");
  });

  it("falls back to the full name for a party carrying no abbreviation", () => {
    // The wire resolved on `?.abbreviation` alone, so such a party reported as
    // though the settlement had named nobody.
    expect(partyDisplayName(choices, 7)).toBe("Sozialistische Einheitspartei");
  });

  it("is null for an id the country does not hold, and for no list at all", () => {
    expect(partyDisplayName(choices, 99)).toBeNull();
    expect(partyDisplayName(undefined, 1)).toBeNull();
  });
});
