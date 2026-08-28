import { describe, expect, it } from "vitest";
import { getCabinetMechanics, getCabinetPositions } from "./cabinetMechanics";
import {
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
} from "./internationalOrganizations";
import { DEFENSE_POSITION_BY_COUNTRY } from "./military";

const COUNTRIES = ["FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR", "BR"] as const;

describe("econ-only cabinet baseline", () => {
  it.each(COUNTRIES)("registers active domestic and strategic portfolios for %s", (countryId) => {
    const ids = getCabinetPositions(countryId).map((position) => position.id);
    expect(ids).toContain("minister_of_finance");
    expect(ids).toContain("minister_of_foreign_affairs");
    expect(ids).toContain("minister_of_trade_industry");
    expect(ids).toContain("minister_of_defence");
    for (const id of ids)
      expect(getCabinetMechanics(countryId, id), `${countryId}:${id}`).toBeDefined();
  });

  it.each(COUNTRIES)("routes %s diplomacy, trade, and defence through real seats", (countryId) => {
    expect(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId]).toBe("minister_of_foreign_affairs");
    expect(TRADE_MINISTER_POSITION_BY_COUNTRY[countryId]).toBe("minister_of_trade_industry");
    expect(DEFENSE_POSITION_BY_COUNTRY[countryId]).toBe("minister_of_defence");
  });

  it("routes Nigeria trade through its existing trade minister", () => {
    expect(TRADE_MINISTER_POSITION_BY_COUNTRY.NG).toBe("minister_of_trade_industry");
  });
});
