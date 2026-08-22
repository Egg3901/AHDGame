import { describe, it, expect } from "vitest";
import { textureFromBoards, TEXTURE_CAP } from "./playableTexture";

describe("textureFromBoards", () => {
  it("centres each family on zero so the country mean is preserved", () => {
    const out = textureFromBoards({
      A: { "order.safety": 60 },
      B: { "order.safety": 70 },
      C: { "order.safety": 80 },
    });
    expect(out.A["order.safety"]).toBeCloseTo(-10, 6);
    expect(out.C["order.safety"]).toBeCloseTo(10, 6);
    const sum = out.A["order.safety"] + (out.B?.["order.safety"] ?? 0) + out.C["order.safety"];
    expect(sum).toBeCloseTo(0, 6);
  });

  it("drops deviations below the noise floor", () => {
    const out = textureFromBoards({
      A: { "order.safety": 50.1 },
      B: { "order.safety": 49.9 },
    });
    expect(out.A?.["order.safety"]).toBeUndefined();
    expect(out.B?.["order.safety"]).toBeUndefined();
  });

  it("scales an over-wide family into the cap instead of clamping it", () => {
    const out = textureFromBoards({
      A: { "economy.stability": 0 },
      B: { "economy.stability": 50 },
      C: { "economy.stability": 100 },
    });
    // Raw deviations are -50/0/+50; scaling by 12/50 gives -12/0/+12.
    expect(out.A["economy.stability"]).toBeCloseTo(-TEXTURE_CAP, 6);
    expect(out.C["economy.stability"]).toBeCloseTo(TEXTURE_CAP, 6);
    // Clamping would have shifted an asymmetric family's mean; scaling never does.
    const sum =
      out.A["economy.stability"] + (out.B?.["economy.stability"] ?? 0) + out.C["economy.stability"];
    expect(sum).toBeCloseTo(0, 6);
  });

  it("preserves rank ordering when it scales", () => {
    const out = textureFromBoards({
      A: { "society.demography": 10 },
      B: { "society.demography": 40 },
      C: { "society.demography": 90 },
    });
    expect(out.A["society.demography"]).toBeLessThan(out.B?.["society.demography"] ?? 0);
    expect(out.B?.["society.demography"] ?? 0).toBeLessThan(out.C["society.demography"]);
  });

  it("emits nothing for a family that is already uniform", () => {
    const out = textureFromBoards({
      A: { "environment.conservation": 100 },
      B: { "environment.conservation": 100 },
    });
    expect(out.A?.["environment.conservation"]).toBeUndefined();
  });

  /**
   * Regression: entries that will be thrown away must not be counted into the
   * mean, or the survivors stop summing to zero.
   *
   * The hand-authored REGIONAL_MODIFIERS_1953 entries win over texture, so the
   * generator drops the colliding pairs. Those collisions are NOT randomly
   * placed: an authored modifier exists precisely where the seed author already
   * knew the region was extreme, and the derivation finds the same region
   * extreme. Centring first and dropping afterwards therefore removes a biased
   * tail and shifts the country mean -- measured at 1.02 points on US
   * society.integration before this was fixed.
   */
  it("excludes dropped pairs from the mean instead of centring around them", () => {
    const boards = {
      MS: { "society.integration": 20 },
      AL: { "society.integration": 25 },
      NY: { "society.integration": 70 },
      CA: { "society.integration": 75 },
    };
    // MS and AL carry hand-authored modifiers, so they get no texture.
    const exclude = (regionId: string, family: string) =>
      family === "society.integration" && (regionId === "MS" || regionId === "AL");

    const out = textureFromBoards(boards, exclude);

    expect(out.MS?.["society.integration"]).toBeUndefined();
    expect(out.AL?.["society.integration"]).toBeUndefined();
    // The survivors are centred on THEIR OWN mean (72.5), not on all four (47.5).
    expect(out.NY["society.integration"]).toBeCloseTo(-2.5, 6);
    expect(out.CA["society.integration"]).toBeCloseTo(2.5, 6);
    const sum = out.NY["society.integration"] + out.CA["society.integration"];
    expect(sum).toBeCloseTo(0, 6);
  });

  /**
   * The noise floor is the ONE thing that stops the mean being preserved
   * exactly: a family where most regions sit near the mean drops all those
   * small deviations and keeps only the outlier, so the surviving entries no
   * longer sum to zero. This is the worst realistic shape for that -- 50
   * regions flat, one outlier -- and it pins how far the country mean can move.
   * If this bound ever grows, the seed's mean-preservation claim is false and
   * the noise floor needs revisiting, not this assertion.
   */
  it("keeps the country-mean shift from noise-floor dropping small", () => {
    const boards: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 50; i++) boards[`R${i}`] = { "order.safety": 50 };
    boards.OUTLIER = { "order.safety": 62 };

    const out = textureFromBoards(boards);
    const kept = Object.values(out)
      .map((f) => f["order.safety"])
      .filter((v): v is number => typeof v === "number");

    // Only the outlier survives the floor.
    expect(kept).toHaveLength(1);
    // Its deviation spread over the whole country is the mean shift.
    const meanShift = kept.reduce((a, b) => a + b, 0) / Object.keys(boards).length;
    expect(Math.abs(meanShift)).toBeLessThan(0.25);
  });
});
