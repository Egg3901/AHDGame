import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

import { logWireEvent } from "@/lib/wireEvent";
import {
  emitOpsLevelWire,
  emitRallyWire,
  emitPrimaryTierWire,
  investedInLever,
} from "./raceWireEmit";

const CAMPAIGN_ID = new ObjectId();
const ELECTION_ID = new ObjectId();
const CANDIDATE_ID = new ObjectId();

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    _id: CAMPAIGN_ID,
    electionId: ELECTION_ID,
    candidateId: CANDIDATE_ID,
    groundGameTree: { starter: true, a: 3, b: 3, c: 2 },
    ...overrides,
  } as Parameters<typeof emitOpsLevelWire>[1];
}

/** A db whose character lookup resolves to a name. */
function dbWithName(name: string | null): Db {
  return {
    collection: (n: string) => ({
      findOne: vi.fn().mockResolvedValue(n === "characters" && name ? { name } : null),
    }),
  } as unknown as Db;
}

beforeEach(() => vi.clearAllMocks());

describe("investedInLever", () => {
  it("counts the starter plus the three branches", () => {
    expect(investedInLever(campaign(), "groundGame")).toBe(9);
  });

  it("counts a locked lever's branches without the starter point", () => {
    expect(
      investedInLever(
        campaign({ groundGameTree: { starter: false, a: 1, b: 0, c: 0 } }),
        "groundGame"
      )
    ).toBe(1);
  });

  it("reads an absent tree as zero rather than throwing", () => {
    expect(investedInLever(campaign({ groundGameTree: undefined }), "groundGame")).toBe(0);
  });
});

describe("emitOpsLevelWire", () => {
  it("emits a scoped headline naming the candidate, lever and level", async () => {
    await emitOpsLevelWire(dbWithName("Vance"), campaign(), "groundGame");

    expect(logWireEvent).toHaveBeenCalledTimes(1);
    const [type, headline, opts] = vi.mocked(logWireEvent).mock.calls[0];
    expect(type).toBe("campaign_ops_level");
    expect(headline).toContain("VANCE");
    expect(headline.toUpperCase()).toContain("GROUND GAME");
    expect(headline).toContain("9");
    expect(opts).toMatchObject({
      electionId: ELECTION_ID.toString(),
      campaignId: CAMPAIGN_ID.toString(),
    });
  });

  it("falls back to the non-player politician collection for an NPP candidate", async () => {
    const db = {
      collection: (n: string) => ({
        findOne: vi.fn().mockResolvedValue(n === "npps" ? { name: "Delgado" } : null),
      }),
    } as unknown as Db;

    await emitOpsLevelWire(db, campaign(), "groundGame");
    expect(vi.mocked(logWireEvent).mock.calls[0][1]).toContain("DELGADO");
  });

  it("emits nothing when the candidate cannot be named", async () => {
    await emitOpsLevelWire(dbWithName(null), campaign(), "groundGame");
    expect(logWireEvent).not.toHaveBeenCalled();
  });

  it("never throws when the lookup fails, so the purchase is not rolled back", async () => {
    const db = {
      collection: () => ({
        findOne: vi.fn().mockRejectedValue(new Error("mongo is down")),
      }),
    } as unknown as Db;

    await expect(emitOpsLevelWire(db, campaign(), "groundGame")).resolves.toBeUndefined();
    expect(logWireEvent).not.toHaveBeenCalled();
  });

  it("never throws when the wire write itself fails", async () => {
    vi.mocked(logWireEvent).mockRejectedValueOnce(new Error("wire is down"));
    await expect(
      emitOpsLevelWire(dbWithName("Vance"), campaign(), "groundGame")
    ).resolves.toBeUndefined();
  });
});

describe("emitRallyWire", () => {
  it("emits the support gained", async () => {
    await emitRallyWire(dbWithName("Vance"), campaign(), 7.2);
    const [type, headline] = vi.mocked(logWireEvent).mock.calls[0];
    expect(type).toBe("campaign_rally");
    expect(headline).toContain("7.2");
  });

  it("stays silent on a rally that banked nothing", async () => {
    await emitRallyWire(dbWithName("Vance"), campaign(), 0);
    expect(logWireEvent).not.toHaveBeenCalled();
  });

  it("never throws when the wire write fails", async () => {
    vi.mocked(logWireEvent).mockRejectedValueOnce(new Error("wire is down"));
    await expect(emitRallyWire(dbWithName("Vance"), campaign(), 7.2)).resolves.toBeUndefined();
  });
});

describe("emitPrimaryTierWire", () => {
  it("emits the tier and delegate count scoped to the race", async () => {
    await emitPrimaryTierWire(ELECTION_ID, 2, 1240);
    const [type, headline, opts] = vi.mocked(logWireEvent).mock.calls[0];
    expect(type).toBe("primary_tier_locked");
    expect(headline).toContain("1,240");
    expect(opts).toMatchObject({ electionId: ELECTION_ID.toString() });
  });

  it("stays silent when a tier awarded no delegates", async () => {
    await emitPrimaryTierWire(ELECTION_ID, 2, 0);
    expect(logWireEvent).not.toHaveBeenCalled();
  });
});

describe("state calls", () => {
  it("are not emitted as engine events", async () => {
    // `liveResults/computeResults.ts` defines a called unit as a display
    // projection, so the general-election ticker derives its call headlines at
    // render time rather than persisting them. This test documents that the
    // emitter deliberately does not exist.
    const mod = await import("./raceWireEmit");
    expect("emitStateCalledWire" in mod).toBe(false);
  });
});
