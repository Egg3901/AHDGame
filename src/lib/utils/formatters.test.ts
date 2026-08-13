import { describe, it, expect, vi } from "vitest";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  formatCompactNumber,
  formatCurrency,
  formatPartyCountryMoney,
  formatCurrencyCompactChip,
  formatFundsCompact,
  formatFundsCompact1dp,
  formatIndex100,
  formatGDP,
  formatMarketingStrength,
  formatPopulation,
  formatSharePrice,
  formatSharePriceOrder,
  formatRealTimeCountdown,
  formatTimeRemaining,
  formatTimeRemainingSimple,
  formatTimeUntilCompact,
  getMessageStyle,
  getTimerUrgencyStyle,
  roundMarketingStrength,
  electionToLarpYear,
  resolveElectionYear,
  pastRealTimestampToLarpDate,
  turnToLarpDate,
} from "@/lib/utils/formatters";

describe("formatCurrency", () => {
  it("formats whole numbers as USD", () => {
    expect(formatCurrency(1000)).toMatch(/\$1,000/);
    expect(formatCurrency(0)).toMatch(/\$0/);
  });
});

describe("formatPartyCountryMoney", () => {
  it("uses home currency from country id or URL code", () => {
    expect(formatPartyCountryMoney(1_000_000, "UK")).toMatch(/£/);
    expect(formatPartyCountryMoney(1_000_000, "uk")).toMatch(/£/);
    expect(formatPartyCountryMoney(1_000_000, "US")).toMatch(/\$/);
    expect(formatPartyCountryMoney(1_000_000, "JP")).toMatch(/¥/);
  });

  it("resolves runtime-activated seceded countries (SCO/WAL → sterling)", () => {
    expect(formatPartyCountryMoney(250_000, "SCO")).toMatch(/£/);
    expect(formatPartyCountryMoney(250_000, "sco")).toMatch(/£/);
    expect(formatPartyCountryMoney(250_000, "WAL")).toMatch(/£/);
  });
});

describe("formatPopulation", () => {
  it("formats millions with M suffix", () => {
    expect(formatPopulation(1500000)).toBe("1.5M");
    expect(formatPopulation(1000000)).toBe("1.0M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatPopulation(500000)).toBe("500K");
    expect(formatPopulation(1000)).toBe("1K");
  });
});

describe("formatGDP", () => {
  it("formats trillions with T suffix", () => {
    expect(formatGDP(1500000)).toBe("$1.50T");
  });

  it("formats billions with B suffix", () => {
    expect(formatGDP(500000)).toBe("$500B");
  });

  it("uses custom currency symbol", () => {
    expect(formatGDP(1500000, "¥")).toBe("¥1.50T");
    expect(formatGDP(500000, "£")).toBe("£500B");
  });
});

describe("roundMarketingStrength / formatMarketingStrength", () => {
  it("rounds MS to two decimals (not integers)", () => {
    expect(roundMarketingStrength(6.8)).toBe(6.8);
    expect(roundMarketingStrength(6.846)).toBe(6.85);
  });

  it("formats with locale grouping and up to two fraction digits", () => {
    expect(formatMarketingStrength(6.8)).toBe("6.8");
    expect(formatMarketingStrength(1234.56)).toBe("1,234.56");
  });
});

describe("formatCompactNumber", () => {
  it("abbreviates K, M, B, and T", () => {
    expect(formatCompactNumber(263_000)).toBe("263K");
    expect(formatCompactNumber(1_200_000)).toBe("1.2M");
    expect(formatCompactNumber(5_000_000_000)).toBe("5B");
    expect(formatCompactNumber(1_500_000_000_000)).toBe("1.5T");
    expect(formatCompactNumber(10_000_000_000_000)).toBe("10T");
  });

  it("returns — for non-finite values", () => {
    expect(formatCompactNumber(Number.NaN)).toBe("—");
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("preserves sign", () => {
    expect(formatCompactNumber(-1_500_000)).toBe("-1.5M");
  });
});

describe("formatIndex100", () => {
  it("anchors an index value to its 0..100 scale", () => {
    expect(formatIndex100(42)).toBe("42 / 100");
    expect(formatIndex100(0)).toBe("0 / 100");
    expect(formatIndex100(38.6)).toBe("39 / 100");
  });

  it("clamps out-of-range values into 0..100", () => {
    expect(formatIndex100(120)).toBe("100 / 100");
    expect(formatIndex100(-5)).toBe("0 / 100");
  });

  it("renders the anchor with a placeholder for non-finite values", () => {
    expect(formatIndex100(Number.NaN)).toBe("— / 100");
    expect(formatIndex100(Number.POSITIVE_INFINITY)).toBe("— / 100");
  });
});

describe("formatCurrencyCompactChip", () => {
  it("formats millions with two fractional digits", () => {
    expect(formatCurrencyCompactChip(2_000_000)).toBe("$2.00M");
    expect(formatCurrencyCompactChip(2_154_321)).toBe("$2.15M");
  });

  it("matches status-bar-style thousands rules", () => {
    expect(formatCurrencyCompactChip(50_000)).toBe("$50K");
    expect(formatCurrencyCompactChip(15_000)).toBe("$15K");
    expect(formatCurrencyCompactChip(5_500)).toBe("$5.5K");
  });

  it("returns — for non-finite values", () => {
    expect(formatCurrencyCompactChip(Number.NaN)).toBe("$—");
  });

  it("preserves sign", () => {
    expect(formatCurrencyCompactChip(-1_500_000)).toBe("-$1.50M");
  });
});

describe("formatFundsCompact", () => {
  it("formats millions with M suffix", () => {
    expect(formatFundsCompact(1500000)).toBe("$1.5M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatFundsCompact(50000)).toBe("$50K");
    expect(formatFundsCompact(263000)).toBe("$263K");
  });

  it("formats small amounts without suffix", () => {
    expect(formatFundsCompact(500)).toBe("$500");
    expect(formatFundsCompact(0)).toBe("$0");
  });

  it("returns $— for non-finite values", () => {
    expect(formatFundsCompact(Number.NaN)).toBe("$—");
  });

  it("formats negative amounts", () => {
    expect(formatFundsCompact(-2500)).toBe("-$2.5K");
  });

  it("spaces alphabetic prefixes so руб566B is not read as a dollar figure (ticket-1065)", () => {
    expect(formatFundsCompact(565_992_434_499, "руб")).toBe("руб 566B");
    expect(formatFundsCompact(-5_800_000_000, "руб")).toBe("-руб 5.8B");
  });
});

describe("formatFundsCompact1dp", () => {
  it("always shows exactly one decimal at each tier", () => {
    expect(formatFundsCompact1dp(49_600_000_000_000, "¥")).toBe("¥49.6T");
    expect(formatFundsCompact1dp(126_000_000_000_000, "¥")).toBe("¥126.0T");
    expect(formatFundsCompact1dp(31_000_000_000_000, "¥")).toBe("¥31.0T");
    expect(formatFundsCompact1dp(620_000_000_000, "¥")).toBe("¥620.0B");
    expect(formatFundsCompact1dp(1_100_000_000_000, "¥")).toBe("¥1.1T");
  });

  it("keeps the decimal in the millions and thousands tiers", () => {
    expect(formatFundsCompact1dp(2_000_000)).toBe("$2.0M");
    expect(formatFundsCompact1dp(50_000)).toBe("$50.0K");
  });

  it("shows one decimal for sub-thousand and zero", () => {
    expect(formatFundsCompact1dp(500)).toBe("$500.0");
    expect(formatFundsCompact1dp(0)).toBe("$0.0");
  });

  it("returns $— for non-finite values", () => {
    expect(formatFundsCompact1dp(Number.NaN)).toBe("$—");
  });

  it("formats negative amounts with a leading minus", () => {
    expect(formatFundsCompact1dp(-31_000_000_000_000, "¥")).toBe("-¥31.0T");
  });

  it("spaces alphabetic prefixes (ticket-1065: руб566.0B looked like $566B)", () => {
    expect(formatFundsCompact1dp(565_992_434_499, "руб")).toBe("руб 566.0B");
    expect(formatFundsCompact1dp(5_800_000_000, "руб")).toBe("руб 5.8B");
  });
});

describe("formatSharePrice", () => {
  it("shows cents for prices at or above one dollar", () => {
    expect(formatSharePrice(45.67)).toMatch(/\$45\.67/);
    expect(formatSharePrice(45)).toMatch(/\$45/);
  });

  it("uses two decimals for penny stocks between 0.01 and 1", () => {
    expect(formatSharePrice(0.45)).toBe("$0.45");
  });

  it("uses four decimals for sub-penny prices", () => {
    expect(formatSharePrice(0.0042)).toBe("$0.0042");
  });
});

describe("formatSharePriceOrder", () => {
  it("uses four decimal places", () => {
    expect(formatSharePriceOrder(12.3)).toBe("$12.3000");
  });
});

describe("formatTimeRemaining", () => {
  it("returns No timer when endTimeStr is missing", () => {
    const result = formatTimeRemaining(undefined, null, new Date());
    expect(result.text).toBe("No timer");
    expect(result.urgency).toBe("normal");
  });

  it("returns Ended when deadline has passed", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const result = formatTimeRemaining(past, null, new Date());
    expect(result.text).toBe("Ended");
    expect(result.urgency).toBe("ended");
  });

  it("returns Paused when pausedAt is provided", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const paused = new Date(Date.now() - 3600000).toISOString();
    const result = formatTimeRemaining(future, paused, new Date());
    expect(result.text).toContain("Paused");
    expect(result.urgency).toBe("paused");
  });

  it("returns critical urgency for < 6 hours", () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const result = formatTimeRemaining(soon, null, new Date());
    expect(result.urgency).toBe("critical");
  });

  it("returns warning urgency for 6-24 hours", () => {
    const later = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const result = formatTimeRemaining(later, null, new Date());
    expect(result.urgency).toBe("warning");
  });
});

describe("formatTimeUntilCompact", () => {
  it("returns — when endTime is missing", () => {
    expect(formatTimeUntilCompact(undefined, null, new Date())).toBe("—");
  });

  it("returns Ended when deadline has passed", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(formatTimeUntilCompact(past, null, new Date())).toBe("Ended");
  });

  it("returns Paused when pausedAt is provided", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const paused = new Date().toISOString();
    expect(formatTimeUntilCompact(future, paused, new Date())).toBe("Paused");
  });
});

describe("formatRealTimeCountdown", () => {
  it("returns — when endTime is missing", () => {
    expect(formatRealTimeCountdown(undefined)).toBe("—");
  });

  it("returns 'Ended' when endTime is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(formatRealTimeCountdown(past)).toBe("Ended");
  });

  it("returns 'Paused' when pausedAt is set", () => {
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const paused = new Date().toISOString();
    expect(formatRealTimeCountdown(future, paused)).toBe("Paused");
  });

  it("returns compact countdown for future endTime", () => {
    // Freeze the clock: building `future` and formatting it both read
    // Date.now(), and under full-suite load the elapsed ms flips 2h 30m
    // to 2h 29m.
    vi.useFakeTimers();
    try {
      const future = new Date(Date.now() + 2 * 3_600_000 + 30 * 60_000).toISOString();
      expect(formatRealTimeCountdown(future)).toMatch(/^2h 30m$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("formatTimeRemainingSimple", () => {
  it("returns No timer when endTimeStr is missing", () => {
    expect(formatTimeRemainingSimple(undefined)).toBe("No timer");
  });

  it("returns Ended when deadline has passed", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(formatTimeRemainingSimple(past)).toBe("Ended");
  });
});

describe("turnToLarpDate", () => {
  // Default startingYear now follows STARTING_YEAR (2019, the 2019-default
  // preset). Callers pass an explicit startingYear from GameState for 1991
  // games. These tests pin the default fallback.
  it("clamps turn 0 or invalid to the first week of the era", () => {
    expect(turnToLarpDate(0)).toBe("January, Week 1, 2019");
    expect(turnToLarpDate(-1)).toBe("January, Week 1, 2019");
  });

  it("renders the month and the week within that month", () => {
    // 48 turns per year = 12 months of exactly 4 weeks.
    expect(turnToLarpDate(1)).toBe("January, Week 1, 2019");
    expect(turnToLarpDate(4)).toBe("January, Week 4, 2019");
    expect(turnToLarpDate(5)).toBe("February, Week 1, 2019");
    expect(turnToLarpDate(12)).toBe("March, Week 4, 2019");
    expect(turnToLarpDate(15)).toBe("April, Week 3, 2019");
  });

  it("ends the year in December rather than a 52-week counter", () => {
    expect(turnToLarpDate(45)).toBe("December, Week 1, 2019");
    expect(turnToLarpDate(48)).toBe("December, Week 4, 2019");
  });

  it("rolls into the next year on turn 49", () => {
    expect(turnToLarpDate(49)).toBe("January, Week 1, 2020");
  });

  it("honors an explicit 1991 startingYear", () => {
    expect(turnToLarpDate(1, 1991)).toBe("January, Week 1, 1991");
    expect(turnToLarpDate(48, 1991)).toBe("December, Week 4, 1991");
    expect(turnToLarpDate(49, 1991)).toBe("January, Week 1, 1992");
  });

  it("never leaves a gap or overlap across a whole year", () => {
    const seen = new Set<string>();
    for (let t = 1; t <= 48; t++) seen.add(turnToLarpDate(t, 1953));
    expect(seen.size).toBe(48);
  });
});

describe("turnToLarpDate during the founding phase", () => {
  it("pins every founding turn to the era start via calendarTurn", () => {
    // preIterationTurns stays 0 while the founding phase runs — by design — so
    // the active flag is what freezes the calendar. Without it the date walked
    // forward through turns the founding phase is meant to hold still.
    const clock = { preIterationActive: true, preIterationTurns: 0 };
    for (const raw of [1, 8, 15, 40]) {
      expect(turnToLarpDate(calendarTurn(raw, clock), 1953)).toBe("January, Week 1, 1953");
    }
  });

  it("resumes at the era start once founding ends", () => {
    // 14 founding turns consumed: raw turn 15 is the real game's turn 1.
    const clock = { preIterationActive: false, preIterationTurns: 14 };
    expect(turnToLarpDate(calendarTurn(15, clock), 1953)).toBe("January, Week 1, 1953");
    expect(turnToLarpDate(calendarTurn(19, clock), 1953)).toBe("February, Week 1, 1953");
  });

  it("is the identity on a normal world", () => {
    expect(turnToLarpDate(calendarTurn(15, {}), 1953)).toBe(turnToLarpDate(15, 1953));
  });
});

describe("pastRealTimestampToLarpDate", () => {
  const lastTurnProcessed = new Date("2026-06-12T12:00:00Z");

  it("maps a past timestamp back by elapsed hourly turns", () => {
    // 10 hours before the last processed turn = 10 turns ago.
    const tenHoursAgo = new Date("2026-06-12T02:00:00Z");
    expect(pastRealTimestampToLarpDate(tenHoursAgo, 100, lastTurnProcessed, 1991)).toBe(
      turnToLarpDate(90, 1991)
    );
  });

  it("clamps a timestamp at-or-after the reference to the current turn", () => {
    expect(
      pastRealTimestampToLarpDate(new Date("2026-06-12T13:00:00Z"), 100, lastTurnProcessed, 1991)
    ).toBe(turnToLarpDate(100, 1991));
  });

  it("never maps before turn 1", () => {
    const longAgo = new Date("2020-01-01T00:00:00Z");
    expect(pastRealTimestampToLarpDate(longAgo, 5, lastTurnProcessed, 1991)).toBe(
      turnToLarpDate(1, 1991)
    );
  });

  it("returns an empty string when inputs are missing", () => {
    expect(pastRealTimestampToLarpDate(null, 100, lastTurnProcessed)).toBe("");
    expect(pastRealTimestampToLarpDate(new Date(), null, lastTurnProcessed)).toBe("");
    expect(pastRealTimestampToLarpDate(new Date(), 100, null)).toBe("");
  });
});

describe("electionToLarpYear — preset awareness", () => {
  const ctx1991 = { startingYear: 1991, preset: "1991-default" };

  it("2019-default: US House cycle 1 → 2022", () => {
    expect(electionToLarpYear("house", 1)).toBe(2022);
  });

  it("1991-default: US House cycle 1 → 1992", () => {
    expect(electionToLarpYear("house", 1, null, null, ctx1991)).toBe(1992);
  });

  it("1991-default: UK Commons cycle 1 → 1992 (Major's win)", () => {
    expect(electionToLarpYear("commons", 1, null, null, ctx1991)).toBe(1992);
  });

  it("1991-default: JP Sangiin Class 1 → 1992, Class 2 → 1995", () => {
    expect(electionToLarpYear("sangiin", 1, null, 1, ctx1991)).toBe(1992);
    expect(electionToLarpYear("sangiin", 1, null, 2, ctx1991)).toBe(1995);
  });

  it("1991-default: US Senate by class (1 → 1994, 2 → 1996, 3 → 1992)", () => {
    expect(electionToLarpYear("senate", 1, 1, null, ctx1991)).toBe(1994);
    expect(electionToLarpYear("senate", 1, 2, null, ctx1991)).toBe(1996);
    expect(electionToLarpYear("senate", 1, 3, null, ctx1991)).toBe(1992);
  });

  it("1991-default: DE Bundestag cycle 1 → 1994", () => {
    expect(electionToLarpYear("bundestag", 1, null, null, ctx1991)).toBe(1994);
  });

  it("SCO Holyrood / WAL Senedd map to the devolved year (2021, then +5/cycle), not the default", () => {
    expect(electionToLarpYear("holyrood", 1)).toBe(2021);
    expect(electionToLarpYear("senedd", 1)).toBe(2021);
    expect(electionToLarpYear("holyrood", 2)).toBe(2026);
    expect(electionToLarpYear("holyrood", 1, null, null, ctx1991)).toBe(1999);
  });

  it("2019-default: IE Dáil cycle 1 → 2024 (anchored on ieDail year)", () => {
    expect(electionToLarpYear("dail", 1)).toBe(2024);
  });

  it("1991-default: IE Dáil cycle 1 → 1992 (Reynolds-Spring coalition)", () => {
    expect(electionToLarpYear("dail", 1, null, null, ctx1991)).toBe(1992);
  });

  it("2019-default: IE Uachtarán cycle 1 → 2025 (7-year cycle, Higgins term ends)", () => {
    expect(electionToLarpYear("uachtaran", 1)).toBe(2025);
  });

  it("2019-default: IE Uachtarán cycle 2 → 2032 (7-year cycle)", () => {
    expect(electionToLarpYear("uachtaran", 2)).toBe(2032);
  });

  it("1991-default: IE Uachtarán cycle 1 → 1997 (Robinson term ends)", () => {
    expect(electionToLarpYear("uachtaran", 1, null, null, ctx1991)).toBe(1997);
  });

  it("2019-default: IE Local Council cycle 1 → 2024 (EP-aligned 5-year cycle)", () => {
    expect(electionToLarpYear("localCouncil", 1)).toBe(2024);
  });

  it("2019-default: IE Local Council cycle 2 → 2029", () => {
    expect(electionToLarpYear("localCouncil", 2)).toBe(2029);
  });

  it("1991-default: IE Local Council cycle 1 → 1991", () => {
    expect(electionToLarpYear("localCouncil", 1, null, null, ctx1991)).toBe(1991);
  });
});

describe("resolveElectionYear", () => {
  const ctx1991 = { startingYear: 1991, preset: "1991-default" };

  it("returns the doc's baked electionYear when present (preset-agnostic)", () => {
    // Baked value wins even when caller passes a mismatched ctx — once
    // backfilled, display sites no longer need to thread the active preset.
    expect(
      resolveElectionYear({
        electionType: "npcDelegate",
        cycle: 1,
        electionYear: 1993,
      })
    ).toBe(1993);
    expect(
      resolveElectionYear({ electionType: "house", cycle: 1, electionYear: 2022 }, ctx1991)
    ).toBe(2022);
  });

  it("falls back to electionToLarpYear under the supplied ctx for legacy rows", () => {
    expect(resolveElectionYear({ electionType: "npcDelegate", cycle: 1 }, ctx1991)).toBe(1993);
    expect(resolveElectionYear({ electionType: "npcDelegate", cycle: 1 })).toBe(2023);
  });

  it("treats null/undefined electionYear as missing (still falls back)", () => {
    expect(
      resolveElectionYear({ electionType: "house", cycle: 1, electionYear: null }, ctx1991)
    ).toBe(1992);
  });
});

describe("getMessageStyle", () => {
  it("returns green style for success messages (starts with ✓)", () => {
    expect(getMessageStyle("✓ Success")).toContain("green");
  });

  it("returns red style for error messages", () => {
    expect(getMessageStyle("Error occurred")).toContain("red");
  });
});

describe("getTimerUrgencyStyle", () => {
  it("returns correct Tailwind class for each urgency", () => {
    expect(getTimerUrgencyStyle("paused")).toContain("purple");
    expect(getTimerUrgencyStyle("critical")).toContain("red");
    expect(getTimerUrgencyStyle("warning")).toContain("yellow");
    expect(getTimerUrgencyStyle("ended")).toContain("gray");
    expect(getTimerUrgencyStyle("normal")).toContain("green");
  });
});

describe("electionToLarpYear — NG concurrent general", () => {
  const ctx = { startingYear: 1991, preset: "1991-default" };
  it("NG president/house/senate/governor cycle 1 → 1993, cycle 2 → 1997", () => {
    for (const t of ["president", "house", "senate", "governor"]) {
      expect(electionToLarpYear(t, 1, undefined, undefined, ctx, "NG")).toBe(1993);
      expect(electionToLarpYear(t, 2, undefined, undefined, ctx, "NG")).toBe(1997);
    }
  });
  it("US president (no countryId) is unchanged (1992 cycle 1)", () => {
    expect(electionToLarpYear("president", 1, undefined, undefined, ctx)).toBe(1992);
  });
});

describe("electionToLarpYear — RU delegate families", () => {
  const ctx1953 = { startingYear: 1953, preset: "1953-default" };

  it("both national chambers label 1954, 1958, 1962 under 1953-default", () => {
    for (const t of ["supremeSovietDeputy", "nationalitiesDeputy"]) {
      expect(electionToLarpYear(t, 1, null, null, ctx1953)).toBe(1954);
      expect(electionToLarpYear(t, 2, null, null, ctx1953)).toBe(1958);
      expect(electionToLarpYear(t, 3, null, null, ctx1953)).toBe(1962);
    }
  });

  it("republic soviets label 1955 and RU governors follow them (D10)", () => {
    expect(electionToLarpYear("republicSupremeSoviet", 1, null, null, ctx1953)).toBe(1955);
    expect(electionToLarpYear("governor", 1, null, null, ctx1953, "RU")).toBe(1955);
    // Other countries' governors keep the shared anchor (1954 under 1953-default).
    expect(electionToLarpYear("governor", 1, null, null, ctx1953)).toBe(1954);
  });
});
