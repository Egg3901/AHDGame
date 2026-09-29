import { describe, expect, it } from "vitest";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import {
  overlayRuntimeWorldEntities,
  validateAppliedEntityStates,
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
} from "./runtimeEntities";

function application(): FederationSettlementApplicationRecord {
  return {
    _id: "1991-default:soviet-revision-1:1",
    presetId: "1991-default",
    settlementId: "soviet-revision-1",
    revision: 1,
    sourceEntityId: "RU",
    entityIds: ["RU", "EE"],
    status: "applied",
    appliedOnTurn: 44,
    appliedAt: new Date("1991-12-01T00:00:00Z"),
  };
}

function appliedEstonia(): RuntimeWorldEntityState {
  return {
    _id: "1991-default:EE",
    presetId: "1991-default",
    entityId: "EE",
    applicationId: "1991-default:soviet-revision-1:1",
    appliedOnTurn: 44,
    entry: {
      ...getWorldEntityOrThrow("1991-default", "EE"),
      status: "sovereign",
      parentEntityId: undefined,
      recognition: { status: "widely-recognized" },
      un: { state: "eligible" },
    },
  };
}

describe("runtime world entity overlay", () => {
  it("shows applied sovereignty on the map without mutating the opening manifest", () => {
    const state = appliedEstonia();
    const entries = overlayRuntimeWorldEntities(
      "1991-default",
      [state],
      new Set([state.applicationId])
    );
    expect(entries.find((entry) => entry.entityId === "EE")?.status).toBe("sovereign");
    expect(getWorldEntityMapSnapshot("1991-default", entries).byFeatureId["233"]).toMatchObject({
      entityId: "EE",
      status: "sovereign",
    });
    expect(getWorldEntityOrThrow("1991-default", "EE").status).toBe("emergent");
  });

  it("rejects an applied receipt missing a source or successor record", () => {
    const successor = appliedEstonia();
    const source: RuntimeWorldEntityState = {
      ...successor,
      _id: "1991-default:RU",
      entityId: "RU",
      entry: {
        ...getWorldEntityOrThrow("1991-default", "RU"),
        displayName: "Russia",
      },
    };
    const receipt = application();
    expect(validateAppliedEntityStates("1991-default", [receipt], [source, successor])).toEqual(
      new Set([receipt._id])
    );
    expect(() => validateAppliedEntityStates("1991-default", [receipt], [successor])).toThrow(
      "missing entity states"
    );
    expect(() =>
      validateAppliedEntityStates("1991-default", [receipt], [source, successor, successor])
    ).toThrow("mismatched entity states");
    expect(() =>
      validateAppliedEntityStates(
        "1991-default",
        [receipt],
        [source, { ...successor, appliedOnTurn: 45 }]
      )
    ).toThrow("mismatched entity states");
  });

  it("does not accept a second applied revision over the same federation", () => {
    const first = application();
    const second = {
      ...first,
      _id: "1991-default:soviet-revision-2:2",
      settlementId: "soviet-revision-2",
      revision: 2,
      entityIds: ["RU", "LV"],
    };
    expect(() => validateAppliedEntityStates("1991-default", [first, second], [])).toThrow(
      "Invalid applied federation settlement receipt"
    );
  });

  it("rejects a stale preset, duplicate state or unknown target", () => {
    const state = appliedEstonia();
    const applied = new Set([state.applicationId]);
    expect(() => overlayRuntimeWorldEntities("1999-default", [state], applied)).toThrow(
      "Invalid runtime"
    );
    expect(() => overlayRuntimeWorldEntities("1991-default", [state, state], applied)).toThrow(
      "Invalid runtime"
    );
    expect(() =>
      overlayRuntimeWorldEntities(
        "1991-default",
        [
          {
            ...state,
            _id: "1991-default:XX",
            entityId: "XX",
            entry: { ...state.entry, entityId: "XX" },
          },
        ],
        applied
      )
    ).toThrow("Invalid runtime");
    expect(() => overlayRuntimeWorldEntities("1991-default", [state], new Set())).toThrow(
      "Invalid runtime"
    );
  });
});
