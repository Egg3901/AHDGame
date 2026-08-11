import { describe, it, expect } from "vitest";
import { inboxReducer, initialInboxState } from "./inboxReducer";

describe("inboxReducer", () => {
  it("switching segment clears selection", () => {
    const s = inboxReducer({ ...initialInboxState, selId: "x" }, { type: "SET_SEG", seg: "mail" });
    expect(s.seg).toBe("mail");
    expect(s.selId).toBeNull();
  });
  it("MARK_READ adds to readIds; ARCHIVE adds to archivedIds and clears selection", () => {
    let s = inboxReducer(initialInboxState, { type: "MARK_READ", id: "n1" });
    expect(s.readIds.has("n1")).toBe(true);
    s = inboxReducer({ ...s, selId: "n1" }, { type: "ARCHIVE", id: "n1" });
    expect(s.archivedIds.has("n1")).toBe(true);
    expect(s.selId).toBeNull();
  });
});
