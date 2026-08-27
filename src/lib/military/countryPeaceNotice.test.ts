import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

const { requirePeaceNegotiator } = vi.hoisted(() => ({
  requirePeaceNegotiator: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as never),
}));
vi.mock("@/lib/api/requirePeaceNegotiator", () => ({ requirePeaceNegotiator }));

import { loadCountryPeaceNotice } from "./countryPeaceNotice";

const ACTOR = new ObjectId();

function mockDb(opts: { conflicts?: unknown[]; offers?: unknown[] }) {
  const db = {
    collection: (name: string) => ({
      find: () => ({
        toArray: async () =>
          name === "peaceOffers" ? (opts.offers ?? []) : (opts.conflicts ?? []),
      }),
    }),
  } as unknown as Db;
  return db;
}

const activeWar = { _id: "w1", name: "The Anatolian War", conflictId: 14, status: "active" };
const wonWar = {
  _id: "w2",
  name: "The War for Germany",
  conflictId: 9,
  status: "terms_pending",
  termsWindow: { victor: "B", imposer: "UK", target: "TR", closesTurn: 118 },
};
const liveOffer = { status: "pending", expiresTurn: 200, toCountry: "UK" };

beforeEach(() => {
  requirePeaceNegotiator.mockClear();
  requirePeaceNegotiator.mockResolvedValue({ ok: true, via: "head_of_government" } as never);
});

describe("loadCountryPeaceNotice: the seat gate", () => {
  it("returns null for a logged-out reader, and never checks a seat", async () => {
    const db = mockDb({ conflicts: [activeWar] });
    expect(await loadCountryPeaceNotice(db, "UK", null, 100)).toBeNull();
    expect(requirePeaceNegotiator).not.toHaveBeenCalled();
  });

  it("returns null for a reader who holds no negotiator seat", async () => {
    // The asymmetry with the wartime strip: a war is a fact about the country, an
    // offer is a decision in front of one person.
    requirePeaceNegotiator.mockResolvedValue({ ok: false, response: null } as never);
    const db = mockDb({ conflicts: [activeWar] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toBeNull();
  });

  it("does NOT take the routes' admin bypass", async () => {
    // The routes let an admin act anywhere, and that is right. This strip is a call
    // to action addressed to whoever's job it is, and an admin browsing the world is
    // not the government of every country they open. Passing the bypass here showed
    // a staff account "the United States can open peace talks" on US pages while
    // they held no seat there at all.
    const db = mockDb({ conflicts: [activeWar] });
    await loadCountryPeaceNotice(db, "UK", ACTOR, 100);
    expect(requirePeaceNegotiator).toHaveBeenCalledWith(expect.anything(), "UK", ACTOR, false);
  });

  it("still shows for an admin who genuinely holds the seat", async () => {
    // They pass the real check on their own merits, not via the bypass.
    requirePeaceNegotiator.mockResolvedValue({ ok: true, via: "head_of_government" } as never);
    const db = mockDb({ conflicts: [activeWar] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toBeTruthy();
  });
});

describe("loadCountryPeaceNotice: which state wins", () => {
  it("returns null in peacetime", async () => {
    const db = mockDb({ conflicts: [] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toBeNull();
  });

  it("reports a won war, counting the window down in turns", async () => {
    const db = mockDb({ conflicts: [wonWar] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toEqual({
      kind: "window_open",
      warName: "The War for Germany",
      conflictNumber: 9,
      turnsLeft: 18,
    });
  });

  it("never counts down past zero", async () => {
    // A window the sweeper has not yet reached must not render a negative countdown.
    const db = mockDb({ conflicts: [wonWar] });
    const notice = await loadCountryPeaceNotice(db, "UK", ACTOR, 999);
    expect(notice).toMatchObject({ kind: "window_open", turnsLeft: 0 });
  });

  it("puts a won war ahead of a pending offer, because only one is on a clock", async () => {
    const db = mockDb({ conflicts: [wonWar, activeWar], offers: [liveOffer] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toMatchObject({
      kind: "window_open",
    });
  });

  it("ignores a window where THIS country is not the imposer", async () => {
    // A coalition victory yields one term, and the ally does not get the panel.
    const theirs = { ...wonWar, termsWindow: { ...wonWar.termsWindow, imposer: "US" } };
    const db = mockDb({ conflicts: [theirs] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toBeNull();
  });

  it("reports an incoming offer when no war has been won", async () => {
    const db = mockDb({ conflicts: [activeWar], offers: [liveOffer] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toEqual({
      kind: "offer_incoming",
      count: 1,
      href: "/country/uk/executive?tab=foreign",
    });
  });

  it("counts several incoming offers", async () => {
    const db = mockDb({ conflicts: [activeWar], offers: [liveOffer, liveOffer] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toMatchObject({ count: 2 });
  });

  it("ignores an offer that has lapsed, whatever its stored status says", async () => {
    // The lazy-expiry rule: a row can say "pending" and be long dead.
    const stale = { status: "pending", expiresTurn: 50, toCountry: "UK" };
    const db = mockDb({ conflicts: [activeWar], offers: [stale] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toEqual({
      kind: "can_offer",
      href: "/country/uk/executive?tab=foreign",
    });
  });

  it("invites talks when at war with nothing pending", async () => {
    const db = mockDb({ conflicts: [activeWar], offers: [] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toEqual({
      kind: "can_offer",
      href: "/country/uk/executive?tab=foreign",
    });
  });

  it("does not invite talks when the only war has already been decided", async () => {
    // Someone else won it. There is nothing left to negotiate.
    const theirs = { ...wonWar, termsWindow: { ...wonWar.termsWindow, imposer: "US" } };
    const db = mockDb({ conflicts: [theirs], offers: [] });
    expect(await loadCountryPeaceNotice(db, "UK", ACTOR, 100)).toBeNull();
  });
});

describe("loadCountryPeaceNotice: where the reader is sent", () => {
  it("sends the head of government to their own Foreign Affairs tab", async () => {
    // The executive shell's tab is gated to the sitting leader and admins, so it is
    // the only one of the two surfaces they can actually use.
    requirePeaceNegotiator.mockResolvedValue({ ok: true, via: "head_of_government" } as never);
    const db = mockDb({ conflicts: [activeWar], offers: [] });
    const notice = await loadCountryPeaceNotice(db, "UK", ACTOR, 100);
    expect(notice).toMatchObject({ href: "/country/uk/executive?tab=foreign" });
  });

  it("sends the foreign minister to their own cabinet office", async () => {
    // They cannot see the executive shell's tab at all, and the same panel is
    // already mounted on their office overview.
    requirePeaceNegotiator.mockResolvedValue({ ok: true, via: "foreign_minister" } as never);
    const db = mockDb({ conflicts: [activeWar], offers: [] });
    const notice = await loadCountryPeaceNotice(db, "UK", ACTOR, 100);
    const href = (notice as { href: string }).href;
    expect(href).toContain("/executive/cabinet/");
    expect(href.endsWith("/office")).toBe(true);
  });
});
