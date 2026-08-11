import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { canActAsChair, getActingChairId, isViceChairActing } from "./actingChair";

const chair = new ObjectId();
const viceChair = new ObjectId();
const other = new ObjectId();

describe("getActingChairId", () => {
  it("returns chairId when chair is filled (VC ignored)", () => {
    const id = getActingChairId({ chairId: chair, viceChairId: viceChair });
    expect(id?.equals(chair)).toBe(true);
  });

  it("returns chairId when chair is filled and VC vacant", () => {
    const id = getActingChairId({ chairId: chair, viceChairId: null });
    expect(id?.equals(chair)).toBe(true);
  });

  it("returns viceChairId when chair is vacant and VC filled", () => {
    const id = getActingChairId({ chairId: null, viceChairId: viceChair });
    expect(id?.equals(viceChair)).toBe(true);
  });

  it("returns null when both slots are vacant", () => {
    expect(getActingChairId({ chairId: null, viceChairId: null })).toBeNull();
  });
});

describe("canActAsChair", () => {
  it("returns true for the seated chair", () => {
    expect(canActAsChair({ chairId: chair, viceChairId: viceChair }, chair)).toBe(true);
  });

  it("returns false for the VC when chair is seated", () => {
    expect(canActAsChair({ chairId: chair, viceChairId: viceChair }, viceChair)).toBe(false);
  });

  it("returns true for the VC when chair is vacant", () => {
    expect(canActAsChair({ chairId: null, viceChairId: viceChair }, viceChair)).toBe(true);
  });

  it("returns false for an unrelated character", () => {
    expect(canActAsChair({ chairId: chair, viceChairId: viceChair }, other)).toBe(false);
  });

  it("returns false when both slots are vacant", () => {
    expect(canActAsChair({ chairId: null, viceChairId: null }, chair)).toBe(false);
  });
});

describe("isViceChairActing", () => {
  it("returns true only when chair is null AND VC is filled", () => {
    expect(isViceChairActing({ chairId: null, viceChairId: viceChair })).toBe(true);
  });

  it("returns false when chair is filled (VC is not acting)", () => {
    expect(isViceChairActing({ chairId: chair, viceChairId: viceChair })).toBe(false);
  });

  it("returns false when both slots are vacant", () => {
    expect(isViceChairActing({ chairId: null, viceChairId: null })).toBe(false);
  });

  it("returns false when chair filled and VC vacant", () => {
    expect(isViceChairActing({ chairId: chair, viceChairId: null })).toBe(false);
  });
});
