import { describe, it, expect } from "vitest";
import {
  getImperialTitle,
  getImperialConfig,
  getImperialEligibleCountries,
  getImperialPossessive,
} from "./imperial";

describe("getImperialTitle", () => {
  it("returns King for UK male", () => {
    expect(getImperialTitle("UK", "male")).toBe("King");
  });

  it("returns Queen for UK female", () => {
    expect(getImperialTitle("UK", "female")).toBe("Queen");
  });

  it("returns Monarch for UK nonbinary", () => {
    expect(getImperialTitle("UK", "nonbinary")).toBe("Monarch");
  });

  it("returns Emperor for JP male", () => {
    expect(getImperialTitle("JP", "male")).toBe("Emperor");
  });

  it("returns Empress for JP female", () => {
    expect(getImperialTitle("JP", "female")).toBe("Empress");
  });

  it("returns Emperor for JP nonbinary", () => {
    expect(getImperialTitle("JP", "nonbinary")).toBe("Emperor");
  });

  it("returns Bundespräsident for DE male", () => {
    expect(getImperialTitle("DE", "male")).toBe("Bundespräsident");
  });

  it("returns Bundespräsidentin for DE female", () => {
    expect(getImperialTitle("DE", "female")).toBe("Bundespräsidentin");
  });

  it("returns Bundespräsident for DE nonbinary", () => {
    expect(getImperialTitle("DE", "nonbinary")).toBe("Bundespräsident");
  });

  it("returns null for US (no imperial role)", () => {
    expect(getImperialTitle("US", "male")).toBeNull();
  });
});

describe("getImperialConfig", () => {
  it("returns config for UK", () => {
    const config = getImperialConfig("UK");
    expect(config).not.toBeNull();
    expect(config!.corporation.name).toBe("Royal Estate");
    expect(config!.corporation.sector).toBe("real_estate");
  });

  it("returns config for JP", () => {
    const config = getImperialConfig("JP");
    expect(config).not.toBeNull();
    expect(config!.corporation.name).toBe("Chrysanthemum Properties");
    expect(config!.corporation.sector).toBe("real_estate");
  });

  it("returns null for DE (no imperial role)", () => {
    expect(getImperialConfig("DE")).toBeNull();
  });

  it("returns null for US", () => {
    expect(getImperialConfig("US")).toBeNull();
  });
});

describe("getImperialEligibleCountries", () => {
  it("returns UK and JP", () => {
    const eligible = getImperialEligibleCountries();
    expect(eligible).toContain("UK");
    expect(eligible).toContain("JP");
    expect(eligible).not.toContain("DE");
  });

  it("does not include US or CA", () => {
    const eligible = getImperialEligibleCountries();
    expect(eligible).not.toContain("US");
    expect(eligible).not.toContain("CA");
  });
});

describe("getImperialPossessive", () => {
  it("returns His Majesty's for UK male", () => {
    expect(getImperialPossessive("UK", "male")).toBe("His Majesty's");
  });

  it("returns Her Majesty's for UK female", () => {
    expect(getImperialPossessive("UK", "female")).toBe("Her Majesty's");
  });

  it("returns The Monarch's for UK nonbinary", () => {
    expect(getImperialPossessive("UK", "nonbinary")).toBe("The Monarch's");
  });

  it("returns null for DE (imperialPossessives intentionally omitted)", () => {
    expect(getImperialPossessive("DE", "female")).toBeNull();
  });

  it("returns null for US (no possessives)", () => {
    expect(getImperialPossessive("US", "male")).toBeNull();
  });

  it("returns null for JP (no possessives configured)", () => {
    expect(getImperialPossessive("JP", "male")).toBeNull();
  });
});
