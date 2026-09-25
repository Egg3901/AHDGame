"use client";

import { getStoredConsent } from "@/components/CookieConsent";
import { captureAmplitudeEvent, stopAmplitudeCapture } from "./amplitudeClient";
import { capturePostHogEvent, stopPostHogCapture } from "./posthogClient";
import { ACCOUNT_CREATED_KEY, FIRST_TURN_KEY } from "./storageKeys";

/**
 * The single analytics choke point.
 *
 * Every product event goes through here and fans out to both destinations, so
 * instrumentation is written once and no call site knows or cares which tools
 * are live:
 *
 * - **PostHog** — breadth. Session replay, feature flags, experiments, surveys,
 *   error tracking. The daily driver.
 * - **Amplitude** — depth. Retention curves, behavioural cohorts and funnel
 *   decomposition. Opened when there is a hard retention question.
 *
 * Both are consent-gated and neither loads without its own key configured, so
 * this is safe to ship while a destination is still being provisioned. A
 * destination that is not configured resolves to a no-op rather than throwing.
 *
 * Adding a third destination means adding one branch here, not touching the
 * call sites.
 */
export async function captureProductEvent(
  event: string,
  properties?: Record<string, string | number | boolean>
): Promise<void> {
  // allSettled, not all: one destination being down or misconfigured must never
  // suppress the other, and analytics must never reject into a caller's flow.
  await Promise.allSettled([
    capturePostHogEvent(event, properties),
    captureAmplitudeEvent(event, properties),
  ]);
}

/** Withdrawing consent stops every destination, not just the daily driver. */
export async function stopAnalyticsCapture(): Promise<void> {
  await Promise.allSettled([stopPostHogCapture(), stopAmplitudeCapture()]);
}

let accountCaptureInFlight = false;
const characterCaptureInFlight = new Set<string>();
const firstTurnCaptureInFlight = new Set<string>();

/** Carry a successful signup across the mandatory full-page login navigation. */
export function rememberAccountCreated(): void {
  if (getStoredConsent() !== "accepted") return;
  try {
    window.localStorage.setItem(ACCOUNT_CREATED_KEY, "1");
  } catch {
    // Analytics storage is optional.
  }
}

export async function capturePendingAccountCreated(): Promise<void> {
  if (getStoredConsent() !== "accepted" || accountCaptureInFlight) return;
  accountCaptureInFlight = true;
  try {
    if (window.localStorage.getItem(ACCOUNT_CREATED_KEY) !== "1") return;
    if (getStoredConsent() !== "accepted") return;
    await captureProductEvent("account_created");
    window.localStorage.removeItem(ACCOUNT_CREATED_KEY);
  } catch {
    // Retry on a later navigation.
  } finally {
    accountCaptureInFlight = false;
  }
}

/** Local anchor for a new character; older characters never enter this funnel. */
export function rememberNewCharacter(characterId: string, createdTurn: number): void {
  if (getStoredConsent() !== "accepted" || !Number.isInteger(createdTurn)) return;
  try {
    window.localStorage.setItem(
      FIRST_TURN_KEY,
      JSON.stringify({ characterId, createdTurn, creationCaptured: false })
    );
  } catch {
    // Analytics storage is optional.
  }
}

export async function capturePendingCharacterCreated(characterId: string): Promise<void> {
  if (getStoredConsent() !== "accepted" || characterCaptureInFlight.has(characterId)) return;
  characterCaptureInFlight.add(characterId);
  try {
    const stored = window.localStorage.getItem(FIRST_TURN_KEY);
    if (!stored) return;
    const anchor = JSON.parse(stored) as {
      characterId?: string;
      createdTurn?: number;
      creationCaptured?: boolean;
    };
    if (anchor.characterId !== characterId || anchor.creationCaptured) return;
    if (getStoredConsent() !== "accepted") return;
    await captureProductEvent("character_created");
    window.localStorage.setItem(
      FIRST_TURN_KEY,
      JSON.stringify({ ...anchor, creationCaptured: true })
    );
  } catch {
    // Retry on a later navigation.
  } finally {
    characterCaptureInFlight.delete(characterId);
  }
}

/** A completed world turn after creation is the onboarding funnel's final step. */
export async function captureFirstTurnIfReady(characterId: string): Promise<void> {
  if (getStoredConsent() !== "accepted" || firstTurnCaptureInFlight.has(characterId)) return;
  firstTurnCaptureInFlight.add(characterId);
  let anchor: { characterId: string; createdTurn: number } | null = null;
  try {
    const stored = window.localStorage.getItem(FIRST_TURN_KEY);
    if (stored) anchor = JSON.parse(stored) as { characterId: string; createdTurn: number };
  } catch {
    firstTurnCaptureInFlight.delete(characterId);
    return;
  }
  if (anchor?.characterId !== characterId || !Number.isInteger(anchor.createdTurn)) {
    firstTurnCaptureInFlight.delete(characterId);
    return;
  }

  try {
    const response = await fetch("/api/game/turn/status", { cache: "no-store" });
    if (!response.ok) return;
    const status = (await response.json()) as { currentTurn?: number; isProcessing?: boolean };
    if (
      status.isProcessing ||
      typeof status.currentTurn !== "number" ||
      status.currentTurn <= anchor.createdTurn
    )
      return;
    await capturePendingCharacterCreated(characterId);
    if (getStoredConsent() !== "accepted") return;
    await captureProductEvent("first_turn_completed");
    window.localStorage.removeItem(FIRST_TURN_KEY);
  } catch {
    // A later visit or navigation can retry.
  } finally {
    firstTurnCaptureInFlight.delete(characterId);
  }
}
