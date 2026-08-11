import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { validateDeclareWar } from "../validateDeclareWar";
import { WAR_DECLARATION_COOLDOWN_TURNS } from "../warGoals";

const enabledSpy = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/countryAccess", () => ({
  isCountryEnabledForPlayers: (...a: unknown[]) => enabledSpy(...a),
}));

const truceSpy = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/military/truce", () => ({
  activeTruceExpiry: (...a: unknown[]) => truceSpy(...a),
}));

/**
 * A db whose conflicts lookup returns `live` and whose bills lookup returns `bills`.
 *
 * `live` takes one conflict or several. The real query filters to conflicts holding
 * BOTH countries; the stub hands back whatever it is given so a test can assert the
 * predicate, not the Mongo filter.
 */
function stubDb(live: unknown = null, bills: unknown[] = []): Db {
  const conflicts = live == null ? [] : Array.isArray(live) ? live : [live];
  return {
    collection: (name: string) =>
      name === "bills"
        ? {
            find: () => ({
              sort: () => ({ limit: () => ({ toArray: async () => bills }) }),
            }),
          }
        : { find: () => ({ toArray: async () => conflicts }) },
  } as unknown as Db;
}

const good = { targetCountry: "CN", warGoal: "punitive" };

beforeEach(() => {
  // clearAllMocks resets calls but NOT implementations, so both of these must be
  // re-armed or a test that arms a truce would leak into the next one.
  enabledSpy.mockResolvedValue(true);
  truceSpy.mockResolvedValue(null);
});

describe("validateDeclareWar", () => {
  it("accepts a valid declaration", async () => {
    expect(await validateDeclareWar(stubDb(), good, "US")).toEqual({ ok: true });
  });

  it("refuses declaring war on yourself", async () => {
    const r = await validateDeclareWar(stubDb(), { ...good, targetCountry: "US" }, "US");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/itself/i);
  });

  it("refuses an unknown country", async () => {
    const r = await validateDeclareWar(stubDb(), { ...good, targetCountry: "ZZ" }, "US");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/does not exist/i);
  });

  it("refuses a missing target or goal", async () => {
    expect((await validateDeclareWar(stubDb(), {}, "US")).ok).toBe(false);
    expect((await validateDeclareWar(stubDb(), { targetCountry: "CN" }, "US")).ok).toBe(false);
  });

  it("refuses the reserved conquest goal", async () => {
    // The server half of the reservation. The picker disabling it is cosmetic.
    const r = await validateDeclareWar(stubDb(), { ...good, warGoal: "conquest" }, "US");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/not yet available/i);
  });

  it("refuses an unknown goal", async () => {
    const r = await validateDeclareWar(stubDb(), { ...good, warGoal: "annexation" }, "US");
    expect(r.ok).toBe(false);
  });

  it("refuses when you are already fighting that country", async () => {
    const live = {
      sideA: { countries: ["US"], kind: "state" },
      sideB: { countries: ["CN"], kind: "state" },
    };
    const r = await validateDeclareWar(stubDb(live), good, "US");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/already at war/i);
  });

  it("ACCEPTS a declaration against a country others are already fighting", async () => {
    // The boundary against join-or-create: a live conflict the declarer is not part
    // of must be allowed, because that is the join case. Rejecting on the mere
    // existence of a conflict would make joining unreachable.
    const live = {
      sideA: { countries: ["UK"], kind: "state" },
      sideB: { countries: ["CN"], kind: "state" },
    };
    expect(await validateDeclareWar(stubDb(live), good, "US")).toEqual({ ok: true });
  });

  it("accepts when the only conflict there is on the SAME side as the declarer", async () => {
    // Both already on side A means neither roster opposes the other, so there is no
    // war between them — the declaration is not a no-op.
    const live = {
      sideA: { countries: ["US", "CN"], kind: "coalition" },
      sideB: { countries: ["RU"], kind: "state" },
    };
    expect(await validateDeclareWar(stubDb(live), good, "US")).toEqual({ ok: true });
  });
});

describe("one war at a time between the same two countries", () => {
  it("refuses a RECIPROCAL declaration hosted by the declarer's own country", async () => {
    // US declared on CN, so the war is hosted at CN. CN answering with its own
    // declaration would be hosted at US — a different host. A lookup scoped to
    // hostCountry would find nothing and let the same pair fight two wars.
    const live = {
      hostCountry: "CN",
      sideA: { countries: ["US"], kind: "state" },
      sideB: { countries: ["CN"], kind: "state" },
    };
    const r = await validateDeclareWar(stubDb(live), { ...good, targetCountry: "US" }, "CN");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/already at war/i);
  });

  it("refuses when the pair is already opposed in a war hosted by a THIRD country", async () => {
    // Both drawn into RU's war on opposite sides. Neither is the host.
    const live = {
      hostCountry: "RU",
      sideA: { countries: ["RU", "CN"], kind: "coalition" },
      sideB: { countries: ["US", "UK"], kind: "coalition" },
    };
    const r = await validateDeclareWar(stubDb(live), good, "US");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/already at war/i);
  });

  it("finds the opposing war even when another live war lists both on one side", async () => {
    // The predicate must run over EVERY match, not just the first row returned.
    const together = {
      hostCountry: "RU",
      sideA: { countries: ["US", "CN"], kind: "coalition" },
      sideB: { countries: ["RU"], kind: "state" },
    };
    const opposed = {
      hostCountry: "CN",
      sideA: { countries: ["US"], kind: "state" },
      sideB: { countries: ["CN"], kind: "state" },
    };
    const r = await validateDeclareWar(stubDb([together, opposed]), good, "US");
    expect(r.ok).toBe(false);
  });

  it("does NOT treat a bloc backer as being at war", async () => {
    // sideOf resolves an unrostered country by matching its bloc against the sides'
    // backers. Reusing it here would call two bloc rivals opposed in every war their
    // patrons back, and block declarations that were never made.
    const live = {
      hostCountry: "RU",
      sideA: { countries: ["RU"], kind: "state", backer: "east" },
      sideB: { countries: ["UK"], kind: "state", backer: "west" },
    };
    expect(await validateDeclareWar(stubDb(live), good, "US")).toEqual({ ok: true });
  });
});

describe("target must be open to players", () => {
  it("refuses a country an admin has not enabled", async () => {
    // COUNTRY_CONFIGS also holds sub-national entities (SCO, WAL) and countries
    // not yet switched on; a war there would have no other side to play.
    enabledSpy.mockResolvedValue(false);
    const r = await validateDeclareWar(stubDb(), good, "US");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/not open to players/i);
  });

  it("reads the flag for the TARGET, not the declarer", async () => {
    await validateDeclareWar(stubDb(), good, "US");
    expect(enabledSpy).toHaveBeenCalledWith(expect.anything(), "CN");
  });
});

describe("cooldown between declarations", () => {
  const N = WAR_DECLARATION_COOLDOWN_TURNS;

  it("refuses a second declaration inside the cooldown", async () => {
    const r = await validateDeclareWar(
      stubDb(null, [{ proposedTurn: 100 }]),
      good,
      "US",
      100 + N - 1
    );
    expect(r.ok).toBe(false);
    expect((r as { status: number }).status).toBe(429);
    expect((r as { error: string }).error).toMatch(/1 more turn must pass/);
  });

  it("allows one exactly on the cooldown boundary", async () => {
    expect(
      await validateDeclareWar(stubDb(null, [{ proposedTurn: 100 }]), good, "US", 100 + N)
    ).toEqual({ ok: true });
  });

  it("counts from the last PROPOSAL, even one the chambers rejected", async () => {
    // The bills lookup is not filtered by status on purpose: a rejected
    // declaration still spent the country's capital.
    const r = await validateDeclareWar(
      stubDb(null, [{ proposedTurn: 100, status: "failed" }]),
      good,
      "US",
      101
    );
    expect(r.ok).toBe(false);
  });

  it("allows the first declaration a country ever files", async () => {
    expect(await validateDeclareWar(stubDb(null, []), good, "US", 40)).toEqual({ ok: true });
  });

  it("ignores the cooldown when no turn is supplied", async () => {
    // The legislator path refuses declarations outright and has no turn context.
    expect(await validateDeclareWar(stubDb(null, [{ proposedTurn: 100 }]), good, "US")).toEqual({
      ok: true,
    });
  });

  it("tolerates an older bill with no proposedTurn", async () => {
    expect(await validateDeclareWar(stubDb(null, [{}]), good, "US", 40)).toEqual({ ok: true });
  });
});

describe("truce between the pair", () => {
  it("refuses a declaration against a country you have a truce with", async () => {
    truceSpy.mockResolvedValue(300);
    const r = await validateDeclareWar(stubDb(), good, "US", 100);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/truce/i);
  });

  it("names the turn the truce lapses, so it is not discovered by being refused", async () => {
    truceSpy.mockResolvedValue(300);
    const r = await validateDeclareWar(stubDb(), good, "US", 100);
    expect((r as { error: string }).error).toMatch(/300/);
  });

  it("permits a declaration once the truce has lapsed", async () => {
    truceSpy.mockResolvedValue(null);
    expect(await validateDeclareWar(stubDb(), good, "US", 100)).toEqual({ ok: true });
  });

  it("blocks in BOTH directions", async () => {
    // The truce is mutual and its key is sorted, so direction cannot matter.
    truceSpy.mockResolvedValue(300);
    const r = await validateDeclareWar(
      stubDb(),
      { targetCountry: "US", warGoal: "punitive" },
      "CN",
      100
    );
    expect(r.ok).toBe(false);
  });

  it("checks the truce for the PAIR, not just the declarer", async () => {
    await validateDeclareWar(stubDb(), good, "US", 100);
    expect(truceSpy).toHaveBeenCalledWith(expect.anything(), "US", "CN", 100);
  });

  it("skips the truce check when no turn is supplied", async () => {
    // The legislator path refuses declarations outright and has no turn context.
    truceSpy.mockResolvedValue(300);
    expect(await validateDeclareWar(stubDb(), good, "US")).toEqual({ ok: true });
  });
});
