// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { InfluenceTab } from "./InfluenceTab";

const BASE: OrgInfluenceView = {
  enabled: true,
  year: 1953,
  channel: {
    poleId: "WEST",
    poleLabel: "West",
    accentToken: "info",
    weight: 1,
  },
  fundBalanceLocal: 5_000_000_000,
  fundCurrencyCountryId: "US",
  targets: [
    {
      entityId: "SE",
      joinCountdown: null,
      name: "Sweden",
      lead: 12,
      status: "non-aligned",
      ourShare: 30,
      resistsAtHalfStrength: true,
      pointCostLocal: 300_000_000,
      turnCapCostLocal: 1_500_000_000,
      shares: { WEST: 30, EAST: 50 },
      nonAligned: 20,
      topPoleId: "EAST" as const,
      trend: null,
      ourShareTrend: null,
      crisis: null,
      sanctionedBy: [],
      isMember: false,
      costToGate: 1_000,
    },
    {
      entityId: "YU",
      joinCountdown: null,
      name: "Yugoslavia",
      lead: 28,
      status: "contested",
      ourShare: 22,
      resistsAtHalfStrength: false,
      pointCostLocal: 60_000_000,
      turnCapCostLocal: 300_000_000,
      shares: { WEST: 30, EAST: 50 },
      nonAligned: 20,
      topPoleId: "EAST" as const,
      trend: null,
      ourShareTrend: null,
      crisis: null,
      sanctionedBy: [],
      isMember: false,
      costToGate: 1_000,
    },
  ],
  recent: [],
  members: [],
  sustainTurns: 24,
  joinShare: 60,
  leaveShare: 40,
  poles: [
    { id: "WEST" as const, label: "West", shortLabel: "W", accentToken: "info" as const },
    { id: "EAST" as const, label: "East", shortLabel: "E", accentToken: "error" as const },
  ],
  remainderLabel: "Non-aligned",
  rivalIntel: {
    YU: [{ poleLabel: "East", accentToken: "error" as const, pointsLanded: 6, turnsAgo: 1 }],
  },
  balance: {
    byEconomy: { shares: { WEST: 61, EAST: 21 }, nonAligned: 18 },
    byNations: { shares: { WEST: 43, EAST: 33 }, nonAligned: 24 },
    economyCount: 182,
    nationCount: 197,
  },
  leviesTribute: true,
  blocStress: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("InfluenceTab", () => {
  it("explains itself when the feature is off rather than showing a dead form", () => {
    render(
      <InfluenceTab
        view={{ ...BASE, enabled: false, channel: null, targets: [] }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/not enabled in this world/i)).toBeTruthy();
    expect(screen.queryByText(/Commit play/i)).toBeNull();
  });

  it("says why an org carries no influence this era", () => {
    render(
      <InfluenceTab
        view={{ ...BASE, channel: null, targets: [] }}
        orgId="EU"
        viewerCountryId="DE"
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/carries no influence in 1953/i)).toBeTruthy();
  });

  it("shows what a resolved play bought, and marks a pending one", () => {
    render(
      <InfluenceTab
        view={{
          ...BASE,
          recent: [
            {
              targetEntityId: "YU",
              targetName: "Yugoslavia",
              sponsorCountryId: "US",
              amountLocal: 9e8,
              turn: 4,
              resolvedTurn: 5,
              appliedPoints: 3,
              refunded: false,
            },
            {
              targetEntityId: "SE",
              targetName: "Sweden",
              sponsorCountryId: "UK",
              amountLocal: 1e8,
              turn: 6,
              resolvedTurn: null,
              appliedPoints: null,
              refunded: false,
            },
          ],
        }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    expect(screen.getByText("3 pts")).toBeTruthy();
    expect(screen.getByText("pending")).toBeTruthy();
  });

  it("says refunded rather than 0 pts when the spend came back", () => {
    // "0 pts" beside a spend reads as money taken for nothing. The refund path
    // fires when a target locks between commit and resolve.
    render(
      <InfluenceTab
        view={{
          ...BASE,
          recent: [
            {
              targetEntityId: "PL",
              targetName: "Poland",
              sponsorCountryId: "US",
              amountLocal: 2.5e8,
              turn: 4,
              resolvedTurn: 5,
              appliedPoints: 0,
              refunded: true,
            },
          ],
        }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    expect(screen.getByText("refunded")).toBeTruthy();
    expect(screen.queryByText("0 pts")).toBeNull();
  });

  it("shows a member that pays tribute as a member without a vote", () => {
    render(
      <InfluenceTab
        view={{
          ...BASE,
          members: [
            {
              countryId: "TR",
              name: "Turkey",
              eligible: true,
              share: 70,
              wantsOut: false,
              turnsBelowGate: null,
              exempt: false,
              hasVote: false,
            },
          ],
        }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    // A tribute payer is a full member, not an error and not a blank row.
    const row = screen.getByText("Turkey").closest("li")!;
    expect(row.textContent).toMatch(/no vote, pays tribute/i);
    expect(row.textContent).toMatch(/70\.00 of West/);
  });

  it("does not claim tribute from an org that does not levy it", () => {
    // Only the two armed blocs levy tribute, and only in a 1953-start world.
    // Elsewhere a member without a vote simply has no vote — saying it pays
    // would describe money that is never charged.
    render(
      <InfluenceTab
        view={{
          ...BASE,
          leviesTribute: false,
          members: [
            {
              countryId: "TR",
              name: "Turkey",
              eligible: true,
              share: 70,
              wantsOut: false,
              turnsBelowGate: null,
              exempt: false,
              hasVote: false,
            },
          ],
        }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    const row = screen.getByText("Turkey").closest("li")!;
    expect(row.textContent).toMatch(/no vote/i);
    expect(row.textContent).not.toMatch(/tribute/i);
  });

  it("lays the room out: balance, roster, dossier, then the standing panels", () => {
    render(<InfluenceTab view={BASE} orgId="NATO" viewerCountryId="US" onChange={() => {}} />);
    expect(screen.getByTestId("balance-bar")).toBeTruthy();
    expect(screen.getAllByTestId("nation-row").length).toBeGreaterThan(0);
    // The heading, not any mention: the dossier's spend note now points players
    // at this panel by name, so a bare text match is ambiguous.
    expect(screen.getByRole("heading", { name: /Recent plays/i })).toBeTruthy();
  });

  it("opens with the top-ranked nation already in the dossier", () => {
    // An empty right-hand column on load would waste the screen and hide the
    // very thing the ranking just worked out.
    render(<InfluenceTab view={BASE} orgId="NATO" viewerCountryId="US" onChange={() => {}} />);
    const dossier = screen.getByTestId("nation-dossier");
    const topRow = screen.getAllByTestId("nation-row")[0]!;
    expect(dossier.textContent).toContain(topRow.textContent!.match(/[A-Z][a-z]+/)![0]);
  });

  it("swaps the dossier when another nation is chosen", () => {
    render(<InfluenceTab view={BASE} orgId="NATO" viewerCountryId="US" onChange={() => {}} />);
    const rows = screen.getAllByTestId("nation-row");
    const secondName = rows[1]!.textContent!.match(/[A-Z][a-z]+/)![0];
    fireEvent.click(rows[1]!);
    expect(screen.getByTestId("nation-dossier").textContent).toContain(secondName);
  });

  it("says so plainly when every nation is locked", () => {
    render(
      <InfluenceTab
        view={{ ...BASE, targets: [] }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/no one left to court/i)).toBeTruthy();
  });

  it("flags a member at or below the leave share and counts down to its defection", () => {
    render(
      <InfluenceTab
        view={{
          ...BASE,
          members: [
            {
              countryId: "US",
              name: "United States",
              eligible: true,
              share: 95,
              wantsOut: false,
              turnsBelowGate: null,
              exempt: false,
              hasVote: true,
            },
            {
              countryId: "TR",
              name: "Turkey",
              eligible: false,
              share: 8,
              wantsOut: true,
              turnsBelowGate: 11,
              exempt: false,
              hasVote: true,
            },
          ],
        }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    const turkey = screen.getByText("Turkey").closest("li")!;
    expect(turkey.textContent).toMatch(/at or below 40/i);
    expect(turkey.textContent).toMatch(/11\/24 turns/);
    // A member in good standing shows its lead, not a warning.
    const us = screen.getByText("United States").closest("li")!;
    expect(us.textContent).not.toMatch(/at or below 40/i);
  });

  it("says a player-steered nation is warned rather than removed", () => {
    render(
      <InfluenceTab
        view={{
          ...BASE,
          members: [
            {
              countryId: "TR",
              name: "Turkey",
              eligible: false,
              share: 8,
              wantsOut: true,
              turnsBelowGate: 3,
              exempt: false,
              hasVote: true,
            },
          ],
        }}
        orgId="NATO"
        viewerCountryId="US"
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/warned rather than moved/i)).toBeTruthy();
  });
});
