/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceGrantManager } from "./ResourceGrantManager";

describe("ResourceGrantManager", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the voucher grant only to admins and prevents duplicate grants", async () => {
    let resolveGrant!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/resources/characters") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              characters: [
                {
                  id: "507f1f77bcf86cd799439011",
                  name: "Ada Player",
                  party: "independent",
                  homeState: "NY",
                  actions: 10,
                  funds: 100,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url === "/api/forex/rates") {
        return Promise.resolve(
          new Response(JSON.stringify({ rates: { USD: 1 } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url === "/api/admin/resources/grant" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveGrant = resolve;
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ResourceGrantManager />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /ada player/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /positions update voucher/i }));
    const grantButton = screen.getByRole("button", { name: /grant resources/i });
    fireEvent.click(grantButton);
    fireEvent.click(grantButton);

    await waitFor(() => {
      const grantCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/admin/resources/grant" && init?.method === "POST"
      );
      expect(grantCalls).toHaveLength(1);
      expect(JSON.parse(String(grantCalls[0]![1]?.body))).toEqual({
        characterIds: ["507f1f77bcf86cd799439011"],
        allPlayers: false,
        positionUpdateVoucher: true,
      });
    });

    resolveGrant(
      new Response(JSON.stringify({ message: "Granted", affectedCount: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("does not render the admin-only voucher control for moderators", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ characters: [], rates: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    render(<ResourceGrantManager context="moderator" />);
    expect(screen.queryByRole("checkbox", { name: /positions update voucher/i })).toBeNull();
  });
});
