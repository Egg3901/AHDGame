import type { CSSProperties } from "react";
import type { OrgIdentity } from "@/lib/constants/orgIdentity";

/**
 * Inline style that scopes the per-org accent to a subtree via CSS variables.
 * Components read the accent with `var(--org)` / `var(--org-soft)` (e.g.
 * `style={{ color: "var(--org)" }}` or `bg-[var(--org)]`), keeping the rest of
 * the page on semantic theme tokens so all themes still work.
 */
export function orgAccentStyle(identity: OrgIdentity): CSSProperties {
  return {
    "--org": identity.accent,
    "--org-soft": identity.accentSoft,
  } as CSSProperties;
}
