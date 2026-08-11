"use client";

import { addClientBreadcrumb } from "@/lib/observability/sentryClientLazy";

/**
 * Record a player-initiated game action as a Sentry breadcrumb.
 *
 * Call this immediately before the fetch that executes the action. The
 * breadcrumb trail in any subsequent GlitchTip error will show the last
 * N actions the player took, giving full context without reading server logs.
 *
 * @param label   Short human-readable action name, e.g. "bond.buy", "org.build"
 * @param metadata  Optional key/value context (countryCode, amount, entityId…).
 *                  Keep values scalar — no nested objects, no PII.
 */
export function trackAction(label: string, metadata?: Record<string, unknown>): void {
  addClientBreadcrumb({
    category: "game.action",
    message: label,
    level: "info",
    data: metadata,
  });
}
