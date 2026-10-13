import { it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { GroupMembership } from "@/lib/corporations/groups/groupMembership";
vi.mock("@/lib/corporations/groups/groupMembership", () => ({
  resolveFormalizedGroups: vi.fn(async () => ({
    rootByCorpId: new Map(),
    membersByRootId: new Map(),
    eligibleManagementRoots: new Set(),
  })),
}));
import { resolveFormalizedGroups } from "@/lib/corporations/groups/groupMembership";
import { loadGroupDirectionMembership } from "./groupDirectionMembership";
const db = {} as Db;
const npp = { ceoType: "npp", groupDirection: { objective: "profit" } } as Corporation;
it("resolves existing NPP direction authority without a Group supply flag", async () => {
  vi.clearAllMocks();
  await loadGroupDirectionMembership(db, true, [npp]);
  expect(resolveFormalizedGroups).toHaveBeenCalledExactlyOnceWith(db, { includeReserved: true });
});
it("does no group reads for disabled subsidiaries, an empty cohort, no directions, player autopilot or caretakers", async () => {
  vi.clearAllMocks();
  for (const [enabled, corps] of [
    [false, [npp]],
    [true, []],
    [true, [{ ceoType: "npp" }]],
    [true, [{ ...npp, ceoType: "character", autopilot: { enabledTurn: 1 } }]],
    [true, [{ ...npp, caretakerCeo: {} }]],
  ] as [boolean, Corporation[]][]) {
    expect(await loadGroupDirectionMembership(db, enabled, corps)).toBeUndefined();
  }
  expect(resolveFormalizedGroups).not.toHaveBeenCalled();
});
it("reuses one preloaded ownership snapshot for any number of NPP directions", async () => {
  vi.clearAllMocks();
  const preloaded = { rootByCorpId: new Map(), membersByRootId: new Map() } as GroupMembership;
  expect(await loadGroupDirectionMembership(db, true, Array(100).fill(npp), preloaded)).toBe(
    preloaded
  );
  expect(resolveFormalizedGroups).not.toHaveBeenCalled();
});
