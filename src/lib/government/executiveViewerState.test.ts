import { describe, expect, it } from "vitest";
import { mapSnapElectionViewerState } from "./executiveViewerState";

describe("mapSnapElectionViewerState", () => {
  it("maps viewerIsSittingPM from isPrimeMinister, not snapElectionsAllowed (issue #2810)", () => {
    // Sitting PM in a country whose config disables snap elections:
    // server sends isPrimeMinister=true, snapElectionsAllowed=false.
    const state = mapSnapElectionViewerState({
      isPrimeMinister: true,
      snapElectionsAllowed: false,
    });
    expect(state.viewerIsSittingPM).toBe(true);
    expect(state.snapElectionsAllowed).toBe(false);
  });

  it("does not report a non-PM as sitting PM even when snapElectionsAllowed is present", () => {
    // Regression guard for the original mis-mapping: snapElectionsAllowed must
    // never be read as a viewer-identity flag.
    const state = mapSnapElectionViewerState({
      isPrimeMinister: false,
      snapElectionsAllowed: true, // impossible today (server ANDs isPrimeMinister), but must stay safe
    });
    expect(state.viewerIsSittingPM).toBe(false);
    expect(state.snapElectionsAllowed).toBe(true);
  });

  it("passes through snap counters and permission for the sitting PM", () => {
    const state = mapSnapElectionViewerState({
      isPrimeMinister: true,
      snapElectionsAllowed: true,
      snapElectionsUsed: 1,
      snapElectionsRemaining: 2,
      snapCooldownTurnsRemaining: 5,
    });
    expect(state).toEqual({
      viewerIsSittingPM: true,
      snapElectionsAllowed: true,
      snapElectionsUsed: 1,
      snapElectionsRemaining: 2,
      snapCooldownTurnsRemaining: 5,
    });
  });

  it("defaults everything safe on missing fields or missing payload", () => {
    const empty = {
      viewerIsSittingPM: false,
      snapElectionsAllowed: false,
      snapElectionsUsed: 0,
      snapElectionsRemaining: 0,
      snapCooldownTurnsRemaining: 0,
    };
    expect(mapSnapElectionViewerState({})).toEqual(empty);
    expect(mapSnapElectionViewerState(null)).toEqual(empty);
    expect(mapSnapElectionViewerState(undefined)).toEqual(empty);
  });
});
