/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelocateButton } from "./RelocateButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (amount: number) => `$${amount}` }),
}));
vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({ refetch: vi.fn() }),
}));

const readyStatus = {
  canRelocate: true,
  remainingTurns: 0,
  cooldownRemainingDays: null,
  hasOffice: false,
  officeRequiresStateResidency: false,
  isCeo: false,
  ceoCorpName: null,
  homeState: "WA",
  activeCandidacies: { generalElections: 0, statePartyElections: 0 },
  corpRelocation: null,
};

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("RelocateButton", () => {
  it("allows a cross-country move between regions with the same ID", async () => {
    render(
      <RelocateButton
        targetStateId="HB"
        targetName="Hubei"
        userHomeState="HB"
        userCountryId="DE"
        targetCountryId="CN"
        redirectPath="/country/cn/region/HB"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Relocate here" }));
    expect(screen.getByRole("dialog").textContent).toContain("Hubei");
  });

  it("warns and explicitly confirms an out-of-frontier party departure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ...readyStatus,
          hasParty: true,
          partyCountryId: "US",
          partyFrontierRegions: ["WA", "OR", "ID"],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RelocateButton
        targetStateId="NY"
        targetName="New York"
        targetCountryId="US"
        userCountryId="US"
        userHomeState="WA"
        redirectPath="/country/us/region/NY"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Relocate here" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/become Independent/);
    expect(screen.getByRole("dialog").textContent).toMatch(/does not start a new cooldown/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Relocate$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      confirmPartyDeparture: true,
      targetStateId: "NY",
    });
  });

  it("handles a changed frontier by requiring another click after the server warning", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ...readyStatus,
          hasParty: true,
          partyCountryId: "US",
          partyFrontierRegions: ["NY"],
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Confirm party departure", partyDepartureRequired: true }),
          { status: 409 }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RelocateButton
        targetStateId="NY"
        targetName="New York"
        targetCountryId="US"
        userHomeState="WA"
        redirectPath="/country/us/region/NY"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Relocate here" }));
    fireEvent.click(screen.getByRole("button", { name: /^Relocate$/ }));
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toMatch(/become Independent/)
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).confirmPartyDeparture).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Relocate$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).confirmPartyDeparture).toBe(true);
  });
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(readyStatus)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides the control on the character's current home state", async () => {
    const { container } = render(
      <RelocateButton
        targetStateId="WA"
        targetName="Washington"
        userHomeState="WA"
        redirectPath="/country/us/region/WA"
      />
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("keeps Relocate here clickable when ready", async () => {
    render(
      <RelocateButton
        targetStateId="OR"
        targetName="Oregon"
        userHomeState="WA"
        redirectPath="/country/us/region/OR"
      />
    );
    const button = await screen.findByRole("button", { name: "Relocate here" });
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Relocate to another state" })).toBeTruthy();
  });

  it("shows remaining wait and a cooldown dialog after a recent move (ticket #1117)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...readyStatus,
          canRelocate: false,
          remainingTurns: 72,
          cooldownRemainingDays: 3,
        })
      )
    );
    render(
      <RelocateButton
        targetStateId="OR"
        targetName="Oregon"
        userHomeState="WA"
        redirectPath="/country/us/region/OR"
      />
    );
    const button = await screen.findByRole("button", { name: /Relocate in 3 days/i });
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Relocation cooldown" });
    expect(dialog.textContent).toMatch(/3-day cooldown/i);
    expect(dialog.textContent).toMatch(/You can relocate again in 3 days/i);
    expect(screen.queryByRole("button", { name: /^Relocate$/ })).toBeNull();
  });

  it("warns about the cooldown before you move (ticket #1117)", async () => {
    render(
      <RelocateButton
        targetStateId="OR"
        targetName="Oregon"
        userHomeState="WA"
        redirectPath="/country/us/region/OR"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Relocate here" }));
    const dialog = screen.getByRole("dialog", { name: "Relocate to another state" });
    expect(dialog.textContent).toMatch(/not be able to relocate again for 3 days \(72 turns\)/i);
  });

  it("routes a pending federation resident through the protected no-fee choice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ...readyStatus,
          canRelocate: false,
          remainingTurns: 72,
          federationPendingResidenceId: "1991-default:ussr-split:1",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RelocateButton
        targetStateId="OR"
        targetName="Oregon"
        targetCountryId="US"
        userHomeState="KYIV"
        userCountryId="RU"
        redirectPath="/country/us/region/OR"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Choose new home" }));
    expect(screen.getByRole("dialog", { name: "Choose a new playable home" }).textContent).toMatch(
      /no relocation fee/i
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose this home" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/federation/relocation/residence");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      applicationId: "1991-default:ussr-split:1",
      targetCountryId: "US",
      targetStateId: "OR",
    });
  });
});
