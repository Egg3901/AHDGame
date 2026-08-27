// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PeaceBanner } from "./PeaceBanner";
import type { CountryPeaceNotice } from "@/lib/military/countryPeaceNotice";

function show(notice: CountryPeaceNotice) {
  return render(<PeaceBanner notice={notice} countryName="the United States" countryCode="US" />);
}

afterEach(() => cleanup());

const ALL: CountryPeaceNotice[] = [
  { kind: "window_open", warName: "The War for Germany", conflictNumber: 14, turnsLeft: 18 },
  { kind: "offer_incoming", count: 1 },
  { kind: "offer_incoming", count: 3 },
  { kind: "can_offer" },
];

describe("PeaceBanner: a won war", () => {
  const notice: CountryPeaceNotice = {
    kind: "window_open",
    warName: "The War for Germany",
    conflictNumber: 14,
    turnsLeft: 18,
  };

  it("says the war was won and terms may be imposed", () => {
    show(notice);
    expect(screen.getByText(/has won The War for Germany and may impose terms/)).toBeTruthy();
  });

  it("counts the window down in turns, not hours or days", () => {
    show(notice);
    expect(screen.getByText(/closes in 18 turns/)).toBeTruthy();
  });

  it("says turn, singular, on the last turn", () => {
    show({ ...notice, turnsLeft: 1 });
    expect(screen.getByText(/closes in 1 turn\./)).toBeTruthy();
  });

  it("links to the war record, where terms are chosen", () => {
    show(notice);
    const link = screen.getByRole("link", { name: /Name your terms/ });
    expect(link.getAttribute("href")).toBe("/world/conflicts/14");
  });

  it("falls back to the conflicts board when the war has no public number", () => {
    // A dead link would be worse than a general one.
    show({ ...notice, conflictNumber: null });
    expect(screen.getByRole("link", { name: /Name your terms/ }).getAttribute("href")).toBe(
      "/world/conflicts"
    );
  });
});

describe("PeaceBanner: an incoming offer", () => {
  it("asks the recipient to review it", () => {
    show({ kind: "offer_incoming", count: 1 });
    expect(screen.getByText(/Peace terms have been offered to the United States/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review the terms/ })).toBeTruthy();
  });

  it("counts several offers rather than naming one", () => {
    show({ kind: "offer_incoming", count: 3 });
    expect(screen.getByText(/3 peace offers are waiting/)).toBeTruthy();
  });

  it("links to the executive surface that answers offers", () => {
    show({ kind: "offer_incoming", count: 1 });
    expect(screen.getByRole("link", { name: /Review the terms/ }).getAttribute("href")).toBe(
      "/country/us/executive"
    );
  });
});

describe("PeaceBanner: an ordinary war", () => {
  it("offers to open talks", () => {
    show({ kind: "can_offer" });
    expect(screen.getByText(/can open peace talks in this war/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Offer terms/ })).toBeTruthy();
  });
});

describe("PeaceBanner: copy rules", () => {
  it("uses no em dash or en dash in any state", () => {
    for (const notice of ALL) {
      const { container, unmount } = show(notice);
      expect(container.textContent ?? "").not.toMatch(/[—–]/);
      unmount();
    }
  });

  it("names no calendar year in any state", () => {
    for (const notice of ALL) {
      const { container, unmount } = show(notice);
      expect(container.textContent ?? "").not.toMatch(/\b(19|20)\d\d\b/);
      unmount();
    }
  });

  it("always gives the reader somewhere to act", () => {
    for (const notice of ALL) {
      const { container, unmount } = show(notice);
      expect(container.querySelector("a")).toBeTruthy();
      unmount();
    }
  });
});
