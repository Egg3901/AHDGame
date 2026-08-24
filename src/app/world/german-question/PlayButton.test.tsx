// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DossierPlayView } from "@/lib/settlement/queries/dossier";
import { PlayButton } from "./PlayButton";

function playView(over: Partial<DossierPlayView> = {}): DossierPlayView {
  return {
    id: "border",
    actor: "seat",
    name: "Open the Inner Border",
    detail: "Open the inner border.",
    tag: "EXCLUSIVE",
    danger: false,
    effectivePoints: 2.0,
    basisLabel: "1.00 base × 2.0× seat",
    payments: [
      {
        mode: "funds",
        label: "TREASURY",
        costLabel: "14 capital · ℳ12M · 2 AP",
        affordable: true,
        blockedReason: null,
        debtNote: null,
      },
      {
        mode: "capital",
        label: "CAPITAL",
        costLabel: "46 capital · 2 AP",
        affordable: true,
        blockedReason: null,
        debtNote: null,
      },
    ],
    ...over,
  };
}

/** A one-route play, the shape personal plays and capital-only plays take. */
function singleRoute(over: Partial<DossierPlayView> = {}): DossierPlayView {
  return playView({
    payments: [
      {
        mode: "funds",
        label: "COMMIT",
        costLabel: "18 capital · 3 AP",
        affordable: true,
        blockedReason: null,
        debtNote: null,
      },
    ],
    ...over,
  });
}

describe("PlayButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("renders one button per payment route, each with its own price", () => {
    render(<PlayButton play={playView()} onCommitted={() => {}} />);
    expect(screen.getByRole("button", { name: /TREASURY/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CAPITAL/ })).toBeTruthy();
    expect(screen.getByText(/14 capital · ℳ12M · 2 AP/)).toBeTruthy();
    expect(screen.getByText(/46 capital · 2 AP/)).toBeTruthy();
  });

  it("posts the mode of the button that was pressed", () => {
    render(<PlayButton play={playView()} onCommitted={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /CAPITAL/ }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ actor: "seat", playId: "border", payment: "capital" });
  });

  it("posts the cash route from the treasury button", () => {
    render(<PlayButton play={playView()} onCommitted={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /TREASURY/ }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ payment: "funds" });
  });

  it("disables each route on its own affordability", () => {
    // The case the whole feature exists for: capital short, treasury fine. One
    // button dead, the other live.
    render(
      <PlayButton
        play={playView({
          payments: [
            {
              mode: "funds",
              label: "TREASURY",
              costLabel: "x",
              affordable: true,
              blockedReason: null,
              debtNote: null,
            },
            {
              mode: "capital",
              label: "CAPITAL",
              costLabel: "y",
              affordable: false,
              blockedReason: "capital",
              debtNote: null,
            },
          ],
        })}
        onCommitted={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /TREASURY/ }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /CAPITAL/ }).hasAttribute("disabled")).toBe(true);
    // One route being short is a reason to use the OTHER one, not a reason the
    // play is unavailable. A standalone blocker line under a live treasury
    // button would read as though the whole play were dead.
    expect(screen.queryByText("Not enough capital banked.")).toBeNull();
  });

  it("explains the block only when every route is dead", () => {
    render(
      <PlayButton
        play={playView({
          payments: [
            {
              mode: "funds",
              label: "TREASURY",
              costLabel: "x",
              affordable: false,
              blockedReason: "actions",
              debtNote: null,
            },
            {
              mode: "capital",
              label: "CAPITAL",
              costLabel: "y",
              affordable: false,
              blockedReason: "actions",
              debtNote: null,
            },
          ],
        })}
        onCommitted={() => {}}
      />
    );
    expect(screen.getByText("No action points left this turn.")).toBeTruthy();
  });

  it("warns on the cash route when it would borrow", () => {
    // Spending into debt is allowed, so the treasury button is always live.
    // This note is the only thing that distinguishes a spend from a loan.
    render(
      <PlayButton
        play={playView({
          payments: [
            {
              mode: "funds",
              label: "TREASURY",
              costLabel: "ℳ12M · 2 AP",
              affordable: true,
              blockedReason: null,
              debtNote: "adds ℳ10M to the national debt",
            },
            {
              mode: "capital",
              label: "CAPITAL",
              costLabel: "46 capital · 2 AP",
              affordable: true,
              blockedReason: null,
              debtNote: null,
            },
          ],
        })}
        onCommitted={() => {}}
      />
    );
    expect(screen.getByText(/adds ℳ10M to the national debt/)).toBeTruthy();
  });

  it("labels a single route COMMIT rather than naming the budget", () => {
    // With nothing to choose between, "TREASURY" is noise.
    render(<PlayButton play={singleRoute()} onCommitted={() => {}} />);
    expect(screen.getByRole("button", { name: "COMMIT" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /CAPITAL/ })).toBeNull();
  });

  it("still renders two direction buttons for a personal play", () => {
    render(
      <PlayButton play={singleRoute({ id: "letter", actor: "personal" })} onCommitted={() => {}} />
    );
    expect(screen.getByRole("button", { name: "NATO" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PACT" })).toBeTruthy();
  });

  it("closes a play the character has already used this turn, and says when it returns", () => {
    render(
      <PlayButton
        play={singleRoute({
          id: "letter",
          actor: "personal",
          payments: [
            {
              mode: "funds",
              label: "COMMIT",
              costLabel: "1 AP",
              affordable: false,
              blockedReason: "used",
              debtNote: null,
            },
          ],
        })}
        onCommitted={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "NATO" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "PACT" }).hasAttribute("disabled")).toBe(true);
    // The horizon matters. A dead button with no stated return reads as
    // permanently broken rather than as an allowance.
    expect(screen.getByText(/already used this play this turn/i)).toBeTruthy();
    expect(screen.getByText(/resets next turn/i)).toBeTruthy();
  });

  it("sends a personal play's direction on the funds route", () => {
    render(
      <PlayButton play={singleRoute({ id: "letter", actor: "personal" })} onCommitted={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "PACT" }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ actor: "personal", direction: 1, payment: "funds" });
  });
});
