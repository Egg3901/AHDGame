/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNav from "../../../messages/en/nav.json";
import type { TurnProgressStatus } from "./turnProgressLifecycle";
import { TURN_PROGRESS_CARD_CLASS, TURN_PROGRESS_SLOT_CLASS } from "./turnProgressPresentation";

const mocks = vi.hoisted(() => ({
  pathname: "/country/us",
  status: null as TurnProgressStatus | null,
  refresh: vi.fn(),
  eventHandler: null as null | ((event: { type: string }) => void),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/hooks/useGameEvents", () => ({
  useGameTurnStatus: () => mocks.status,
  useGameEvents: (
    handler: (event: { type: string }) => void,
    _types?: string[],
    enabled = true
  ) => {
    mocks.eventHandler = enabled ? handler : null;
  },
  refreshGameTurnStatus: (...args: unknown[]) => mocks.refresh(...args),
}));

import { TurnProgressToast } from "./TurnProgressToast";

function renderToast() {
  return render(
    <NextIntlClientProvider locale="en" messages={enNav}>
      <TurnProgressToast />
    </NextIntlClientProvider>
  );
}

const PROCESSING_STARTED_AT = new Date().toISOString();

function processing(overrides: Partial<TurnProgressStatus> = {}): TurnProgressStatus {
  const now = new Date().toISOString();
  return {
    currentTurn: 40,
    isActive: true,
    isProcessing: true,
    nextScheduledTurn: null,
    singleplayer: true,
    processingTargetTurn: 41,
    processingPhase: "corporationProduction",
    processingPhaseLabel: "Corporation Production",
    processingProgress: 47,
    processingStartedAt: PROCESSING_STARTED_AT,
    processingHeartbeatAt: now,
    ...overrides,
  };
}

describe("TurnProgressToast", () => {
  beforeEach(() => {
    mocks.pathname = "/country/us";
    mocks.status = null;
    mocks.refresh.mockReset();
    mocks.eventHandler = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not display on multiplayer status", () => {
    mocks.status = processing({ singleplayer: false });
    renderToast();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("centers the compact card on mobile and docks it on desktop", () => {
    mocks.status = processing();
    const { container } = renderToast();
    const slot = container.querySelector("[data-turn-progress-slot]");
    const card = screen.getByRole("status");
    expect(slot?.className).toBe(TURN_PROGRESS_SLOT_CLASS);
    expect(card.className).toBe(TURN_PROGRESS_CARD_CLASS);
    expect(slot?.className).toContain("justify-center");
    expect(slot?.className).toContain("sm:right-5");
    expect(card.className).toContain("max-w-[20rem]");
    expect(card.className).toContain("overflow-hidden");
  });

  it("shows measured progress and the current activity", () => {
    mocks.status = processing();
    renderToast();
    expect(screen.getByText("Processing turn 41")).toBeTruthy();
    expect(screen.getByText("Updating markets and the economy")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("47");
    expect((bar.firstElementChild as HTMLElement | null)?.style.width).toBe("47%");
  });

  it("clears after completed status", () => {
    mocks.status = processing();
    const view = renderToast();
    expect(screen.getByRole("status")).toBeTruthy();
    mocks.status = processing({
      currentTurn: 41,
      isProcessing: false,
      processingTargetTurn: null,
      processingProgress: null,
    });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={enNav}>
        <TurnProgressToast />
      </NextIntlClientProvider>
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears on the local turn-complete event even if a processing snapshot lingers", () => {
    mocks.status = processing();
    renderToast();
    act(() => {
      window.dispatchEvent(new Event("ahd:turn-complete"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an error instead of a forever spinner", () => {
    mocks.status = processing();
    renderToast();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("ahd:turn-error", { detail: { message: "Turn failed" } })
      );
    });
    expect(screen.getByRole("alert").textContent).toContain("Turn failed");
  });

  it("shows connection loss instead of a forever spinner", () => {
    mocks.status = processing();
    renderToast();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("alert").textContent).toContain("Connection lost");
  });

  it("shows stale lock state and retries with a status refresh, not a new turn", () => {
    mocks.status = processing({ canResetProcessingLock: true });
    renderToast();
    expect(screen.getByRole("alert").textContent).toContain("Turn may be stuck");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows a later turn after dismiss", () => {
    mocks.status = processing();
    const view = renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();

    mocks.status = processing({ processingProgress: 61 });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={enNav}>
        <TurnProgressToast />
      </NextIntlClientProvider>
    );
    expect(screen.queryByRole("status")).toBeNull();

    mocks.status = processing({
      currentTurn: 41,
      processingTargetTurn: 42,
    });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={enNav}>
        <TurnProgressToast />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Processing turn 42")).toBeTruthy();
  });

  it("does not mount on chrome-hidden paths", () => {
    mocks.pathname = "/login";
    mocks.status = processing();
    renderToast();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
