/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import IndustrialRelationsSection from "./IndustrialRelationsSection";

beforeEach(() => vi.restoreAllMocks());

describe("IndustrialRelationsSection", () => {
  it("stays hidden when the full labor system is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Player-run unions are not enabled." }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    render(<IndustrialRelationsSection corpId="corp1" />);

    expect(screen.getByText("Loading industrial relations...")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(screen.queryByLabelText("Industrial Relations")).toBeNull();
    });
  });

  it("shows a recoverable request error instead of silently hiding the panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Bargaining service unavailable." }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    render(<IndustrialRelationsSection corpId="corp1" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Bargaining service unavailable."
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows an incoming union offer and lets the CEO accept it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          currentTurn: 102,
          campaigns: [
            {
              campaignId: "campaign1",
              unionId: "union1",
              unionName: "Industrial Workers",
              status: "negotiating",
              escalationLevel: "none",
              currentOffer: {
                revision: 1,
                proposedBy: "union",
                wageLevel: 1.15,
                agreementDurationTurns: 48,
                noStrikeTurns: 24,
                proposedAtTurn: 100,
              },
              offers: [],
              mandate: {
                leverage: 62,
                coverage: 60,
                grievance: 50,
                laborTightness: 40,
                lawSupport: 65,
              },
              sectorCount: 2,
              startedAtTurn: 100,
              deadlineTurn: 108,
              endedAtTurn: null,
            },
          ],
          agreements: [],
        }),
      } as Response;
    });
    global.fetch = fetchMock as typeof fetch;

    render(<IndustrialRelationsSection corpId="corp1" />);

    expect(await screen.findByText("Industrial Workers")).toBeTruthy();
    expect(screen.getByText("1.15×")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp1/bargaining/campaign1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "accept" }) })
      );
    });

    // Attribution: the employer reads the observable inputs behind leverage,
    // but never the union's strike fund or its internal strike ballot.
    expect(screen.getByText("Labour market")).toBeTruthy();
    expect(screen.getByText("Labour law")).toBeTruthy();
    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByText("Grievance")).toBeTruthy();
    expect(screen.queryByText("Strike fund")).toBeNull();
  });
});
