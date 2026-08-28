import { describe, it, expect } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { belligerentsOf, guestsToRelease, planApprovalSnapshot } from "./approvalSnapshotTargets";

const ACTIVE = ["US", "UK", "JP", "DE", "IE", "CN"] as CountryId[];

const conflict = (over: Partial<ConflictDoc> = {}): ConflictDoc =>
  ({
    _id: "war_us_dd_415",
    hostCountry: "DE",
    sideA: { countries: ["US"] },
    sideB: { countries: ["DD", "RU"] },
    status: "active",
    ...over,
  }) as unknown as ConflictDoc;

describe("belligerentsOf", () => {
  it("collects both rosters", () => {
    expect(belligerentsOf([conflict()]).sort()).toEqual(["DD", "RU", "US"]);
  });

  /**
   * `listConflictsForCountry` matches on `hostCountry` as well, but a host that
   * is on neither roster is not a belligerent: `rosterSideOf` returns null for
   * it, so its war block is permanently zero. Including it here would mint an
   * approval document every turn and release it again the next, forever.
   */
  it("leaves out a host that is on neither roster", () => {
    expect(belligerentsOf([conflict()])).not.toContain("DE");
  });

  it("counts a host that is also fighting", () => {
    const c = conflict({ hostCountry: "DD" } as Partial<ConflictDoc>);
    expect(belligerentsOf([c])).toContain("DD");
  });

  it("does not repeat a country fighting two wars", () => {
    const second = conflict({ _id: "war_ru_uk_500" } as Partial<ConflictDoc>);
    expect(belligerentsOf([conflict(), second]).filter((id) => id === "RU")).toHaveLength(1);
  });

  it("survives a conflict with a half written roster", () => {
    const broken = { _id: "x", status: "active" } as unknown as ConflictDoc;
    expect(() => belligerentsOf([broken])).not.toThrow();
    expect(belligerentsOf([broken])).toEqual([]);
  });

  it("finds nobody when no war is running", () => {
    expect(belligerentsOf([])).toEqual([]);
  });
});

describe("planApprovalSnapshot", () => {
  it("always snapshots every active country", () => {
    const plan = planApprovalSnapshot(ACTIVE, [], []);
    expect(plan.ids).toEqual(ACTIVE);
    expect(plan.guests).toEqual([]);
  });

  it("pulls in a belligerent that is not otherwise snapshotted", () => {
    const plan = planApprovalSnapshot(ACTIVE, ["US", "DD", "RU"] as CountryId[], []);
    expect(plan.ids).toContain("DD");
    expect(plan.ids).toContain("RU");
  });

  it("never lists an active belligerent as a guest", () => {
    const plan = planApprovalSnapshot(ACTIVE, ["US", "DD"] as CountryId[], []);
    expect(plan.guests).toEqual(["DD"]);
  });

  /**
   * Exhaustion only moves on a turn the snapshot runs for that country, so a
   * country dropped from the set the moment its war resolved would carry its
   * wartime penalty frozen for good.
   */
  it("keeps a country that already has a document", () => {
    const plan = planApprovalSnapshot(ACTIVE, [], ["RU"] as CountryId[]);
    expect(plan.ids).toContain("RU");
    expect(plan.guests).toEqual(["RU"]);
  });

  it("lists a country once when it is both fighting and documented", () => {
    const plan = planApprovalSnapshot(ACTIVE, ["DD"] as CountryId[], ["DD"] as CountryId[]);
    expect(plan.ids.filter((id) => id === "DD")).toHaveLength(1);
    expect(plan.guests).toEqual(["DD"]);
  });

  /**
   * The regression that made "documented" the key rather than "has exhaustion
   * left to heal". A guest whose war ended on a turn its exhaustion read exactly
   * zero used to fall out of the set entirely, and the only code path that
   * deletes a guest's document runs for countries IN the set — so the document
   * stayed on disk with nothing left that could ever remove it, pinning that
   * country's page to its last wartime rating for the rest of the game.
   */
  it("keeps a fully healed guest in the set so it can still be released", () => {
    const plan = planApprovalSnapshot(ACTIVE, [], ["RU"] as CountryId[]);
    expect(plan.guests).toContain("RU");
    expect(guestsToRelease(plan.guests, [], new Map([["RU" as CountryId, 0]]))).toEqual(["RU"]);
  });

  it("puts the active countries first so the order is stable turn to turn", () => {
    const plan = planApprovalSnapshot(ACTIVE, ["RU", "DD"] as CountryId[], []);
    expect(plan.ids.slice(0, ACTIVE.length)).toEqual(ACTIVE);
  });
});

describe("guestsToRelease", () => {
  const totals = (entries: Array<[string, number]>) =>
    new Map(entries as Array<[CountryId, number]>);

  /**
   * A guest only ever had an approval document because of a war. Leaving it
   * behind is the trap this whole path exists to avoid: `loadNationalApproval`
   * prefers a stored rating over its live recompute, so a stale document would
   * pin the country's page to its last wartime number for good.
   */
  it("releases a guest that has stopped fighting and fully retired", () => {
    expect(guestsToRelease(["RU"] as CountryId[], [], totals([["RU", 0]]))).toEqual(["RU"]);
  });

  it("keeps a guest that is still fighting", () => {
    expect(
      guestsToRelease(["RU"] as CountryId[], ["RU"] as CountryId[], totals([["RU", 0]]))
    ).toEqual([]);
  });

  it("keeps a guest whose block has not finished retiring", () => {
    expect(guestsToRelease(["RU"] as CountryId[], [], totals([["RU", -1.4]]))).toEqual([]);
  });

  it("treats a missing total as retired", () => {
    expect(guestsToRelease(["RU"] as CountryId[], [], totals([]))).toEqual(["RU"]);
  });

  it("releases nobody when there are no guests", () => {
    expect(guestsToRelease([], [], totals([["RU", 0]]))).toEqual([]);
  });
});
