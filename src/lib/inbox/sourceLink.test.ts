import { describe, it, expect } from "vitest";
import { resolveSourceLink } from "./sourceLink";

describe("resolveSourceLink", () => {
  // ── From the brief ──────────────────────────────────────────────────────
  it("links a bill notification to the bill page", () => {
    const s = resolveSourceLink("bill_vote_open", { billId: "abc123" });
    expect(s?.href).toBe("/congress/bills/abc123");
    expect(s?.label).toMatch(/bill|vote/i);
  });

  it("links a state bill notification (has stateId) to the region legislature", () => {
    const s = resolveSourceLink("system", {
      billId: "abc123",
      stateId: "CA",
      countryId: "US",
    });
    expect(s?.href).toBe("/country/us/region/ca/legislature/bills/abc123");
    expect(s?.label).toBe("View bill");
  });

  it("falls back to US country for legacy state bill notifications without countryId", () => {
    const s = resolveSourceLink("system", { billId: "abc123", stateId: "TX" });
    expect(s?.href).toBe("/country/us/region/tx/legislature/bills/abc123");
  });

  it("links an election notification", () => {
    expect(resolveSourceLink("general_win", { electionId: "e1" })?.href).toBe("/elections/e1");
  });

  it("returns null when no resolvable metadata", () => {
    expect(resolveSourceLink("turn_advance", {})).toBeNull();
    expect(resolveSourceLink("turn_advance", undefined)).toBeNull();
  });

  // ── Election ────────────────────────────────────────────────────────────
  it("election link has correct label", () => {
    const s = resolveSourceLink("primary_win", { electionId: "e2" });
    expect(s?.href).toBe("/elections/e2");
    expect(s?.label).toBe("View election");
  });

  // ── Bill via whip ────────────────────────────────────────────────────────
  it("links party_whip_issued with targetType=bill to bill page", () => {
    const s = resolveSourceLink("party_whip_issued", {
      targetType: "bill",
      targetId: "bill99",
    });
    expect(s?.href).toBe("/congress/bills/bill99");
    expect(s?.label).toBe("View bill");
  });

  it("does NOT use targetId for non-bill whip", () => {
    const s = resolveSourceLink("party_whip_issued", {
      targetType: "vote",
      targetId: "v1",
    });
    expect(s).toBeNull();
  });

  // ── Coalition ────────────────────────────────────────────────────────────
  it("links coalition notification", () => {
    const s = resolveSourceLink("coalition_invite_received", {
      coalitionSequentialId: 7,
      countryId: "US",
    });
    expect(s?.href).toBe("/country/us/parties/coalition/7");
    expect(s?.label).toBe("View coalition");
  });

  it("returns null for coalition without countryId", () => {
    expect(resolveSourceLink("coalition_invite_received", { coalitionSequentialId: 7 })).toBeNull();
  });

  // ── Charter ──────────────────────────────────────────────────────────────
  it("charter_invited label is 'Open charter to sign'", () => {
    const s = resolveSourceLink("charter_invited", { charterId: "ch1" });
    expect(s?.href).toBe("/charters/ch1");
    expect(s?.label).toBe("Open charter to sign");
  });

  it("charter_replacement_needed label mentions replace", () => {
    const s = resolveSourceLink("charter_replacement_needed", {
      charterId: "ch2",
    });
    expect(s?.href).toBe("/charters/ch2");
    expect(s?.label).toBe("Open charter to replace founder");
  });

  it("charter_ratified links to charter when charterId present", () => {
    const s = resolveSourceLink("charter_ratified", {
      charterId: "ch3",
      countryId: "US",
      partyId: "p1",
    });
    expect(s?.href).toBe("/charters/ch3");
    expect(s?.label).toBe("View charter");
  });

  it("charter_ratified falls back to party page when no charterId", () => {
    const s = resolveSourceLink("charter_ratified", {
      countryId: "GB",
      partyId: "p2",
    });
    expect(s?.href).toBe("/country/gb/parties/p2");
    expect(s?.label).toBe("Open party");
  });

  // ── Central bank ─────────────────────────────────────────────────────────
  it("central bank chair pending with unknown intorgId keeps the legacy intorg URL", () => {
    const s = resolveSourceLink("system", {
      type: "central_bank_chair_pending",
      intorgId: "ECB",
    });
    expect(s?.href).toBe("/intorg/ecb/central-bank");
    expect(s?.label).toBe("Accept or decline");
  });

  it("central bank chair pending routes intorg EU to the currency page", () => {
    const s = resolveSourceLink("system", {
      type: "central_bank_chair_pending",
      intorgId: "EU",
    });
    expect(s?.href).toBe("/centralbank/eur");
    expect(s?.label).toBe("Accept or decline");
  });

  it("central bank chair pending falls back to countryId", () => {
    const s = resolveSourceLink("system", {
      type: "central_bank_chair_pending",
      countryId: "JP",
    });
    expect(s?.href).toBe("/centralbank/jpy");
    expect(s?.label).toBe("Accept or decline");
  });

  it("no central bank link when metadata.type is different", () => {
    // countryId present but not the right metadata.type
    const s = resolveSourceLink("system", { countryId: "JP" });
    expect(s).toBeNull();
  });

  // ── Feedback ─────────────────────────────────────────────────────────────
  it("feedback_status_changed links to admin feedback tab", () => {
    const s = resolveSourceLink("feedback_status_changed", {
      issueNumber: 42,
    });
    expect(s?.href).toBe("/admin?tab=feedback&issue=42");
    expect(s?.label).toBe("View issue #42");
  });

  it("new_feedback links to admin feedback tab", () => {
    const s = resolveSourceLink("new_feedback", { issueNumber: 5 });
    expect(s?.href).toBe("/admin?tab=feedback&issue=5");
    expect(s?.label).toBe("View #5");
  });

  // ── Player suggestion ────────────────────────────────────────────────────
  it("new_player_suggestion links to admin suggestions tab", () => {
    const s = resolveSourceLink("new_player_suggestion", {
      suggestionIssueNumber: 3,
    });
    expect(s?.href).toBe("/admin?tab=support&sub=suggestions&issue=3");
    expect(s?.label).toBe("Review S#3");
  });

  it("player_suggestion_status_changed links to /feedback/[n]", () => {
    const s = resolveSourceLink("player_suggestion_status_changed", {
      suggestionIssueNumber: 10,
    });
    expect(s?.href).toBe("/feedback/10");
    expect(s?.label).toBe("View S#10");
  });

  // ── News post ────────────────────────────────────────────────────────────
  it("new_post with postId links to /news/post/[id]", () => {
    const s = resolveSourceLink("new_post", {
      authorCharacterId: "char1",
      postId: "post99",
    });
    expect(s?.href).toBe("/news/post/post99");
    expect(s?.label).toBe("View post");
  });

  it("new_post without postId links to author news feed", () => {
    const s = resolveSourceLink("new_post", {
      authorCharacterId: "char1",
    });
    expect(s?.href).toBe("/news?author=char1");
    expect(s?.label).toBe("See posts");
  });

  it("new_post without authorCharacterId returns null", () => {
    expect(resolveSourceLink("new_post", { postId: "p1" })).toBeNull();
  });

  // ── Player event ─────────────────────────────────────────────────────────
  it("player_event links to /actions#event-card", () => {
    const s = resolveSourceLink("player_event", {});
    expect(s?.href).toBe("/actions#event-card");
    expect(s?.label).toBe("View event");
  });

  it("player_event_resolved links to /actions#event-card", () => {
    const s = resolveSourceLink("player_event_resolved", {});
    expect(s?.href).toBe("/actions#event-card");
  });

  // ── Corp bond ────────────────────────────────────────────────────────────
  it("corp_bond_due_soon with bondId links to /bond/[id]", () => {
    const s = resolveSourceLink("corp_bond_due_soon", { bondId: "b1" });
    expect(s?.href).toBe("/bond/b1");
    expect(s?.label).toBe("View bond");
  });

  it("corp_bond_due_soon falls back to corporation link", () => {
    const s = resolveSourceLink("corp_bond_due_soon", {
      corporationSequentialId: 12,
    });
    expect(s?.href).toBe("/corporation/12");
    expect(s?.label).toBe("Corporation");
  });

  it("corp_bond_repaid with bondId links to /bond/[id]", () => {
    const s = resolveSourceLink("corp_bond_repaid", { bondId: "b2" });
    expect(s?.href).toBe("/bond/b2");
  });

  // ── Crisis ───────────────────────────────────────────────────────────────
  it("crisis with crisisId links to /world/crises/[id]", () => {
    const s = resolveSourceLink("crisis", { crisisId: "cr1" });
    expect(s?.href).toBe("/world/crises/cr1");
    expect(s?.label).toBe("View crisis");
  });

  it("crisis falls back to a pre-built href (back-compat)", () => {
    const s = resolveSourceLink("crisis", { href: "/world/crises/legacy" });
    expect(s?.href).toBe("/world/crises/legacy");
    expect(s?.label).toBe("View crisis");
  });

  it("crisis without crisisId or href returns null", () => {
    expect(resolveSourceLink("crisis", {})).toBeNull();
  });
});
