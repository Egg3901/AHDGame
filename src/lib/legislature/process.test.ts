import { describe, it, expect } from "vitest";
import { getLegislativeProcess, LEGISLATIVE_PROCESS } from "./process";

describe("legislative process registry", () => {
  it("covers every supported legislature", () => {
    for (const id of ["US", "UK", "DE", "JP", "IE", "CN"] as const) {
      expect(LEGISLATIVE_PROCESS[id]).toBeDefined();
    }
  });

  it("US has a vetoing executive with a two-thirds override", () => {
    const p = getLegislativeProcess("US");
    expect(p.executive.canVeto).toBe(true);
    expect(p.executive.override?.threshold).toBe("two-thirds");
  });

  it("parliamentary systems do not allow a veto", () => {
    for (const id of ["UK", "DE", "JP", "IE"] as const) {
      expect(getLegislativeProcess(id).executive.canVeto).toBe(false);
    }
  });

  it("UK and IE and JP expose a dissolution risk; CN does not", () => {
    expect(getLegislativeProcess("UK").dissolution).not.toBeNull();
    expect(getLegislativeProcess("IE").dissolution).not.toBeNull();
    expect(getLegislativeProcess("JP").dissolution).not.toBeNull();
    expect(getLegislativeProcess("CN").dissolution).toBeNull();
  });

  it("returns a safe default for an unsupported country", () => {
    const p = getLegislativeProcess("FR" as never);
    expect(p).toBeDefined();
    expect(p.quirks).toBeInstanceOf(Array);
  });

  it("carries a seatingStyle per country", () => {
    expect(getLegislativeProcess("UK").seatingStyle).toBe("benches");
    expect(getLegislativeProcess("IE").seatingStyle).toBe("horseshoe");
    expect(getLegislativeProcess("US").seatingStyle).toBe("hemicycle");
  });

  it("SE 1953 exposes First Chamber revise/delay flavour; other SE eras stay default", () => {
    const se1953 = getLegislativeProcess("SE", "1953-default");
    expect(se1953.upperNote).toMatch(/First Chamber/);
    expect(se1953.dissolution).not.toBeNull();
    expect(se1953.executive.canVeto).toBe(false);

    // 1979+ unicameral — no SE entry in LEGISLATIVE_PROCESS, falls to default.
    expect(getLegislativeProcess("SE").upperNote).toBeNull();
    expect(getLegislativeProcess("SE", "1979-default").upperNote).toBeNull();
  });
});
