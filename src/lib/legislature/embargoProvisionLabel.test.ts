import { describe, it, expect } from "vitest";
import { formatEmbargoProvisionLabel, withCountryArticle } from "./embargoProvisionLabel";

describe("withCountryArticle", () => {
  it("prefixes 'the' for names that take an article", () => {
    expect(withCountryArticle("United Kingdom")).toBe("the United Kingdom");
    expect(withCountryArticle("United States")).toBe("the United States");
    expect(withCountryArticle("Netherlands")).toBe("the Netherlands");
  });

  it("leaves plain country names alone", () => {
    expect(withCountryArticle("Germany")).toBe("Germany");
    expect(withCountryArticle("Japan")).toBe("Japan");
    expect(withCountryArticle("China")).toBe("China");
  });
});

describe("formatEmbargoProvisionLabel", () => {
  it("describes a block-all-both embargo", () => {
    const label = formatEmbargoProvisionLabel({
      type: "embargo",
      targetCountry: "UK",
      commodity: "all",
      direction: "both",
      mode: "block",
    });
    expect(label.kind).toBe("Trade Embargo");
    expect(label.summary).toBe("Block all goods traded with the United Kingdom");
    expect(label.description).toMatch(/cuts off all goods traded with the United Kingdom/i);
  });

  it("describes a capped, directional, single-commodity embargo with a thousands separator", () => {
    const label = formatEmbargoProvisionLabel({
      type: "embargo",
      targetCountry: "DE",
      commodity: "steel",
      direction: "import",
      mode: "cap",
      cap: 5000,
    });
    expect(label.summary).toBe("Cap Steel & Metals imported from Germany at 5,000 units");
    expect(label.description).toMatch(/5,000 units per turn/);
  });

  it("describes an export-direction block", () => {
    const label = formatEmbargoProvisionLabel({
      type: "embargo",
      targetCountry: "CN",
      commodity: "vehicles",
      direction: "export",
      mode: "block",
    });
    expect(label.summary).toBe("Block Vehicles & Machinery exported to China");
  });

  it("describes a repeal", () => {
    const label = formatEmbargoProvisionLabel({
      type: "end_embargo",
      targetCountry: "UK",
      commodity: "oil",
      direction: "both",
    });
    expect(label.kind).toBe("Embargo Repeal");
    expect(label.summary).toBe("Lift embargo on Crude Oil traded with the United Kingdom");
    expect(label.description).toMatch(/repeals the matching legislated embargo/i);
  });
});
