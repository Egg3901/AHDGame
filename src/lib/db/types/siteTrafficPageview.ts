import type { ObjectId } from "mongodb";

export type DeviceType = "mobile" | "tablet" | "desktop" | "other";

/**
 * First-party page view for admin traffic dashboards.
 * visitorId matches the httpOnly `__ahd_track` cookie (random UUID), not a user id.
 */
export interface SiteTrafficPageview {
  _id?: ObjectId;
  path: string;
  recordedAt: Date;
  visitorId: string;
  /** True when a valid auth JWT was present (no DB user lookup). */
  authenticated: boolean;
  /** Device class derived from user-agent at ingestion time (best-effort). */
  deviceType?: DeviceType;
  /** ISO-3166-1 alpha-2 country code from edge geo headers. "ZZ" when unknown. */
  country?: string;
  /** Client-reported page load time in milliseconds (Navigation Timing API). */
  loadTimeMs?: number;
}
