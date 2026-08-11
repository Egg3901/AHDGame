import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { corporationPathIdFromDoc } from "./resolveQuery";

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
