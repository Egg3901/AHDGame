// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { CorpsMember } from "@/lib/db/collections/characterGenerals";
import { GeneralCorps } from "./GeneralCorps";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const corps: CorpsMember[] = [
  { characterId: "g1", name: "Gen. Alpha", state: "serving", spec: "armor", level: 3, xp: 300 },
  {
    characterId: "g2",
    name: "Maj. Bravo",
    state: "serving",
    spec: "No specialisation",
    level: 1,
    xp: 42,
  },
  { characterId: "g3", name: "Gen. Charlie", state: "dismissed", spec: "naval", level: 4, xp: 500 },
];
const candidates = [{ characterId: "c9", name: "Dana Reed" }];

const base = { corps, candidates, countryCode: "us", positionId: "secretary_of_defense" };

describe("GeneralCorps", () => {
  it("shows each member's standing, including the former", () => {
    render(<GeneralCorps {...base} />);
    expect(screen.getAllByText("Serving")).toHaveLength(2);
    expect(screen.getByText("Former")).toBeTruthy();
  });

  it("commissions a selected character", async () => {
    render(<GeneralCorps {...base} />);
    fireEvent.change(screen.getByRole("combobox", { name: /commission a character/i }), {
      target: { value: "c9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commission" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/country/us/executive/cabinet/secretary_of_defense/generals");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ characterId: "c9" });
  });

  it("dismisses a serving general", async () => {
    render(<GeneralCorps {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss gen\. alpha/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/country/us/executive/cabinet/secretary_of_defense/generals/g1");
    expect(init.method).toBe("DELETE");
  });

  // Dismissal keeps the record, so a former general is re-appointed, not re-created.
  it("re-appoints a former general through the commission route", async () => {
    render(<GeneralCorps {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /re-appoint gen\. charlie/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/country/us/executive/cabinet/secretary_of_defense/generals");
    expect(JSON.parse(init.body)).toEqual({ characterId: "g3" });
  });

  it("offers no dismiss control for a former general", () => {
    render(<GeneralCorps {...base} />);
    expect(screen.queryByRole("button", { name: /dismiss gen\. charlie/i })).toBeNull();
  });

  it("surfaces a rejected action instead of pretending it worked", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Already commissioned" }),
    });
    render(<GeneralCorps {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss gen\. alpha/i }));
    await waitFor(() => expect(screen.getByText(/already commissioned/i)).toBeTruthy());
  });

  it("is read-only without a defense seat", () => {
    render(<GeneralCorps {...base} positionId="" />);
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Commission" })).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("shows an empty state with no corps", () => {
    render(<GeneralCorps {...base} corps={[]} />);
    expect(screen.getByText(/no generals commissioned/i)).toBeTruthy();
  });

  it("disables the picker when nobody is eligible", () => {
    render(<GeneralCorps {...base} candidates={[]} />);
    expect(screen.getByText(/no eligible characters/i)).toBeTruthy();
  });

  // The row used to read "Unassigned · Lvl 1" beside a "Serving" badge, which a player
  // reasonably read as a posting — they asked what it meant while their general was
  // posted to a theater. It is a SPECIALISATION, and the level said nothing about how
  // promotion works, which was the other half of the same confusion.
  describe("standing line", () => {
    it("names the rank rather than a bare level number", () => {
      render(<GeneralCorps {...base} />);
      expect(screen.getByText(/Lt\. General/)).toBeTruthy();
      expect(screen.getByText(/Brigadier/)).toBeTruthy();
      expect(screen.queryByText(/Lvl 1/)).toBeNull();
    });

    it("says how much experience the next rank needs", () => {
      render(<GeneralCorps {...base} />);
      expect(screen.getByText(/42\/100 XP to Major General/)).toBeTruthy();
    });

    it("says Field Marshal is the ceiling instead of inventing a next rank", () => {
      render(
        <GeneralCorps
          {...base}
          corps={[{ characterId: "g5", name: "Gen. Echo", state: "serving", level: 5, xp: 900 }]}
        />
      );
      expect(screen.getByText(/highest rank/i)).toBeTruthy();
    });

    it("links the name to the general's profile, where doctrine is trained", () => {
      render(<GeneralCorps {...base} />);
      const link = screen.getByRole("link", { name: "Gen. Alpha" });
      expect(link.getAttribute("href")).toBe("/character/g1");
    });
  });
});
