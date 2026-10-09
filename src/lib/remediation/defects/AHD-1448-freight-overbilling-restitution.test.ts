import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  DEFECT_ID,
  defect,
  pinnedTotalAnchor,
  planCorporationCredit,
} from "./AHD-1448-freight-overbilling-restitution";
import {
  FREIGHT_OVERBILLING_BY_CORPORATION,
  FREIGHT_OVERBILLING_WINDOW,
} from "./AHD-1448-freight-overbilling-restitution.data";

describe("AHD-1448 freight overbilling restitution", () => {
  it("pins one positive credit per corporation over a closed window", () => {
    const ids = FREIGHT_OVERBILLING_BY_CORPORATION.map((row) => row.corporationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of FREIGHT_OVERBILLING_BY_CORPORATION) {
      expect(ObjectId.isValid(row.corporationId)).toBe(true);
      expect(row.overchargeAnchor).toBeGreaterThan(0);
    }
    expect(FREIGHT_OVERBILLING_WINDOW.lastCorpTurn).toBeGreaterThan(
      FREIGHT_OVERBILLING_WINDOW.firstCorpTurn
    );
    expect(pinnedTotalAnchor()).toBeGreaterThan(0);
    expect(defect.guards).toContain(`max-affected:400`);
    expect(FREIGHT_OVERBILLING_BY_CORPORATION.length).toBeLessThanOrEqual(400);
  });

  it("credits in the corporation's settlement currency at the live rate", () => {
    const doc = {
      _id: new ObjectId(),
      name: "Co",
      countryId: "JP",
      liquidCurrencyCode: "JPY" as const,
    };
    const planned = planCorporationCredit(
      { corporationId: doc._id.toString(), overchargeAnchor: 1_000 },
      doc,
      new Map([["JPY", 121.8]])
    );
    expect(planned).toMatchObject({ currencyCode: "JPY", fxRate: 121.8, creditAnchor: 1_000 });
    expect(planned!.creditLocal).toBeCloseTo(121_800, 6);
  });

  it("skips a corporation that is gone, already credited, or has no usable rate", () => {
    const id = new ObjectId();
    const row = { corporationId: id.toString(), overchargeAnchor: 500 };
    expect(planCorporationCredit(row, undefined, new Map())).toBeNull();
    expect(
      planCorporationCredit(
        row,
        { _id: id, liquidCurrencyCode: "USD", remediation: { [DEFECT_ID]: { ticket: 1448 } } },
        new Map([["USD", 1]])
      )
    ).toBeNull();
    expect(
      planCorporationCredit(row, { _id: id, liquidCurrencyCode: "GBP" }, new Map())
    ).toBeNull();
  });

  it("treats a pre-forex corporation's capital as anchor", () => {
    const id = new ObjectId();
    const planned = planCorporationCredit(
      { corporationId: id.toString(), overchargeAnchor: 250 },
      { _id: id, countryId: "US" },
      new Map()
    );
    expect(planned).toMatchObject({ fxRate: 1, creditLocal: 250 });
  });
});
