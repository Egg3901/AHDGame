// @vitest-environment happy-dom
import React from "react";
import { NextIntlClientProvider } from "next-intl";
import enNav from "../../../messages/en/nav.json";
import { act, cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hasCharacter: false,
  mode: "normal",
  refetch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({
    navData: { hasCharacter: state.hasCharacter, user: { singleplayerMode: state.mode } },
    refetch: state.refetch,
  }),
}));
import { SingleplayerEndTurnButton } from "./SingleplayerEndTurnButton";

function render(ui: React.ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={enNav}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

describe("local turn controls", () => {
  beforeEach(() => {
    state.hasCharacter = false;
    state.mode = "normal";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ turn: 2 }) })
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("locks both manual and automatic turns before character creation", () => {
    render(<SingleplayerEndTurnButton />);
    expect((screen.getByRole("button", { name: "End turn" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Start automatic turns",
          hidden: true,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops a running timer when the character is lost", async () => {
    vi.useFakeTimers();
    state.hasCharacter = true;
    const view = render(<SingleplayerEndTurnButton />);
    fireEvent.click(screen.getByText("Start automatic turns"));
    state.hasCharacter = false;
    view.rerender(<SingleplayerEndTurnButton />);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("advances once and refreshes auth and server content", async () => {
    state.hasCharacter = true;
    render(<SingleplayerEndTurnButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End turn" }));
    });
    expect(fetch).toHaveBeenCalledWith("/api/singleplayer/turn/advance", { method: "POST" });
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("allows playerless worldsim to advance through its authoritative route", async () => {
    state.mode = "worldsim";
    render(<SingleplayerEndTurnButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End turn" }));
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/singleplayer/worldsim/advance",
      expect.objectContaining({ body: JSON.stringify({ turns: 1 }) })
    );
  });
});
