import { describe, expect, it } from "vitest";
import {
  applyCaucusCohesion,
  factionCentreOfGravity,
  scoreDivergence,
  CAUCUS_COHESION_WEIGHT,
  type ScoredOfficial,
} from "./factionDivergence";

/** The CPSU's seeded line on the live 1953 world. */
const CPSU = { economic: -4, social: 2 };

describe("scoreDivergence", () => {
  it("scores a loyalist at zero and a polar opposite at one", () => {
    expect(scoreDivergence({ characterId: "a", economic: -4, social: 2 }, CPSU)).toBe(0);
    expect(
      scoreDivergence({ characterId: "b", economic: 5, social: -5 }, { economic: -5, social: 5 })
    ).toBe(1);
  });

  it("rises monotonically with distance from the line", () => {
    const near = scoreDivergence({ characterId: "a", economic: -3, social: 2 }, CPSU);
    const mid = scoreDivergence({ characterId: "b", economic: 0, social: 2 }, CPSU);
    const far = scoreDivergence({ characterId: "c", economic: 4, social: -3 }, CPSU);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
  });

  it("treats a missing position as loyal rather than maximally divergent", () => {
    // Otherwise every imported official with no recorded position is purged first.
    expect(scoreDivergence({ characterId: "a", economic: null, social: 2 }, CPSU)).toBe(0);
    expect(
      scoreDivergence({ characterId: "b", economic: undefined, social: undefined }, CPSU)
    ).toBe(0);
    expect(scoreDivergence({ characterId: "c", economic: Number.NaN, social: 1 }, CPSU)).toBe(0);
  });
});

describe("applyCaucusCohesion", () => {
  const mk = (id: string, divergence: number, caucusId: string | null): ScoredOfficial => ({
    characterId: id,
    divergence,
    caucusId,
  });

  it("pulls a caucus's members toward their shared mean so they leave together", () => {
    const out = applyCaucusCohesion([
      mk("militant", 0.9, "new-leninist-course"),
      mk("moderate", 0.1, "new-leninist-course"),
    ]);
    const mean = 0.5;
    const w = CAUCUS_COHESION_WEIGHT;
    expect(out[0].divergence).toBeCloseTo(0.9 * (1 - w) + mean * w, 6);
    expect(out[1].divergence).toBeCloseTo(0.1 * (1 - w) + mean * w, 6);
    // They now sit far closer together than the 0.8 gap they started with.
    expect(Math.abs(out[0].divergence - out[1].divergence)).toBeLessThan(0.4);
  });

  it("leaves unaffiliated officials exactly as scored", () => {
    const out = applyCaucusCohesion([mk("lone", 0.7, null), mk("other", 0.2, null)]);
    expect(out[0].divergence).toBe(0.7);
    expect(out[1].divergence).toBe(0.2);
  });

  it("ranks a cohesive moderate caucus above a lone hardliner when the caucus is more divergent", () => {
    const out = applyCaucusCohesion([
      mk("hardliner", 0.55, null),
      mk("factionA", 0.6, "reform-circle"),
      mk("factionB", 0.7, "reform-circle"),
    ]);
    const byId = new Map(out.map((o) => [o.characterId, o.divergence]));
    expect(byId.get("factionA")!).toBeGreaterThan(byId.get("hardliner")!);
    expect(byId.get("factionB")!).toBeGreaterThan(byId.get("hardliner")!);
  });

  it("is a no-op at weight 0 and full averaging at weight 1", () => {
    const input = [mk("a", 0.9, "c1"), mk("b", 0.1, "c1")];
    expect(applyCaucusCohesion(input, 0).map((o) => o.divergence)).toEqual([0.9, 0.1]);
    const full = applyCaucusCohesion(input, 1);
    expect(full[0].divergence).toBeCloseTo(0.5, 6);
    expect(full[1].divergence).toBeCloseTo(0.5, 6);
  });

  it("keeps every result inside 0..1", () => {
    const out = applyCaucusCohesion([mk("a", 5, "c1"), mk("b", -3, "c1"), mk("c", 2, null)]);
    for (const o of out) {
      expect(o.divergence).toBeGreaterThanOrEqual(0);
      expect(o.divergence).toBeLessThanOrEqual(1);
    }
  });
});

describe("factionCentreOfGravity", () => {
  it("positions the new party where its defectors sit, not where the parent sits", () => {
    const centre = factionCentreOfGravity(
      [
        { economic: 0, social: 1 },
        { economic: 2, social: 3 },
      ],
      CPSU
    );
    expect(centre).toEqual({ economic: 1, social: 2 });
    // The whole point: it is NOT the party it walked out of.
    expect(centre).not.toEqual(CPSU);
  });

  it("falls back to the party line when no defector has a position", () => {
    expect(factionCentreOfGravity([], CPSU)).toEqual(CPSU);
    expect(factionCentreOfGravity([{ economic: null, social: null }], CPSU)).toEqual(CPSU);
  });

  it("ignores defectors with unusable positions rather than dragging the centre to zero", () => {
    const centre = factionCentreOfGravity(
      [
        { economic: 2, social: 2 },
        { economic: Number.NaN, social: 0 },
      ],
      CPSU
    );
    expect(centre).toEqual({ economic: 2, social: 2 });
  });
});
