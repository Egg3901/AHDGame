import { describe, expect, it } from "vitest";
import { resolveElectionDisplayParty } from "./resolveElectionParty";

describe("resolveElectionDisplayParty", () => {
  it("prefers tally snapshot over ballot and live party for historical races", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: true,
        snapshotParty: "1",
        ballotParty: "2",
        liveParty: "3",
      })
    ).toBe("1");
  });

  it("falls back to ballot party when snapshot is missing on historical races", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: true,
        snapshotParty: undefined,
        ballotParty: "1",
        liveParty: "3",
      })
    ).toBe("1");
  });

  it("does not use live party when historical and ballot/snapshot exist", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: true,
        snapshotParty: "",
        ballotParty: "1",
        liveParty: "3",
      })
    ).toBe("1");
  });

  it("falls back to live party only when historical race has no snapshot or ballot party", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: true,
        liveParty: "3",
      })
    ).toBe("3");
  });

  it("falls back to independent when no party sources exist", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: true,
      })
    ).toBe("independent");
  });

  it("prefers live party for in-progress races", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: false,
        snapshotParty: "1",
        ballotParty: "2",
        liveParty: "3",
      })
    ).toBe("3");
  });

  it("falls back through snapshot then ballot when in-progress live party is missing", () => {
    expect(
      resolveElectionDisplayParty({
        preferElectionTimeParty: false,
        snapshotParty: "1",
        ballotParty: "2",
      })
    ).toBe("1");
  });
});
