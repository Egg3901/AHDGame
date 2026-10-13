import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/parliament/oppositionLeader", () => ({
  resolveOppositionLeaderForCountry: vi.fn(async (_db: unknown, countryId: string) =>
    countryId === "UK"
      ? {
          chairId: { toString: () => "leader" },
          partyDoc: {
            shadowCabinet: {
              foreign: { characterId: { toString: () => "shadow" } },
            },
          },
        }
      : null
  ),
}));

import {
  CEO_NI_TENURE_TURNS,
  loadCeoCandidates,
  loadOppositionRoles,
  loadPresidingOfficerRoles,
  resolveCeoNiTier,
} from "./actionRefreshRoles";

const id = (value: string) => ({ toString: () => value });

function dbWith(rows: Record<string, unknown[]>): Db {
  return {
    collection: (name: string) => ({
      find: () => ({ toArray: async () => rows[name] ?? [] }),
    }),
  } as unknown as Db;
}

describe("loadCeoCandidates", () => {
  const corp = (
    n: number,
    ceo: string | null,
    cap: number,
    extra: Record<string, unknown> = {}
  ) => ({
    _id: id(`corp${n}`),
    countryId: "US",
    ceoId: ceo ? id(ceo) : null,
    ceoType: "character",
    sharePrice: cap,
    totalShares: 1,
    ...extra,
  });

  it("ranks by market cap within a country: top 10 major, rest of the top half standard", async () => {
    const corps = Array.from({ length: 30 }, (_, i) => corp(i, `ceo${i}`, 1000 - i));
    const candidates = await loadCeoCandidates(dbWith({ corporations: corps }));
    expect(candidates.get("ceo0")?.tier).toBe("major");
    expect(candidates.get("ceo9")?.tier).toBe("major");
    expect(candidates.get("ceo10")?.tier).toBe("standard");
    expect(candidates.get("ceo14")?.tier).toBe("standard");
    // Bottom half: shells and minnows earn nothing.
    expect(candidates.has("ceo15")).toBe(false);
  });

  it("skips NPP-run corporations and keeps a CEO's best tier", async () => {
    const corps = [
      corp(0, "npp", 1000, { ceoType: "npp" }),
      ...Array.from({ length: 25 }, (_, i) =>
        corp(i + 1, i === 0 || i === 20 ? "multi" : `c${i}`, 900 - i)
      ),
    ];
    const candidates = await loadCeoCandidates(dbWith({ corporations: corps }));
    expect(candidates.has("npp")).toBe(false);
    expect(candidates.get("multi")).toEqual({ corporationId: "corp1", tier: "major" });
  });
});

describe("resolveCeoNiTier", () => {
  const candidate = { corporationId: "corp1", tier: "major" as const };

  it("stamps tenure on first sight and grants nothing yet", () => {
    expect(resolveCeoNiTier(candidate, undefined, 100)).toEqual({
      tier: null,
      tenure: { corporationId: "corp1", sinceTurn: 100 },
    });
  });

  it("grants the tier once the tenure is served", () => {
    const tenure = { corporationId: "corp1", sinceTurn: 100 };
    expect(resolveCeoNiTier(candidate, tenure, 100 + CEO_NI_TENURE_TURNS - 1).tier).toBeNull();
    expect(resolveCeoNiTier(candidate, tenure, 100 + CEO_NI_TENURE_TURNS).tier).toBe("major");
  });

  it("clears tenure when the character no longer runs a qualifying corporation", () => {
    expect(resolveCeoNiTier(undefined, { corporationId: "corp1", sinceTurn: 1 }, 50)).toEqual({
      tier: null,
      tenure: null,
    });
  });
});

describe("loadOppositionRoles", () => {
  it("collects the Leader of the Opposition and their shadow cabinet", async () => {
    const roles = await loadOppositionRoles(
      dbWith({
        governmentFormations: [{ _id: "UK", countryId: "UK" }],
        parliamentaryGovernments: [{ _id: "DE" }],
      })
    );
    expect([...roles.leaderIds]).toEqual(["leader"]);
    expect([...roles.shadowCabinetIds]).toEqual(["shadow"]);
  });
});

describe("loadPresidingOfficerRoles", () => {
  it("maps Nigerian presiding offices onto leadership roles", async () => {
    const rows = await loadPresidingOfficerRoles(
      dbWith({
        electedOfficials: [
          { characterId: id("a"), officeType: "speaker" },
          { characterId: id("b"), officeType: "senatePresident" },
        ],
      })
    );
    expect(rows.map((r) => r.role)).toEqual(["speaker_ng_reps", "president_ng_senate"]);
  });
});
