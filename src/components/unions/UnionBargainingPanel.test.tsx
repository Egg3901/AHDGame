/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnionBargainingPanel, type UnionBargainingCampaign } from "./UnionBargainingPanel";

function dispute(): UnionBargainingCampaign {
  const offer = {
    revision: 2,
    proposedBy: "employer" as const,
    wageLevel: 1.08,
    agreementDurationTurns: 48,
    noStrikeTurns: 24,
    proposedAtTurn: 101,
  };
  return {
    campaignId: "campaign1",
    employerCorporationId: "corp1",
    employerName: "Acme Manufacturing",
    status: "dispute",
    escalationLevel: "none",
    escalationPreview: {
      nextLevel: "overtime_ban",
      supportRequired: 35,
      cashCost: 0,
      // 2 locals in scope at the per-local rate. The server owns this figure.
      upkeepPerTurn: 80,
      newStrikeLocalCount: 0,
      targetLocals: [
        { sectorId: "sector1", stateId: "MI" },
        { sectorId: "sector2", stateId: "OH" },
      ],
    },
    mediation: null,
    ratification: null,
    mediationAvailable: true,
    mediationUnavailableReason: null,
    currentOffer: offer,
    offers: [offer],
    mandate: {
      support: 70,
      leverage: 60,
      coverage: 65,
      grievance: 50,
      laborTightness: 45,
      lawSupport: 55,
      strikeFundRunway: 2.5,
    },
    sectorCount: 2,
    deadlineTurn: 108,
    lastActionTurn: 104,
    mediationAvailableTurn: 103,
  };
}

describe("UnionBargainingPanel dispute actions", () => {
  it("shows the next supported escalation and records it through the campaign route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    const onReload = vi.fn().mockResolvedValue(undefined);

    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[dispute()]}
        onReload={onReload}
      />
    );

    expect(screen.getByText(/Cost 0 · Affects 2 local\(s\): MI, OH/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Begin overtime ban" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/union1/bargaining/campaign1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ action: "escalate" }),
        })
      );
    });
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("shows the exact mediated package and lets the union answer it", async () => {
    const campaign = dispute();
    campaign.mediation = {
      wageLevel: 1.11,
      agreementDurationTurns: 60,
      noStrikeTurns: 30,
      unionAccepted: false,
      employerAccepted: true,
      status: "pending",
      expiresAtTurn: 109,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[campaign]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText(/Mediation package: 1.11× wage/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept mediation" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/union1/bargaining/campaign1",
        expect.objectContaining({ body: JSON.stringify({ action: "accept_mediation" }) })
      );
    });
  });

  it("explains why a directly rejected opening offer cannot be mediated", () => {
    const campaign = dispute();
    campaign.mediationAvailable = false;
    campaign.mediationUnavailableReason =
      "Mediation requires a wage package from both parties. A direct rejection cannot be mediated.";

    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[campaign]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByRole("button", { name: "Request mediation" })).toBeNull();
    expect(screen.getByText(/direct rejection cannot be mediated/i)).toBeTruthy();
  });

  it("prices the ban before it is called and while it is held", () => {
    const campaign = dispute();
    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[campaign]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );
    // 2 locals in scope, so 2 x the per-local upkeep every turn it is held.
    expect(screen.getByText(/then 80 per turn to hold it/)).toBeTruthy();

    const held = dispute();
    held.escalationLevel = "overtime_ban";
    held.heldUpkeepPerTurn = 80;
    held.escalationPreview = {
      nextLevel: "selective_strike",
      supportRequired: 50,
      cashCost: 500,
      newStrikeLocalCount: 1,
      targetLocals: [{ sectorId: "sector1", stateId: "MI" }],
    };
    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[held]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(screen.getByText(/Upkeep 80 per turn · treasury funds 25 more turn\(s\)/)).toBeTruthy();
  });

  it("shows a blocked escalation as blocked instead of offering the button", () => {
    const campaign = dispute();
    campaign.escalationLevel = "overtime_ban";
    campaign.escalationPreview = {
      nextLevel: "selective_strike",
      supportRequired: 50,
      cashCost: 400,
      newStrikeLocalCount: 1,
      targetLocals: [{ sectorId: "sector1", stateId: "MI" }],
      upkeepPerTurn: 0,
      strikeCooldownUntilTurn: 108,
      blockedReason: "This union can call another strike on turn 108.",
    };

    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={100_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[campaign]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("This union can call another strike on turn 108.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Call selective strike" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("shows the server's held upkeep rather than recomputing it from the raw local count", () => {
    // The turn charges upkeep only for locals that still resolve, so a campaign
    // whose locals have been sold or destroyed costs less than its snapshotted
    // `sectorCount` suggests. The panel must print the server's figure.
    const held = dispute();
    held.escalationLevel = "overtime_ban";
    held.sectorCount = 5;
    held.heldUpkeepPerTurn = 80;
    held.escalationPreview = {
      nextLevel: "selective_strike",
      supportRequired: 50,
      cashCost: 500,
      newStrikeLocalCount: 1,
      targetLocals: [{ sectorId: "sector1", stateId: "MI" }],
    };
    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[held]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(screen.getByText(/Upkeep 80 per turn/)).toBeTruthy();
    expect(screen.queryByText(/Upkeep 200 per turn/)).toBeNull();
  });

  it("gives an organizer their weight, the running tally and a ballot", async () => {
    const campaign = dispute();
    campaign.ratification = {
      status: "open",
      offerRevision: 2,
      openedAtTurn: 104,
      closesAtTurn: 107,
      closedAtTurn: null,
      ratifyStrength: 20,
      rejectStrength: 10,
      castStrength: 30,
      outstandingStrength: 70,
      ratifyCount: 1,
      rejectCount: 1,
      totalStrength: 100,
      voterCount: 4,
      viewerWeight: 40,
      viewerVote: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader={false}
        employers={[]}
        campaigns={[campaign]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText(/Member ratification of offer 2/)).toBeTruthy();
    expect(screen.getByText("20 (20%)")).toBeTruthy();
    expect(screen.getByText("Your weight")).toBeTruthy();
    expect(screen.getByText("You have not voted.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ratify" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/union1/bargaining/campaign1/ratify",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ vote: "ratify" }) })
      );
    });
  });

  it("shows every input behind the mandate, not just support and leverage", () => {
    render(
      <UnionBargainingPanel
        unionId="union1"
        unionTreasury={2_000}
        currentTurn={105}
        isLeader
        employers={[]}
        campaigns={[dispute()]}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("Labour market")).toBeTruthy();
    expect(screen.getByText("Labour law")).toBeTruthy();
    expect(screen.getByText("Strike fund")).toBeTruthy();
    expect(screen.getByText("2.5 calls")).toBeTruthy();
  });
});
