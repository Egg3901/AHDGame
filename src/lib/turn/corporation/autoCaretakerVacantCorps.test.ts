import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { isEligibleForAutoCaretaker } from "./autoCaretakerVacantCorps";
import { buildVacantCaretakerCeoUpdate } from "@/lib/corporations/caretakerCeo";

type EligibilityInput = Parameters<typeof isEligibleForAutoCaretaker>[0];
const base: EligibilityInput = {
  ceoVacant: true,
  ceoId: null as unknown as ObjectId,
  ceoType: "character",
  caretakerCeo: undefined,
  countryOwnerId: undefined,
  isNationalized: undefined,
  suspended: undefined,
};

describe("isEligibleForAutoCaretaker", () => {
  it("is eligible when a player corp is flagged vacant", () => {
    expect(isEligibleForAutoCaretaker({ ...base, ceoVacant: true })).toBe(true);
  });

  it("is eligible when the CEO id is null even if the flag is absent", () => {
    expect(
      isEligibleForAutoCaretaker({
        ...base,
        ceoVacant: undefined,
        ceoId: null as unknown as ObjectId,
      })
    ).toBe(true);
  });

  it("is NOT eligible for a seated human CEO", () => {
    expect(isEligibleForAutoCaretaker({ ...base, ceoVacant: false, ceoId: new ObjectId() })).toBe(
      false
    );
  });

  it("is NOT eligible when already NPP-run", () => {
    expect(isEligibleForAutoCaretaker({ ...base, ceoType: "npp" })).toBe(false);
  });

  it("is NOT eligible when already caretaken", () => {
    expect(
      isEligibleForAutoCaretaker({
        ...base,
        caretakerCeo: { underlyingUserId: new ObjectId(), appointedTurn: 1 },
      })
    ).toBe(false);
  });

  it("is NOT eligible for state-owned / nationalized / suspended shells", () => {
    expect(isEligibleForAutoCaretaker({ ...base, countryOwnerId: "US" })).toBe(false);
    expect(isEligibleForAutoCaretaker({ ...base, isNationalized: true })).toBe(false);
    expect(isEligibleForAutoCaretaker({ ...base, suspended: true })).toBe(false);
  });
});

describe("buildVacantCaretakerCeoUpdate", () => {
  const npp = new ObjectId();
  const now = new Date("2026-01-01T00:00:00Z");

  it("seats the NPP, clears vacancy, and zeroes salary", () => {
    const { set, unset } = buildVacantCaretakerCeoUpdate(
      {
        ceoId: null as unknown as Corporation["ceoId"],
        userId: null as unknown as Corporation["userId"],
      },
      npp,
      5,
      now
    );
    expect(set).toMatchObject({ ceoId: npp, ceoType: "npp", ceoVacant: false, ceoSalary: 0 });
    expect(unset).toHaveProperty("ceoVacantSinceTurn");
  });

  it("resignation (owner + character survive): stashes both for reclaim", () => {
    const char = new ObjectId();
    const user = new ObjectId();
    const { set } = buildVacantCaretakerCeoUpdate({ ceoId: char, userId: user }, npp, 5, now);
    expect(set.caretakerCeo).toEqual({
      underlyingCharacterId: char,
      underlyingUserId: user,
      appointedTurn: 5,
      appointmentSource: "vacancy",
    });
  });

  it("retirement (owner survives, no character): stashes owner only, no ghost character", () => {
    const user = new ObjectId();
    const { set } = buildVacantCaretakerCeoUpdate(
      { ceoId: null as unknown as Corporation["ceoId"], userId: user },
      npp,
      5,
      now
    );
    expect(set.caretakerCeo).toEqual({
      underlyingUserId: user,
      appointedTurn: 5,
      appointmentSource: "vacancy",
    });
    expect(set.caretakerCeo).not.toHaveProperty("underlyingCharacterId");
  });

  it("relocation/residency (ownership cleared): pure NPP corp, no caretaker stash", () => {
    const { set } = buildVacantCaretakerCeoUpdate(
      {
        ceoId: null as unknown as Corporation["ceoId"],
        userId: null as unknown as Corporation["userId"],
      },
      npp,
      5,
      now
    );
    expect(set).not.toHaveProperty("caretakerCeo");
  });
});
