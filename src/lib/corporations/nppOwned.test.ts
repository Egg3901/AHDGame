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

  it("keeps a corp with an AUTOMATIC vacancy caretaker with the players too", () => {
    // #814 added `appointmentSource`, splitting an owner-chosen caretaker from one
    // the turn loop installs on a vacant corp. Neither changes the answer, and the
    // reason is load-bearing: `autoCaretakerVacantCorps` only writes `caretakerCeo`
    // at all `if (prevUserId != null)`, so its presence still means exactly "a real
    // player is behind this corp". If that guard is ever dropped, ownerless corps
    // would start arriving with a caretaker block and this test should fail.
    expect(
      isNppOwned({
        ceoType: "npp",
        caretakerCeo: { underlyingUserId: "u1", appointedTurn: 5, appointmentSource: "vacancy" },
      })
    ).toBe(false);
    expect(
      isNppOwned({
        ceoType: "npp",
        caretakerCeo: { underlyingUserId: "u1", appointedTurn: 5, appointmentSource: "owner" },
      })
    ).toBe(false);
  });

  it("counts a vacant corp with no owner behind it as NPP field", () => {
    // The other side of that guard: no underlying user means no caretaker block is
    // written, so the corp is a plain autonomous NPP and belongs in the arc.
    expect(isNppOwned({ ceoType: "npp", caretakerCeo: undefined })).toBe(true);
  });

  it("is false for a missing corp rather than guessing NPP", () => {
    // An unresolved rival is shown as a real competitor. Guessing the other way
    // would silently hide someone from the market panel.
    expect(isNppOwned(null)).toBe(false);
    expect(isNppOwned(undefined)).toBe(false);
  });
});
