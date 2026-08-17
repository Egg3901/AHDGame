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
});
