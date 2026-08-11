import { describe, it, expect } from "vitest";
import {
  electionNightStyle,
  electionNightTitle,
  isElectionNightType,
  majorityThreshold,
  pickElectionNightAnchor,
} from "./electionNight";

describe("electionNight helpers", () => {
  it("flags national multi-seat types for election night", () => {
    expect(isElectionNightType("commons")).toBe(true);
    expect(isElectionNightType("house")).toBe(true);
    expect(isElectionNightType("bundestag")).toBe(true);
    expect(isElectionNightType("governor")).toBe(false);
    expect(isElectionNightType("president")).toBe(false);
  });

  it("picks an active commons race over a completed house race", () => {
    const anchor = pickElectionNightAnchor([
      { id: "h1", electionType: "house", status: "completed" },
      { id: "c1", electionType: "commons", status: "active" },
      { id: "g1", electionType: "governor", status: "active" },
    ]);
    expect(anchor?.id).toBe("c1");
  });

  it("falls back to completed national races", () => {
    const anchor = pickElectionNightAnchor([
      { id: "c1", electionType: "commons", status: "completed" },
      { id: "g1", electionType: "governor", status: "active" },
    ]);
    expect(anchor?.id).toBe("c1");
  });

  it("titles and styles chambers correctly", () => {
    expect(electionNightTitle("commons")).toBe("Election Night · House of Commons");
    expect(electionNightTitle("house")).toBe("Election Night · House of Representatives");
    expect(electionNightStyle("commons")).toBe("westminster");
    expect(electionNightStyle("house")).toBe("generic");
    expect(majorityThreshold(650)).toBe(326);
  });
});
