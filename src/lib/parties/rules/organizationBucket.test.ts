import { describe, expect, it } from "vitest";
import {
  applyOrganizationBuild,
  applyOrganizationDecay,
  deriveOrganizationShares,
} from "./organizationBucket";
import { ORG_DECAY_GRACE_TURNS } from "@/lib/constants/partyOrg";

describe("organization bucket rules", () => {
  it("bootstraps legacy Org percentages as contribution units", () => {
    const result = deriveOrganizationShares([
      { id: "a", organization: 60 },
      { id: "b", organization: 30 },
    ]);

    expect(result.totalUnits).toBe(900);
    expect(result.unaffiliatedUnits).toBe(100);
    expect(result.rows.map((row) => row.organization)).toEqual([60, 30]);
  });

  it("preserves a legacy share when durable units already exist in the region", () => {
    const result = deriveOrganizationShares([
      { id: "unitized", organization: 50, organizationUnits: 100 },
      { id: "legacy", organization: 20 },
    ]);

    expect(result.rows.find((row) => row.id === "legacy")).toMatchObject({
      organization: 20,
      organizationUnits: 50,
    });
  });

  it("adds exactly one unit per build and derives share from the accumulated bucket", () => {
    const result = applyOrganizationBuild(
      [
        { id: "established", organization: 80, organizationUnits: 80 },
        { id: "fresh", organization: 0, organizationUnits: 0 },
      ],
      "fresh",
      500
    );

    expect(result.rows.find((row) => row.id === "fresh")).toMatchObject({
      organizationUnits: 1,
      organization: 0.5525,
      lastOrganizationBuildTurn: 500,
    });
    expect(result.rows.find((row) => row.id === "established")?.organization).toBeCloseTo(
      44.1989,
      4
    );
  });

  it("dilutes existing shares proportionally after the baseline bucket fills", () => {
    const result = applyOrganizationBuild(
      [
        { id: "a", organization: 60, organizationUnits: 60 },
        { id: "b", organization: 40, organizationUnits: 40 },
        { id: "fresh", organization: 0, organizationUnits: 0 },
      ],
      "fresh",
      42
    );

    expect(result.denominatorUnits).toBe(201);
    expect(result.unaffiliatedUnits).toBe(100);
    expect(result.rows.find((row) => row.id === "fresh")?.organization).toBeCloseTo(0.4975, 4);
    expect(result.rows.find((row) => row.id === "a")?.organization).toBeCloseTo(29.8507, 4);
    expect(result.rows.find((row) => row.id === "a")?.delta).toBeLessThan(0);
    expect(
      result.rows.reduce((sum, row) => sum + row.organization, 0) +
        (result.unaffiliatedUnits / result.denominatorUnits) * 100
    ).toBeCloseTo(100, 3);
  });

  it("starts proportional decay only after the inactivity grace period", () => {
    const rows = [
      {
        id: "active",
        organization: 50,
        organizationUnits: 50,
        lastOrganizationBuildTurn: 100,
      },
      {
        id: "stale",
        organization: 50,
        organizationUnits: 50,
        lastOrganizationBuildTurn: 0,
      },
    ];

    const beforeBoundary = applyOrganizationDecay(rows, ORG_DECAY_GRACE_TURNS - 1);
    expect(beforeBoundary.rows.find((row) => row.id === "stale")?.organizationUnits).toBe(50);

    const atBoundary = applyOrganizationDecay(rows, ORG_DECAY_GRACE_TURNS);
    expect(atBoundary.rows.find((row) => row.id === "stale")?.organizationUnits).toBe(49.5);
    expect(atBoundary.rows.find((row) => row.id === "stale")?.organization).toBeCloseTo(24.812, 3);
  });

  it("gives legacy rows a fresh decay clock", () => {
    const result = applyOrganizationDecay(
      [{ id: "legacy", organization: 25, organizationUnits: undefined }],
      900
    );

    expect(result.rows[0]).toMatchObject({
      organization: 25,
      organizationUnits: 33.333333,
      lastOrganizationBuildTurn: 900,
    });
  });

  it("keeps the permanent unaffiliated stake while party units decay", () => {
    const result = applyOrganizationDecay(
      [
        {
          id: "party",
          organization: 25,
          organizationUnits: 25,
          lastOrganizationBuildTurn: 0,
        },
      ],
      ORG_DECAY_GRACE_TURNS
    );

    expect(result.rows[0]?.organizationUnits).toBe(24.75);
    expect(result.rows[0]?.organization).toBeCloseTo(19.8397, 4);
    expect(result.unaffiliatedUnits).toBe(100);
    expect(result.denominatorUnits).toBe(124.75);
  });

  it("resets the inactivity clock without changing the fixed contribution size", () => {
    const result = applyOrganizationBuild(
      [
        {
          id: "party",
          organization: 10,
          organizationUnits: 10,
          lastOrganizationBuildTurn: 1,
        },
      ],
      "party",
      999
    );

    expect(result.rows[0]).toMatchObject({
      organizationUnits: 11,
      organization: 9.9099,
      lastOrganizationBuildTurn: 999,
    });
  });

  it("clamps corrupt negative or non-finite balances instead of poisoning the bucket", () => {
    const result = deriveOrganizationShares([
      { id: "negative", organization: -5, organizationUnits: -20 },
      { id: "invalid", organization: Number.NaN, organizationUnits: Number.POSITIVE_INFINITY },
      { id: "valid", organization: 15, organizationUnits: 15 },
    ]);

    expect(result.totalUnits).toBe(15);
    expect(result.unaffiliatedUnits).toBe(100);
    expect(result.rows.map((row) => row.organization)).toEqual([0, 0, 13.0435]);
  });

  it("rejects a build for a row outside the supplied regional bucket", () => {
    expect(() => applyOrganizationBuild([], "missing", 1)).toThrow(
      "Organization bucket row not found: missing"
    );
  });
});
