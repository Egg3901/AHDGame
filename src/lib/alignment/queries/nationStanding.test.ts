import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { polesForYear, resolveAlignmentEra } from "@/lib/constants/alignmentEras";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import { eraPoleVocabulary, projectNationStanding } from "./nationStanding";

const ERA = resolveAlignmentEra(1953);
const POLES = polesForYear(1953);
const ctx = (memberPoles: string[] = [], preset?: string) => ({
  era: ERA,
  poleIds: POLES,
  memberPoleIds: new Set(memberPoles) as never,
  preset,
});

const doc = (over: Partial<CountryAlignment> = {}): CountryAlignment =>
  ({
    _id: new ObjectId(),
    entityId: "YU",
    eraKey: "cold-war",
    shares: { WEST: 22, EAST: 50 },
    nonAligned: 28,
    previous: null,
    turn: 3,
    updatedAt: new Date(),
    ...over,
  }) as CountryAlignment;

describe("projectNationStanding", () => {
  it("projects shares, lead and the era's axis", () => {
    const s = projectNationStanding(doc(), ctx())!;
    expect(s.shares).toEqual({ WEST: 22, EAST: 50 });
    expect(s.nonAligned).toBe(28);
    expect(s.lead).toBe(28); // 50 - 22
    expect(s.axis).toBe(-28); // two-pole era: WEST - EAST
    expect(s.isPlayable).toBe(true); // Yugoslavia is a modelled country
  });

  it("marks a roster-only entity as not playable", () => {
    // Jordan is sphere-macro: it has a roster name but no CountryConfig, and
    // the distinction is what stops callers indexing COUNTRY_CONFIGS blindly.
    const s = projectNationStanding(doc({ entityId: "JO" } as never), ctx())!;
    expect(s.name).toBe("Jordan");
    expect(s.isPlayable).toBe(false);
  });

  it("returns null for an entity the game no longer models", () => {
    // A stale row must not render as a nameless entry.
    expect(projectNationStanding(doc({ entityId: "ZZ" } as never), ctx())).toBeNull();
  });

  it("has no trend until a turn has passed", () => {
    expect(projectNationStanding(doc(), ctx())!.trend).toBeNull();
    expect(projectNationStanding(doc(), ctx())!.previousShares).toBeNull();
  });

  it("reports the trend in LEAD, snapped to a tenth", () => {
    // Raw subtraction of tenth-valued leads leaves binary dust that the UI
    // would print verbatim.
    const s = projectNationStanding(
      doc({
        shares: { WEST: 22.1, EAST: 50 },
        previous: { shares: { WEST: 22.4, EAST: 50 }, nonAligned: 27.6 },
      } as never),
      ctx()
    )!;
    expect(String(s.trend)).toBe("0.3");
    expect(s.previousShares).toEqual({ WEST: 22.4, EAST: 50 });
  });

  it("reads as loyal only when it belongs to the pole it leads toward", () => {
    const leaning = doc({ shares: { WEST: 70, EAST: 10 }, nonAligned: 20 } as never);
    expect(projectNationStanding(leaning, ctx([]))!.status).toBe("eligible");
    expect(projectNationStanding(leaning, ctx(["WEST"]))!.status).toBe("loyal");
  });
});

describe("eraPoleVocabulary", () => {
  it("names the remainder for what it actually is in each era", () => {
    // Before the Non-Aligned Movement is founded the leftover is merely
    // uncommitted; calling it non-aligned would name a thing that does not
    // exist yet.
    expect(eraPoleVocabulary(1953).remainderLabel).toBe("Uncommitted");
    expect(eraPoleVocabulary(1961).remainderLabel).toBe("Non-aligned");
    expect(eraPoleVocabulary(2019).remainderLabel).toBe("Non-aligned");
  });

  it("gives every pole a colour token, never a raw colour", () => {
    // The app ships eleven themes; a hex here would survive none of them.
    for (const pole of eraPoleVocabulary(1953).poles) {
      expect(pole.accentToken).toMatch(/^(info|error|warning|success)$/);
      expect(pole.label.length).toBeGreaterThan(0);
    }
  });

  it("is the single source both screens read", () => {
    // The Ledger and the Influence tab draw the same nation. This function is
    // why they cannot disagree about what its poles or its remainder are
    // called — the derivation used to be copied into both queries.
    const y = 1979;
    expect(eraPoleVocabulary(y)).toEqual(eraPoleVocabulary(y));
    expect(eraPoleVocabulary(y).poles.map((p) => p.id)).toEqual(polesForYear(y));
  });
});

describe("era-aware names", () => {
  it("calls a country by the name it had in that era", () => {
    // The rest of the app already says West Germany and Soviet Union in a Cold
    // War world; the alignment screens said Germany and Russia.
    const de = doc({ entityId: "DE" } as never);
    expect(projectNationStanding(de, ctx([], "1953-default"))!.name).toBe("West Germany");
    expect(projectNationStanding(de, ctx([], "1979-default"))!.name).toBe("West Germany");

    const ru = doc({ entityId: "RU" } as never);
    expect(projectNationStanding(ru, ctx([], "1953-default"))!.name).toBe("Soviet Union");
  });

  it("uses the modern name outside those eras", () => {
    const de = doc({ entityId: "DE" } as never);
    expect(projectNationStanding(de, ctx([], "2019-default"))!.name).toBe("Germany");
    expect(projectNationStanding(de, ctx())!.name).toBe("Germany");
  });

  it("leaves a roster-only entity's name alone", () => {
    // Macro entities have no CountryConfig and no era override to apply.
    expect(
      projectNationStanding(doc({ entityId: "JO" } as never), ctx([], "1953-default"))!.name
    ).toBe("Jordan");
  });
});
