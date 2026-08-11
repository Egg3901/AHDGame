import { describe, it, expect } from "vitest";
import {
  ALL_EXCHANGES,
  EXCHANGE_API_KEYS,
  getExchangeForCountry,
  getExchangeApiKey,
  getCountryForExchange,
  getExchangeLabel,
  isStateRegister,
} from "./exchangeRegistry";

describe("exchangeRegistry", () => {
  it("registers one exchange per country with an exchangeName, plus global api key", () => {
    expect(ALL_EXCHANGES.length).toBeGreaterThan(0);
    expect(EXCHANGE_API_KEYS.has("global")).toBe(true);
    for (const ex of ALL_EXCHANGES) {
      expect(EXCHANGE_API_KEYS.has(ex.apiKey)).toBe(true);
      expect(getCountryForExchange(ex.apiKey)).toBe(ex.countryId);
    }
  });

  it("registers the NGX exchange for Nigeria", () => {
    expect(getExchangeForCountry("NG")).toBe("NGX");
    expect(getExchangeApiKey("NG")).toBe("ngx");
    expect(getCountryForExchange("ngx")).toBe("NG");
    expect(getExchangeLabel("NG")).toBe("NGX");
    expect(EXCHANGE_API_KEYS.has("ngx")).toBe(true);
  });

  it("keeps the established exchanges registered", () => {
    expect(getExchangeForCountry("US")).toBe("NYSE");
    expect(getExchangeForCountry("UK")).toBe("FTSE");
    expect(getExchangeForCountry("JP")).toBe("Nikkei");
    expect(getExchangeForCountry("DE")).toBe("DAX");
    expect(getExchangeForCountry("IE")).toBe("ISEQ");
    expect(getExchangeForCountry("BR")).toBe("B3");
    expect(getExchangeForCountry("CN")).toBe("SSE");
  });

  it("resolves countries that are configured but absent from COUNTRY_ORDER", () => {
    // SCO and WAL carry exchangeName: "FTSE" in COUNTRY_CONFIGS but are not in
    // COUNTRY_ORDER, so the old COUNTRY_ORDER-derived map returned undefined and
    // callers fell back to NYSE.
    expect(getExchangeForCountry("SCO")).toBe("FTSE");
    expect(getExchangeForCountry("WAL")).toBe("FTSE");
  });

  it("registers one venue per apiKey even when countries share an exchange", () => {
    const ftse = ALL_EXCHANGES.filter((ex) => ex.apiKey === "ftse");
    expect(ftse).toHaveLength(1);
    expect(ftse[0].countryId).toBe("UK");

    const keys = ALL_EXCHANGES.map((ex) => ex.apiKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never produces an apiKey containing whitespace", () => {
    for (const ex of ALL_EXCHANGES) {
      expect(ex.apiKey).not.toMatch(/\s/);
    }
  });

  it("keeps live exchange api keys byte-identical", () => {
    // These are live stockExchangeSnapshots._id values — changing any of them
    // orphans the corresponding document.
    expect(getExchangeApiKey("US")).toBe("nyse");
    expect(getExchangeApiKey("UK")).toBe("ftse");
    expect(getExchangeApiKey("JP")).toBe("nikkei");
    expect(getExchangeApiKey("DE")).toBe("dax");
    expect(getExchangeApiKey("IE")).toBe("iseq");
    expect(getExchangeApiKey("BR")).toBe("b3");
    expect(getExchangeApiKey("CN")).toBe("sse");
    expect(getExchangeApiKey("NG")).toBe("ngx");
  });

  it("classifies market exchanges as such", () => {
    expect(isStateRegister("US")).toBe(false);
    expect(isStateRegister("nyse")).toBe(false);
  });

  it("gives every command economy its own state register", () => {
    const registers: Array<[string, string, string]> = [
      ["RU", "GOSPLAN", "gosplan"],
      ["BLR", "GOSPLAN BSSR", "gosplan-bssr"],
      ["BAL", "GOSPLAN SSR", "gosplan-ssr"],
      ["DD", "VVB", "vvb"],
      ["PL", "PKPG", "pkpg"],
      ["CS", "SPK", "spk"],
      ["HU", "OT", "ot"],
      ["RO", "CSP", "csp"],
      ["BG", "DKP", "dkp"],
      ["YU", "SZP", "szp"],
    ];

    for (const [countryId, name, apiKey] of registers) {
      expect(getExchangeForCountry(countryId)).toBe(name);
      expect(getExchangeApiKey(countryId)).toBe(apiKey);
      expect(isStateRegister(countryId)).toBe(true);
      expect(isStateRegister(apiKey)).toBe(true);
      expect(EXCHANGE_API_KEYS.has(apiKey)).toBe(true);
    }
  });

  it("leaves coming-soon market economies without a venue", () => {
    // FR/IT/ES/SE/TR/GR/AT/FI get real bourses when those countries are built.
    // Until then they must resolve to undefined, NOT to a fallback exchange.
    for (const id of ["FR", "IT", "ES", "SE", "TR", "GR", "AT", "FI"]) {
      expect(getExchangeForCountry(id)).toBeUndefined();
    }
  });
});
