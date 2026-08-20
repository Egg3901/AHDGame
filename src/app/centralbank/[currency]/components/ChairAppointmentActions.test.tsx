/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChairAppointmentActions } from "./ChairAppointmentActions";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Ticket #1072: the nominee saw "Awaiting acceptance" and had no control. He
// said "There is only a link that take to the bank page", and the chair stayed
// with the incumbent NPP.
const PENDING = {
  characterId: "6a78cdd0346400213cf9d4f6",
  characterName: "Erich Lindner",
  pool: "political" as const,
  proposedAt: "2026-08-20T02:00:00.120Z",
  acceptanceTurnsRemaining: 4,
};

const BASE = {
  chairTitle: "Chair",
  chair: null,
  chairAppointedAt: null,
  chairInfamy: 0,
  chairTermExpiresAtTurn: null,
  currentTurn: 250,
  currentInflation: 2,
  targetInflation: 2,
  latestGdp: 2,
  chairSelectionPending: PENDING,
  countryCode: "DD",
};

describe("ChairAppointmentActions", () => {
  it("gives the nominee a way to accept or decline", () => {
    render(<ChairAppointmentActions countryCode="DD" />);
    expect(screen.getByText("Accept appointment")).toBeTruthy();
    expect(screen.getByText("Decline")).toBeTruthy();
  });

  it("posts to the accept route for the right country", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChairAppointmentActions countryCode="DD" />);
    fireEvent.click(screen.getByText("Accept appointment"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/country/DD/central-bank/chair-selection/accept",
        { method: "POST" }
      )
    );
  });

  it("posts to the decline route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChairAppointmentActions countryCode="DD" />);
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/country/DD/central-bank/chair-selection/decline",
        { method: "POST" }
      )
    );
  });

  it("surfaces a failure instead of silently doing nothing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "Offer has lapsed" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChairAppointmentActions countryCode="DD" />);
    fireEvent.click(screen.getByText("Accept appointment"));
    await waitFor(() => expect(screen.getByText("Offer has lapsed")).toBeTruthy());
  });
});
