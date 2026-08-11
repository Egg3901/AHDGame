import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import {
  calculateFiscalYearForCountry,
  getFiscalCalendarConfig,
  getSharedFiscalYearStartTurnInYear,
  getTurnInYear,
  isFiscalYearEndForCountry,
} from "./fiscalCalendar";

describe("fiscalCalendar", () => {
  it("keeps the current shared fiscal-year anchor across all configured countries", () => {
    expect(getSharedFiscalYearStartTurnInYear()).toBe(40);
    for (const countryId of COUNTRY_ORDER) {
      expect(getFiscalCalendarConfig(countryId).startTurnInYear).toBe(40);
    }
  });

  it("computes turn-in-year against the global 48-turn clock", () => {
    expect(getTurnInYear(1)).toBe(1);
    expect(getTurnInYear(40)).toBe(40);
    expect(getTurnInYear(49)).toBe(1);
  });

  it("calculates fiscal-year boundaries without changing live behavior", () => {
    expect(isFiscalYearEndForCountry("US", 40)).toBe(true);
    expect(isFiscalYearEndForCountry("JP", 88)).toBe(true);
    expect(calculateFiscalYearForCountry("DE", 2024, 39)).toBe(2024);
    expect(calculateFiscalYearForCountry("UK", 2024, 40)).toBe(2025);
  });
});
