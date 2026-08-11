import { describe, it, expect } from "vitest";
import { initialNavbarState, navbarReducer, type NavbarState } from "./useNavbarState";

describe("navbarReducer", () => {
  it("initial state has every flag false and previews empty", () => {
    expect(initialNavbarState.mobileMenuOpen).toBe(false);
    expect(initialNavbarState.profileOpen).toBe(false);
    expect(initialNavbarState.stateOpen).toBe(false);
    expect(initialNavbarState.searchOpen).toBe(false);
    expect(initialNavbarState.notifOpen).toBe(false);
    expect(initialNavbarState.switchingCharacter).toBe(false);
    expect(initialNavbarState.switchingImperial).toBe(false);
    expect(initialNavbarState.notifPreviews).toEqual([]);
  });

  it("SET_MOBILE_MENU sets mobileMenuOpen", () => {
    const next = navbarReducer(initialNavbarState, { type: "SET_MOBILE_MENU", open: true });
    expect(next.mobileMenuOpen).toBe(true);
    const closed = navbarReducer(next, { type: "SET_MOBILE_MENU", open: false });
    expect(closed.mobileMenuOpen).toBe(false);
  });

  it("TOGGLE_DROPDOWN flips the named dropdown without touching others", () => {
    const after = navbarReducer(initialNavbarState, { type: "TOGGLE_DROPDOWN", key: "profile" });
    expect(after.profileOpen).toBe(true);
    expect(after.stateOpen).toBe(false);
    expect(after.nationOpen).toBe(false);

    const back = navbarReducer(after, { type: "TOGGLE_DROPDOWN", key: "profile" });
    expect(back.profileOpen).toBe(false);
  });

  it("CLOSE_DROPDOWN closes only the named dropdown", () => {
    const open: NavbarState = { ...initialNavbarState, profileOpen: true, stateOpen: true };
    const after = navbarReducer(open, { type: "CLOSE_DROPDOWN", key: "profile" });
    expect(after.profileOpen).toBe(false);
    expect(after.stateOpen).toBe(true); // unchanged
  });

  it("CLOSE_ALL_DROPDOWNS closes every dropdown but leaves popovers and notifPreviews alone", () => {
    const open: NavbarState = {
      ...initialNavbarState,
      stateOpen: true,
      nationOpen: true,
      worldOpen: true,
      accountOpen: true,
      helpOpen: true,
      profileOpen: true,
      searchOpen: true,
      notifOpen: true,
      notifPreviews: [
        {
          _id: "n1",
          title: "t",
          message: "m",
          read: false,
          createdAt: new Date().toISOString(),
          type: "system",
        },
      ],
    };
    const after = navbarReducer(open, { type: "CLOSE_ALL_DROPDOWNS" });
    expect(after.stateOpen).toBe(false);
    expect(after.nationOpen).toBe(false);
    expect(after.worldOpen).toBe(false);
    expect(after.accountOpen).toBe(false);
    expect(after.helpOpen).toBe(false);
    expect(after.profileOpen).toBe(false);
    // Popovers + previews untouched
    expect(after.searchOpen).toBe(true);
    expect(after.notifOpen).toBe(true);
    expect(after.notifPreviews).toHaveLength(1);
  });

  it("SET_SWITCHING toggles the right field for each key", () => {
    const character = navbarReducer(initialNavbarState, {
      type: "SET_SWITCHING",
      key: "character",
      value: true,
    });
    expect(character.switchingCharacter).toBe(true);
    expect(character.switchingImperial).toBe(false);

    const imperial = navbarReducer(character, {
      type: "SET_SWITCHING",
      key: "imperial",
      value: true,
    });
    expect(imperial.switchingCharacter).toBe(true);
    expect(imperial.switchingImperial).toBe(true);
  });

  it("SET_POPOVER toggles search/notif independently", () => {
    const search = navbarReducer(initialNavbarState, {
      type: "SET_POPOVER",
      key: "search",
      open: true,
    });
    expect(search.searchOpen).toBe(true);
    expect(search.notifOpen).toBe(false);

    const notif = navbarReducer(search, { type: "SET_POPOVER", key: "notif", open: true });
    expect(notif.searchOpen).toBe(true); // independent
    expect(notif.notifOpen).toBe(true);
  });

  it("MARK_PREVIEW_READ flips read=true on the matching preview only", () => {
    const items = [
      {
        _id: "1",
        title: "x",
        message: "y",
        read: false,
        createdAt: new Date().toISOString(),
        type: "system",
      },
      {
        _id: "2",
        title: "a",
        message: "b",
        read: false,
        createdAt: new Date().toISOString(),
        type: "system",
      },
    ];
    const seeded = navbarReducer(initialNavbarState, { type: "SET_NOTIF_PREVIEWS", items });
    const after = navbarReducer(seeded, { type: "MARK_PREVIEW_READ", id: "1" });
    expect(after.notifPreviews[0].read).toBe(true);
    expect(after.notifPreviews[1].read).toBe(false);
  });

  it("REMOVE_PREVIEW filters out the matching preview", () => {
    const items = [
      {
        _id: "1",
        title: "x",
        message: "y",
        read: false,
        createdAt: new Date().toISOString(),
        type: "system",
      },
      {
        _id: "2",
        title: "a",
        message: "b",
        read: false,
        createdAt: new Date().toISOString(),
        type: "system",
      },
    ];
    const seeded = navbarReducer(initialNavbarState, { type: "SET_NOTIF_PREVIEWS", items });
    const after = navbarReducer(seeded, { type: "REMOVE_PREVIEW", id: "1" });
    expect(after.notifPreviews).toHaveLength(1);
    expect(after.notifPreviews[0]._id).toBe("2");
  });

  it("SET_NOTIF_PREVIEWS replaces the previews array", () => {
    const items = [
      {
        _id: "1",
        title: "x",
        message: "y",
        read: false,
        createdAt: new Date().toISOString(),
        type: "system",
      },
      {
        _id: "2",
        title: "a",
        message: "b",
        read: true,
        createdAt: new Date().toISOString(),
        type: "system",
      },
    ];
    const after = navbarReducer(initialNavbarState, { type: "SET_NOTIF_PREVIEWS", items });
    expect(after.notifPreviews).toEqual(items);
  });
});
