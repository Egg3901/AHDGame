/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CountryHistory } from "./CountryHistory";

function payloadWith(eventType: string, title: string) {
  return {
    countryId: "SCO",
    countryName: "Scotland",
    headOfGovernmentTitle: "First Minister",
    currentLeader: null,
    leaderHistory: [],
    recentEvents: [{ id: "1", eventType, title, turn: 412, date: "2031-05-02T00:00:00.000Z" }],
  };
}

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response)
  );
}

describe("CountryHistory event badges", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels a region_seceded event as Independence (not the generic Event)", async () => {
    stubFetch(payloadWith("region_seceded", "SCO becomes an independent country"));
    render(<CountryHistory data="SCO" />);
    await waitFor(() =>
      expect(screen.getByText("SCO becomes an independent country")).toBeTruthy()
    );
    expect(screen.getByText("Independence")).toBeTruthy();
    expect(screen.queryByText("Event")).toBeNull();
  });

  it("labels a region_transferred event as Border", async () => {
    stubFetch(payloadWith("region_transferred", "NIR joins IE"));
    render(<CountryHistory data="SCO" />);
    await waitFor(() => expect(screen.getByText("NIR joins IE")).toBeTruthy());
    expect(screen.getByText("Border")).toBeTruthy();
  });
});
