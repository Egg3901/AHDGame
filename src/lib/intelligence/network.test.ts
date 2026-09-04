import { describe, expect, it } from "vitest";
import type { IntelligenceNetwork } from "@/lib/db/types/intelligence";
import {
  NETWORK_BURN_COOLDOWN_TURNS,
  NETWORK_FUNDING_PROGRESS,
  NETWORK_LEVEL_PROGRESS,
  NETWORK_MAX_LEVEL,
  SUSPICION_DECAY_IDLE,
  SUSPICION_PER_OP,
} from "./config";
import { applyOperationToNetwork, isNetworkUsable, stepNetwork } from "./network";

function net(over: Partial<IntelligenceNetwork> = {}): IntelligenceNetwork {
  return {
    ownerCountryId: "US",
    targetCountryId: "RU",
    level: 1,
    progress: 0,
    funding: "steady",
    suspicion: 40,
    status: "active",
    cooledUntilTurn: null,
    lastOpTurn: 0,
    updatedAt: new Date(0),
    ...over,
  } as IntelligenceNetwork;
}

describe("stepNetwork", () => {
  it("adds funded progress", () => {
    expect(stepNetwork(net({ progress: 0 }), 10).progress).toBe(NETWORK_FUNDING_PROGRESS.steady);
  });

  it("adds nothing on no funding", () => {
    expect(stepNetwork(net({ progress: 7, funding: "none" }), 10).progress).toBe(7);
  });

  it("converts full progress into a level", () => {
    const stepped = stepNetwork(net({ level: 1, progress: NETWORK_LEVEL_PROGRESS - 1 }), 10);
    expect(stepped.level).toBe(2);
    expect(stepped.progress).toBeLessThan(NETWORK_LEVEL_PROGRESS);
  });

  it("never climbs past the level cap", () => {
    const stepped = stepNetwork(
      net({ level: NETWORK_MAX_LEVEL, progress: NETWORK_LEVEL_PROGRESS - 1, funding: "crash" }),
      10
    );
    expect(stepped.level).toBe(NETWORK_MAX_LEVEL);
    expect(stepped.progress).toBeLessThan(NETWORK_LEVEL_PROGRESS);
  });

  it("sheds suspicion on a turn with no operation", () => {
    expect(stepNetwork(net({ suspicion: 40, lastOpTurn: 0 }), 10).suspicion).toBe(
      40 - SUSPICION_DECAY_IDLE
    );
  });

  it("sheds no suspicion on a turn that ran an operation", () => {
    expect(stepNetwork(net({ suspicion: 40, lastOpTurn: 10 }), 10).suspicion).toBe(40);
  });

  it("never drives suspicion below zero", () => {
    expect(stepNetwork(net({ suspicion: 1, lastOpTurn: 0 }), 10).suspicion).toBe(0);
  });

  it("reactivates a burned network once its cooldown passes", () => {
    const cooled = stepNetwork(net({ status: "burned", cooledUntilTurn: 10 }), 11);
    expect(cooled.status).toBe("active");
    expect(cooled.cooledUntilTurn).toBeNull();
  });

  it("leaves a burned network burned inside its cooldown", () => {
    const still = stepNetwork(net({ status: "burned", cooledUntilTurn: 20 }), 11);
    expect(still.status).toBe("burned");
    expect(still.cooledUntilTurn).toBe(20);
  });
});

describe("applyOperationToNetwork", () => {
  it("adds suspicion on a clean operation and keeps the level", () => {
    const after = applyOperationToNetwork(net({ level: 3, suspicion: 10 }), "clean", 10);
    expect(after.suspicion).toBe(10 + SUSPICION_PER_OP);
    expect(after.level).toBe(3);
    expect(after.status).toBe("active");
  });

  it("stamps the operating turn so suspicion does not decay the same turn", () => {
    expect(applyOperationToNetwork(net(), "clean", 42).lastOpTurn).toBe(42);
  });

  it("drops a level when blown", () => {
    expect(applyOperationToNetwork(net({ level: 3 }), "blown", 10).level).toBe(2);
  });

  it("does not burn the network when merely blown", () => {
    expect(applyOperationToNetwork(net({ level: 3 }), "blown", 10).status).toBe("active");
  });

  it("burns and cools the network when detected", () => {
    const after = applyOperationToNetwork(net({ level: 3 }), "detected", 10);
    expect(after.level).toBe(2);
    expect(after.status).toBe("burned");
    expect(after.cooledUntilTurn).toBe(10 + NETWORK_BURN_COOLDOWN_TURNS);
  });

  it("costs at least as much when attributed as when detected", () => {
    // The ladder is monotonic on attacker cost: every rung carries the one below.
    const detected = applyOperationToNetwork(net({ level: 3 }), "detected", 10);
    const attributed = applyOperationToNetwork(net({ level: 3 }), "attributed", 10);
    expect(attributed.level).toBeLessThanOrEqual(detected.level);
    expect(attributed.status).toBe("burned");
    expect(attributed.cooledUntilTurn).toBe(detected.cooledUntilTurn);
  });

  it("never drops below level zero", () => {
    expect(applyOperationToNetwork(net({ level: 0 }), "attributed", 10).level).toBe(0);
  });

  it("never drives suspicion above the maximum", () => {
    expect(applyOperationToNetwork(net({ suspicion: 100 }), "clean", 10).suspicion).toBe(100);
  });
});

describe("isNetworkUsable", () => {
  it("rejects a burned network inside its cooldown", () => {
    expect(isNetworkUsable(net({ status: "burned", cooledUntilTurn: 20 }), 15)).toBe(false);
  });

  it("rejects a burned network on the exact cooldown turn", () => {
    expect(isNetworkUsable(net({ status: "burned", cooledUntilTurn: 20 }), 20)).toBe(false);
  });

  it("accepts a burned network the turn after its cooldown", () => {
    expect(isNetworkUsable(net({ status: "burned", cooledUntilTurn: 20 }), 21)).toBe(true);
  });

  it("accepts an active network", () => {
    expect(isNetworkUsable(net({ status: "active" }), 15)).toBe(true);
  });

  it("accepts a burned network carrying no cooldown, rather than stranding it", () => {
    // A legacy or hand-edited row with no cooldown must not be permanently dead.
    expect(isNetworkUsable(net({ status: "burned", cooledUntilTurn: null }), 15)).toBe(true);
  });
});
