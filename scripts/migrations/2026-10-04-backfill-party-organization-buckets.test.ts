import { describe, expect, it } from "vitest";
import { planPartyOrganizationRegion } from "./2026-10-04-backfill-party-organization-buckets";

describe("party organization bucket migration", () => {
  it("preserves legacy regional shares while materializing units and clocks", () => {
    const plan = planPartyOrganizationRegion(
      [
        { _id: "US:CA:a", organization: 60 },
        { _id: "US:CA:b", organization: 30 },
      ],
      500
    );

    expect(plan).toMatchObject({
      changedRows: 2,
      initializedUnitRows: 2,
      initializedClockRows: 2,
      partyUnits: 900,
      denominatorUnits: 1000,
      unaffiliatedUnits: 100,
    });
    expect(plan.rows).toEqual([
      expect.objectContaining({
        id: "US:CA:a",
        organization: 60,
        organizationUnits: 600,
        lastOrganizationBuildTurn: 500,
      }),
      expect.objectContaining({
        id: "US:CA:b",
        organization: 30,
        organizationUnits: 300,
        lastOrganizationBuildTurn: 500,
      }),
    ]);
  });

  it("uses existing durable units when converting a mixed rollout region", () => {
    const plan = planPartyOrganizationRegion(
      [
        {
          _id: "US:NY:unitized",
          organization: 50,
          organizationUnits: 100,
          lastOrganizationBuildTurn: 450,
        },
        { _id: "US:NY:legacy", organization: 20 },
      ],
      500
    );

    expect(plan.rows).toEqual([
      expect.objectContaining({
        id: "US:NY:unitized",
        organization: 40,
        organizationUnits: 100,
        lastOrganizationBuildTurn: 450,
      }),
      expect.objectContaining({
        id: "US:NY:legacy",
        organization: 20,
        organizationUnits: 50,
        lastOrganizationBuildTurn: 500,
      }),
    ]);
  });

  it("is idempotent after applying its planned values", () => {
    const first = planPartyOrganizationRegion(
      [
        { _id: "UK:LON:a", organization: 45 },
        { _id: "UK:LON:b", organization: 35 },
      ],
      800
    );
    const second = planPartyOrganizationRegion(
      first.rows.map((row) => ({
        _id: row.id,
        organization: row.organization,
        organizationUnits: row.organizationUnits,
        lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
      })),
      800
    );

    expect(second.changedRows).toBe(0);
    expect(second.initializedUnitRows).toBe(0);
    expect(second.initializedClockRows).toBe(0);
  });

  it("repairs invalid balances without poisoning the regional denominator", () => {
    const plan = planPartyOrganizationRegion(
      [
        {
          _id: "DE:BE:invalid",
          organization: Number.NaN,
          organizationUnits: -5,
          lastOrganizationBuildTurn: -1,
        },
        {
          _id: "DE:BE:valid",
          organization: 15,
          organizationUnits: 15,
          lastOrganizationBuildTurn: 10,
        },
      ],
      200
    );

    expect(plan).toMatchObject({
      partyUnits: 15,
      denominatorUnits: 115,
      changedRows: 2,
      initializedUnitRows: 1,
      initializedClockRows: 1,
    });
    expect(plan.rows[0]).toMatchObject({
      organization: 0,
      organizationUnits: 0,
      lastOrganizationBuildTurn: 200,
    });
    expect(plan.rows[1]).toMatchObject({
      organization: 13.0435,
      organizationUnits: 15,
      lastOrganizationBuildTurn: 10,
    });
  });

  it("rejects an invalid turn instead of creating an invalid decay clock", () => {
    expect(() => planPartyOrganizationRegion([], -1)).toThrow("Invalid current turn");
    expect(() => planPartyOrganizationRegion([], 1.5)).toThrow("Invalid current turn");
  });
});
