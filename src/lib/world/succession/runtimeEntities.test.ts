import { describe, expect, it } from "vitest";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { getWorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import { overlayRuntimeWorldEntities, type RuntimeWorldEntityState } from "./runtimeEntities";

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
