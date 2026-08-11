/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignRail } from "./CampaignRail";

const base = {
  countryId: "UK",
  regionId: "NIR",
  referendumId: "r1",
  kind: "reunification" as const,
  yesShare: 57,
  campaignCloseTurn: 50,
  currentTurn: 26,
  role: "auto" as const,
};

describe("CampaignRail", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the PM gate for a PM on a requested referendum", () => {
    render(<CampaignRail {...base} status="requested" isPM isAdmin={false} />);
    expect(screen.getByRole("button", { name: /Grant the referendum/i })).toBeTruthy();
  });

  it("shows the await-PM note for a non-PM on a requested referendum", () => {
    render(<CampaignRail {...base} status="requested" isPM={false} isAdmin={false} />);
    expect(screen.getByText(/Awaiting/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Grant the referendum/i })).toBeNull();
  });

  it("shows the declare control for an eligible viewer while campaigning", () => {
    render(
      <CampaignRail
        {...base}
        status="campaigning"
        isPM={false}
        isAdmin={false}
        viewerCanDeclare
        viewerDeclaredSide={null}
      />
    );
    expect(screen.getByText(/Declare your party/i)).toBeTruthy();
  });

  it("shows the ground-game preset cards for a same-nation viewer", () => {
    render(
      <CampaignRail
        {...base}
        status="campaigning"
        isPM={false}
        isAdmin={false}
        viewerCanGroundGame
        groundGameMode="volunteer"
        groundGameTarget="whole"
        groundGameTargetName="Whole electorate"
        groundGameSaturation={0}
        groundGameLabels={{ yes: "Reunify", no: "Stay in UK" }}
      />
    );
    expect(screen.getByRole("button", { name: /Mass rally/i })).toBeTruthy();
  });

  it("honors the admin role prop (preview as PM shows the grant gate)", () => {
    render(<CampaignRail {...base} status="requested" isPM={false} isAdmin role="pm" />);
    expect(screen.getByRole("button", { name: /Grant the referendum/i })).toBeTruthy();
  });
});
