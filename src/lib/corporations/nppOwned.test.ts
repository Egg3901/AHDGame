import { describe, it, expect } from "vitest";
import { isNppOwned } from "./nppOwned";

describe("isNppOwned", () => {
  it("counts an autonomous NPP corp as NPP", () => {
    expect(isNppOwned({ ceoType: "npp" })).toBe(true);
  });

  it("counts a character-run corp as player-owned", () => {
    expect(isNppOwned({ ceoType: "character" })).toBe(false);
  });

  it("counts an imperial-run corp as player-owned", () => {
    expect(isNppOwned({ ceoType: "imperial" })).toBe(false);
  });

  it("treats a missing ceoType as player-owned", () => {
    // The field defaults to "character" and predates NPP corps entirely, so every
    // legacy corp lacks it. Reading absent as NPP would sweep the whole back
    // catalogue of player companies into the background arc.
    expect(isNppOwned({})).toBe(false);
    expect(isNppOwned({ ceoType: null })).toBe(false);
  });

  it("keeps a caretaker-run corp with the players, not the NPP field", () => {
    // NPP-autonomy V2.1: the brain drives it via ceoType "npp", but userId stays
    // the appointing owner, so it is a player's corp being minded. Folding it
    // into the NPP arc would tell its owner their own company had vanished into
    // the background.
    expect(isNppOwned({ ceoType: "npp", caretakerCeo: { ceoId: "x" } })).toBe(false);
  });

  it("is false for a missing corp rather than guessing NPP", () => {
    // An unresolved rival is shown as a real competitor. Guessing the other way
    // would silently hide someone from the market panel.
    expect(isNppOwned(null)).toBe(false);
    expect(isNppOwned(undefined)).toBe(false);
  });
});
