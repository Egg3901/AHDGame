import { describe, it, expect } from "vitest";
import {
  initialWikiManagementState,
  wikiManagementReducer,
  type WikiManagementState,
} from "./useWikiManagementState";

const SNAPSHOT = {
  slug: "alpha",
  title: "Alpha",
  description: "desc",
  content: "body",
  featured: true,
};

describe("wikiManagementReducer", () => {
  it("initial state has loading=true and empty form", () => {
    expect(initialWikiManagementState.loading).toBe(true);
    expect(initialWikiManagementState.pages).toEqual([]);
    expect(initialWikiManagementState.editingSlug).toBeNull();
    expect(initialWikiManagementState.creating).toBe(false);
    expect(initialWikiManagementState.formSlug).toBe("");
    expect(initialWikiManagementState.reseedMode).toBe("");
  });

  it("SET_PAGES replaces the pages list", () => {
    const next = wikiManagementReducer(initialWikiManagementState, {
      type: "SET_PAGES",
      pages: [{ _id: "1", slug: "a", title: "A", description: "d", content: "c", featured: false }],
    });
    expect(next.pages).toHaveLength(1);
    expect(next.pages[0].slug).toBe("a");
  });

  it("START_CREATE clears the form and flips creating=true", () => {
    const dirty: WikiManagementState = {
      ...initialWikiManagementState,
      formTitle: "stale",
      editingSlug: "old",
      creating: false,
    };
    const next = wikiManagementReducer(dirty, { type: "START_CREATE" });
    expect(next.creating).toBe(true);
    expect(next.editingSlug).toBeNull();
    expect(next.formTitle).toBe("");
  });

  it("START_EDIT loads the snapshot and sets editingSlug", () => {
    const next = wikiManagementReducer(initialWikiManagementState, {
      type: "START_EDIT",
      snapshot: SNAPSHOT,
    });
    expect(next.editingSlug).toBe("alpha");
    expect(next.creating).toBe(false);
    expect(next.formTitle).toBe("Alpha");
    expect(next.formFeatured).toBe(true);
  });

  it("RESET_FORM clears form fields and exits creating/editing modes", () => {
    const editing = wikiManagementReducer(initialWikiManagementState, {
      type: "START_EDIT",
      snapshot: SNAPSHOT,
    });
    const next = wikiManagementReducer(editing, { type: "RESET_FORM" });
    expect(next.editingSlug).toBeNull();
    expect(next.creating).toBe(false);
    expect(next.formSlug).toBe("");
    expect(next.formContent).toBe("");
  });

  it("SET_FORM_* actions update only the targeted field", () => {
    const a = wikiManagementReducer(initialWikiManagementState, {
      type: "SET_FORM_TITLE",
      value: "Hello",
    });
    expect(a.formTitle).toBe("Hello");
    expect(a.formSlug).toBe("");
    const b = wikiManagementReducer(a, { type: "SET_FORM_FEATURED", value: true });
    expect(b.formFeatured).toBe(true);
    expect(b.formTitle).toBe("Hello");
  });

  it("busy/message setters are independent", () => {
    let s: WikiManagementState = initialWikiManagementState;
    s = wikiManagementReducer(s, { type: "SET_SAVING", value: true });
    s = wikiManagementReducer(s, { type: "SET_RESEED_MODE", value: "force" });
    s = wikiManagementReducer(s, { type: "SET_SYNC_MESSAGE", value: "synced 3" });
    expect(s.saving).toBe(true);
    expect(s.reseedMode).toBe("force");
    expect(s.syncMessage).toBe("synced 3");
    expect(s.backfilling).toBe(false);
  });
});
