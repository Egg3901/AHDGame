import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { requireCommandingGeneral } from "./requireCommandingGeneral";

function command(over: Record<string, unknown> = {}) {
  return {
    id: "cmd1",
    name: "US Defense",
    type: "REGIONAL",
    commanderIds: ["g1", "g2"],
    commandingGeneralId: "g1",
    regionIds: [],
    spec: "Joint Operations",
    posture: "Deterrence",
    supply: "High",
    readiness: "Alert",
    cap: 20,
    base: 80,
    political: "Low",
    branchFocus: "Army",
    unitIds: [],
    role: "role",
    ...over,
  };
}

describe("requireCommandingGeneral", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [command()],
    });
  });

  const run = (characterId: string | null) =>
    requireCommandingGeneral(db as unknown as Db, "US", characterId);

  it("authorizes the commanding general and resolves their command", async () => {
    const r = await run("g1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.id).toBe("cmd1");
  });

  it("403s a subordinate general of that command", async () => {
    // Being in the command is not leading it — only the CG posts generals.
    const r = await run("g2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("403s a character with no command", async () => {
    const r = await run("stranger");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("403s an unauthenticated caller with no character", async () => {
    const r = await run(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("403s when the country has no commands at all", async () => {
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue(null);
    const r = await run("g1");
    expect(r.ok).toBe(false);
  });

  it("403s a general who leads a command in another country", async () => {
    // The lookup is country-scoped: leading GB's command grants nothing over US.
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue(null);
    const r = await requireCommandingGeneral(db as unknown as Db, "US", "g1");
    expect(r.ok).toBe(false);
    expect(db.collectionMocks.militaryCommands.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US" })
    );
  });

  it("resolves the right command when the general leads one of several", async () => {
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [
        command({ id: "cmd1", commandingGeneralId: "other", commanderIds: ["other"] }),
        command({ id: "cmd2", commandingGeneralId: "g1", commanderIds: ["g1"] }),
      ],
    });
    const r = await run("g1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.id).toBe("cmd2");
  });
});
