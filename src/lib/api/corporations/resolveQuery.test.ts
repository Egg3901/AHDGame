import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { corporationPathIdFromDoc, resolveCorporation } from "./resolveQuery";

describe("corporationPathIdFromDoc", () => {
  it("uses sequential id when defined, including zero", () => {
    const id = new ObjectId();
    expect(corporationPathIdFromDoc({ _id: id, sequentialId: 0 })).toBe("0");
    expect(corporationPathIdFromDoc({ _id: id, sequentialId: 42 })).toBe("42");
  });

  it("falls back to _id hex when sequentialId is absent", () => {
    const id = new ObjectId();
    expect(corporationPathIdFromDoc({ _id: id })).toBe(id.toString());
  });
});

describe("resolveCorporation projections", () => {
  it.each([
    [undefined, { editorialStance: 0 }],
    [{ bankPropForexFee: 0 }, { editorialStance: 0, bankPropForexFee: 0 }],
    [
      { userId: 1, ceoVacant: 1 },
      { userId: 1, ceoVacant: 1 },
    ],
  ] as const)(
    "preserves field exclusions without mixing projection modes",
    async (input, expected) => {
      const id = new ObjectId();
      const findOne = vi.fn().mockResolvedValue({ _id: id, countryId: "US" });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      expect(await resolveCorporation(db as never, id.toHexString(), input)).toMatchObject({
        ok: true,
      });
      expect(findOne).toHaveBeenCalledExactlyOnceWith({ _id: id }, { projection: expected });
    }
  );
});

describe("corporation error references", () => {
  it.each(["new", "42"])("returns a shared code and reference for %s", async (id) => {
    const db = {
      collection: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }),
    };
    const result = await resolveCorporation(db as never, id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an error response");
    const body = await result.response.json();
    expect(body.code).toBe(id === "new" ? "BAD_REQUEST" : "NOT_FOUND");
    expect(body.ref).toEqual(expect.any(String));
    expect(body.ref.length).toBeGreaterThan(0);
  });
});
