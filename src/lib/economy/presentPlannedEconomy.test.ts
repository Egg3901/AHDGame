import { describe, expect, it } from "vitest";
import {
  presentPlannedEconomy,
  resolveMarketizationLevel,
  shouldShowPlannedEconomy,
} from "./presentPlannedEconomy";

describe("presentPlannedEconomy", () => {
  it("hides for market countries when the flag is off and fields are absent", () => {
    expect(shouldShowPlannedEconomy("US", 2019, false, {})).toBe(false);
    expect(presentPlannedEconomy("US", 2019, false, {})).toBeNull();
  });

  it("shows command regime for USSR when enabled", () => {
    const view = presentPlannedEconomy("RU", 1979, true, {
      monetaryOverhang: 40,
      shortageIndex: 55,
      blackMarketPremium: 0.3,
      secondEconomyShare: 0.12,
    });
    expect(view).not.toBeNull();
    expect(view!.regime).toBe("command");
    expect(view!.regimeLabel).toBe("Command economy");
    expect(view!.blackMarketPremium).toBe(0.3);
    expect(view!.secondEconomyShare).toBe(0.12);
  });

  it("shows dual-track for reform-era China when enabled", () => {
    const view = presentPlannedEconomy("CN", 1985, true, {});
    expect(view).not.toBeNull();
    expect(view!.regime).toBe("dual-track");
  });

  it("surfaces persisted fields even when the flag is off", () => {
    const view = presentPlannedEconomy("US", 2019, false, {
      monetaryOverhang: 10,
    });
    expect(view).not.toBeNull();
    expect(view!.monetaryOverhang).toBe(10);
  });

  // ── P1 read-path seam: read the PERSISTED level, not the process-local one ──
  it("prefers the persisted marketizationLevel over the era-schedule fallback", () => {
    // RU 1979 schedule level = 10 (command). A country that has drifted to a
    // dual-track 45 must render dual-track from the persisted value, since a
    // read process never hydrated the stored-level registry.
    const view = presentPlannedEconomy("RU", 1979, true, {
      marketizationLevel: 45,
      monetaryOverhang: 5,
    });
    expect(view).not.toBeNull();
    expect(view!.marketizationLevel).toBe(45);
    expect(view!.regime).toBe("dual-track");
  });
});

describe("resolveMarketizationLevel", () => {
  it("returns the persisted level when present", () => {
    expect(resolveMarketizationLevel("RU", 1979, { marketizationLevel: 55 })).toBe(55);
  });

  it("falls back to the era schedule when no persisted level", () => {
    expect(resolveMarketizationLevel("RU", 1979, {})).toBe(10); // RU command seed
    expect(resolveMarketizationLevel("RU", 1979, { marketizationLevel: NaN })).toBe(10);
  });
});
