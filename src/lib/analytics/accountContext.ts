"use client";

/** Account metadata is supplied by authenticated client-nav, never inferred from events. */
export interface AnalyticsAccount {
  id: string;
  signupDate?: string;
  isAdmin?: boolean;
  isModerator?: boolean;
}

let account: AnalyticsAccount | null = null;
let generation = 0;

/** Changing accounts invalidates work begun under the previous identity. */
export function setAnalyticsAccount(next: AnalyticsAccount | null): void {
  if (account?.id !== next?.id) generation++;
  account = next ? { ...next } : null;
}

export function getAnalyticsAccount() {
  return { account, generation };
}

export function isAnalyticsGenerationCurrent(value: number): boolean {
  return value === generation;
}

/** Age is UTC calendar days, not elapsed 24-hour periods. Missing dates stay unknown. */
export function accountEventProperties(value: AnalyticsAccount | null, now = Date.now()) {
  const date = value?.signupDate;
  const parsed = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const today = Math.floor(now / 86_400_000);
  const valid =
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === date &&
    parsed / 86_400_000 <= today;
  const age = valid ? today - parsed / 86_400_000 : null;
  return {
    account_created_date: valid ? date! : "unknown",
    account_age_days: age ?? "unknown",
    account_age_band:
      age === null ? "unknown" : age === 0 ? "day_0" : age < 7 ? "days_1_6" : "days_7_plus",
    account_role:
      value?.isAdmin === true
        ? "admin"
        : value?.isModerator === true
          ? "moderator"
          : value?.isAdmin === false && value?.isModerator === false
            ? "player"
            : "unknown",
  };
}
