import type { CaucusHealthItem } from "@/lib/caucus/caucusHealth";
import type { RecruitableNppOption } from "./caucusTypes";

export const apiBase = (countryCode: string, partyId: string) =>
  `/api/country/${countryCode.toLowerCase()}/parties/${partyId}/caucuses`;

export function toRoleLabel(role: string): string {
  return role
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function relationshipBadge(score: number) {
  if (score > 60)
    return { label: "Ally", className: "border-success/40 bg-success/15 text-success" };
  if (score > 20)
    return { label: "Friendly", className: "border-success/30 bg-success/10 text-success" };
  if (score > -20)
    return { label: "Cordial", className: "border-card-border bg-card-muted text-muted" };
  if (score > -50)
    return { label: "Cool", className: "border-warning/30 bg-warning/10 text-warning" };
  return { label: "Hostile", className: "border-error/40 bg-error/15 text-error" };
}

export function recruitStatusTone(status: RecruitableNppOption["status"]): string {
  switch (status) {
    case "eligible":
      return "border-success/40 bg-success/15 text-success";
    case "needs_relationship":
      return "border-warning/40 bg-warning/15 text-warning";
    default:
      return "border-error/40 bg-error/15 text-error";
  }
}

export function caucusHealthTone(statusLabel: CaucusHealthItem["statusLabel"]): string {
  switch (statusLabel) {
    case "Fragile":
      return "border-error/40 bg-error/15 text-error";
    case "Strained":
      return "border-warning/40 bg-warning/15 text-warning";
    default:
      return "border-success/40 bg-success/15 text-success";
  }
}

// Caucus NPP recruit cooldown is real-clock — see members route's recruitability
// check, which uses new Date() against latestCaucusRecruitAt + COOLDOWN_MS.
// Display matches by routing through formatRealTimeCountdown.
import { formatRealTimeCountdown } from "@/lib/utils/formatters";

export function formatHoursMinutes(deadlineIso: string | null): string | null {
  if (!deadlineIso) return null;
  const result = formatRealTimeCountdown(deadlineIso);
  if (result === "—") return null;
  return result === "Ended" ? "Ready now" : result;
}

export function formatCaucusChurnKind(kind: "join" | "leave" | "forced_exit"): string {
  switch (kind) {
    case "join":
      return "Joined";
    case "leave":
      return "Left";
    default:
      return "Forced exit";
  }
}

export function formatMembershipPct(value: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}
