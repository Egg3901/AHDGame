import { describe, expect, it } from "vitest";
import { generateStatePartyOrg, marginsForPreset } from "./statePartyOrg";
import { ELECTION_1988_MARGIN } from "@/lib/data/1988ElectionResults";
import { ELECTION_2020_MARGIN } from "@/lib/data/2020ElectionResults";

describe("marginsForPreset", () => {
  it("1991-default → 1988 margins", () => {
    expect(marginsForPreset("1991-default")).toBe(ELECTION_1988_MARGIN);
  });

  it("2019-default → 2020 margins", () => {
    expect(marginsForPreset("2019-default")).toBe(ELECTION_2020_MARGIN);
  });

  it("unknown preset → fallback to 2020 margins", () => {
    expect(marginsForPreset("nonexistent")).toBe(ELECTION_2020_MARGIN);
  });
});

describe("generateStatePartyOrg", () => {
  it("produces an entry per (state × major party) pair", () => {
    const entries = generateStatePartyOrg();
    const states = new Set(entries.map((e) => e.stateId));
    const parties = new Set(entries.map((e) => e.partyId));
    expect(entries.length).toBe(states.size * parties.size);
    expect(parties).toEqual(new Set(["1", "2"])); // Dem + Rep
  });

  it("1991 preset differs from 2019 preset on at least one state's Org", () => {
    const e1991 = generateStatePartyOrg("1991-default");
    const e2019 = generateStatePartyOrg("2019-default");
    // Compare Massachusetts DEM Org: Dukakis carried it modestly (+7.9) in 1988
    // vs. Biden landslide (+33.5) in 2020. Higher 2020 lean ⇒ larger Org bonus.
    const ma1991Dem = e1991.find((e) => e.stateId === "MA" && e.partyId === "1")!;
    const ma2019Dem = e2019.find((e) => e.stateId === "MA" && e.partyId === "1")!;
    expect(ma2019Dem.organization).toBeGreaterThan(ma1991Dem.organization);
  });

  it("Org no longer has a per-party ceiling — Strong-R-state DEM Org reflects lean directly", () => {
    // The OLD cap system penalized DEM in red states (cap dropping to MIN_CAP=50).
    // The NEW pool model has no per-party ceiling: DEM in WV simply gets no
    // lean-bonus (baseline 25). The state-wide Org pool sum is the only ceiling.
    const wv2019Dem = generateStatePartyOrg("2019-default").find(
      (e) => e.stateId === "WV" && e.partyId === "1"
    )!;
    expect(wv2019Dem.organization).toBe(25); // baseline only, no Dem-friendly bonus
  });

  it("backward-compat default param is 2019-default", () => {
    const noArg = generateStatePartyOrg();
    const explicit = generateStatePartyOrg("2019-default");
    expect(noArg).toEqual(explicit);
  });

  it("excludes DC — a federal district with no electoral state party organization", () => {
    for (const preset of ["2019-default", "1991-default", "1953-default"]) {
      const entries = generateStatePartyOrg(preset);
      expect(entries.some((e) => e.stateId === "DC")).toBe(false);
    }
  });

  it("includes territorial party chapters under 1953-default without granting statehood", () => {
    const entries = generateStatePartyOrg("1953-default");
    expect(entries.some((e) => e.stateId === "AK" && e.partyId === "1")).toBe(true);
    expect(entries.some((e) => e.stateId === "HI" && e.partyId === "2")).toBe(true);
    expect(new Set(entries.map((e) => e.stateId)).size).toBe(50);
  });

  it("includes Alaska and Hawaii under modern presets", () => {
    const entries = generateStatePartyOrg("2019-default");
    expect(entries.some((e) => e.stateId === "AK" && e.partyId === "1")).toBe(true);
    expect(entries.some((e) => e.stateId === "HI" && e.partyId === "2")).toBe(true);
  });

  it("covers all 50 electoral states under the default (2019) preset", () => {
    const states = new Set(generateStatePartyOrg().map((e) => e.stateId));
    expect(states.size).toBe(50);
  });
});
