import type { NotificationType } from "@/lib/db/types/notifications";
import { centralBankUrl } from "@/lib/urls";
import { getRepresentativeCentralBankCountry } from "@/lib/centralBank/helpers";

export type InboxSource = { label: string; hint?: string; href: string };

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const asNumber = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/**
 * Resolves the primary deep-link for a notification, mirroring the exact
 * metadata-key → route mapping in NotificationCard.tsx.
 *
 * The card can show multiple links for one notification (e.g. both a bond
 * link and a corporation link for corp_bond_due_soon). This function returns
 * the single most-specific link so callers can use it without duplicating
 * the mapping logic.
 */
export function resolveSourceLink(
  type: NotificationType,
  metadata: Record<string, unknown> | undefined
): InboxSource | null {
  const m = metadata ?? {};

  // ── Election ──────────────────────────────────────────────────────────────
  const electionId = asString(m.electionId);
  if (electionId) {
    return { label: "View election", href: `/elections/${electionId}` };
  }

  // ── Bill (direct billId or whip-issued targetId) ──────────────────────────
  const billId = asString(m.billId);
  const whipBillId =
    type === "party_whip_issued" && m.targetType === "bill" ? asString(m.targetId) : undefined;
  const effectiveBillId = billId ?? whipBillId;
  if (effectiveBillId) {
    // State (sub-national) bills carry a stateId in their notification metadata
    // and live under the region legislature — routing them to /congress/bills
    // (national) yields "bill not found". National bills have no stateId.
    const stateId = asString(m.stateId);
    if (stateId) {
      const country = (asString(m.countryId) ?? "US").toLowerCase();
      return {
        label: "View bill",
        href: `/country/${country}/region/${stateId.toLowerCase()}/legislature/bills/${effectiveBillId}`,
      };
    }
    return { label: "View bill", href: `/congress/bills/${effectiveBillId}` };
  }

  // ── Coalition ─────────────────────────────────────────────────────────────
  const coalitionSeqId = asNumber(m.coalitionSequentialId);
  const coalitionCountry = asString(m.countryId);
  if (coalitionSeqId != null && coalitionCountry) {
    return {
      label: "View coalition",
      href: `/country/${coalitionCountry.toLowerCase()}/parties/coalition/${coalitionSeqId}`,
    };
  }

  // ── Charter ───────────────────────────────────────────────────────────────
  const charterTypes: NotificationType[] = [
    "charter_invited",
    "charter_replacement_needed",
    "charter_ratified",
  ];
  const charterId = charterTypes.includes(type) ? asString(m.charterId) : undefined;

  if (charterId) {
    const label =
      type === "charter_invited"
        ? "Open charter to sign"
        : type === "charter_replacement_needed"
          ? "Open charter to replace founder"
          : "View charter";
    return { label, href: `/charters/${charterId}` };
  }

  // charter_ratified also shows a party link after the charter link; return
  // it if there's no charterId but there are countryId + partyId.
  if (
    type === "charter_ratified" &&
    typeof m.countryId === "string" &&
    typeof m.partyId === "string"
  ) {
    return {
      label: "Open party",
      href: `/country/${(m.countryId as string).toLowerCase()}/parties/${m.partyId as string}`,
    };
  }

  // ── Central bank chair pending ────────────────────────────────────────────
  if (m.type === "central_bank_chair_pending") {
    const intorgId = asString(m.intorgId);
    const countryIdCb = asString(m.countryId);
    if (intorgId) {
      const representative = getRepresentativeCentralBankCountry(intorgId.toUpperCase());
      return {
        label: "Accept or decline",
        href: representative
          ? centralBankUrl(representative)
          : `/intorg/${intorgId.toLowerCase()}/central-bank`,
      };
    }
    if (countryIdCb) {
      return {
        label: "Accept or decline",
        href: centralBankUrl(countryIdCb),
      };
    }
  }

  // ── Feedback (admin) ──────────────────────────────────────────────────────
  if (
    (type === "feedback_status_changed" || type === "new_feedback") &&
    typeof m.issueNumber === "number"
  ) {
    const issueNumber = m.issueNumber as number;
    const label =
      type === "feedback_status_changed" ? `View issue #${issueNumber}` : `View #${issueNumber}`;
    return { label, href: `/admin?tab=feedback&issue=${issueNumber}` };
  }

  // ── Player suggestion (admin view) ────────────────────────────────────────
  if (type === "new_player_suggestion" && typeof m.suggestionIssueNumber === "number") {
    const sn = m.suggestionIssueNumber as number;
    return {
      label: `Review S#${sn}`,
      href: `/admin?tab=support&sub=suggestions&issue=${sn}`,
    };
  }

  // ── Player suggestion status changed (player view) ────────────────────────
  if (type === "player_suggestion_status_changed" && typeof m.suggestionIssueNumber === "number") {
    const sn = m.suggestionIssueNumber as number;
    return { label: `View S#${sn}`, href: `/feedback/${sn}` };
  }

  // ── News post ─────────────────────────────────────────────────────────────
  if (type === "new_post" && typeof m.authorCharacterId === "string") {
    const postId = asString(m.postId);
    if (postId) {
      return { label: "View post", href: `/news/post/${postId}` };
    }
    return {
      label: "See posts",
      href: `/news?author=${m.authorCharacterId as string}`,
    };
  }

  // ── Player event ──────────────────────────────────────────────────────────
  if (type === "player_event" || type === "player_event_resolved") {
    return { label: "View event", href: "/actions#event-card" };
  }

  // ── World event (country-scope) ─────────────────────────────────────────
  if (type === "world_event_offered" || type === "world_event_resolved") {
    return { label: "View event", href: "/actions#event-card" };
  }

  // ── Corp bond ─────────────────────────────────────────────────────────────
  if (type === "corp_bond_due_soon" || type === "corp_bond_repaid") {
    const bondId = asString(m.bondId);
    if (bondId) {
      return { label: "View bond", href: `/bond/${bondId}` };
    }
    const corpSeqId = asNumber(m.corporationSequentialId);
    if (corpSeqId != null) {
      return { label: "Corporation", href: `/corporation/${corpSeqId}` };
    }
  }

  // ── Ask service ───────────────────────────────────────────────────────────
  // Ask notifications carry a prebuilt href (the Ask site) in metadata.
  if (type.startsWith("ask_")) {
    const href = asString(m.href);
    if (href) return { label: "Open Ask", href };
  }

  // ── Crisis ────────────────────────────────────────────────────────────────
  if (type === "crisis") {
    const crisisId = asString(m.crisisId);
    if (crisisId) {
      return { label: "View crisis", href: `/world/crises/${crisisId}` };
    }
    // Back-compat: older crisis notifications stored a pre-built href instead.
    const href = asString(m.href);
    if (href) return { label: "View crisis", href };
  }

  return null;
}
