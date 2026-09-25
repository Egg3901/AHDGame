"use client";

import { getStoredConsent } from "@/components/CookieConsent";

type PostHogClient = typeof import("posthog-js").default;

let clientPromise: Promise<PostHogClient | null> | null = null;
const FIRST_TURN_KEY = "ahd-posthog-first-turn";
const ACCOUNT_CREATED_KEY = "ahd-posthog-account-created";
let accountCaptureInFlight = false;
const characterCaptureInFlight = new Set<string>();
const firstTurnCaptureInFlight = new Set<string>();

/** PostHog never loads until the player has opted in on the hosted site. */
export function getPostHogClient(): Promise<PostHogClient | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || getStoredConsent() !== "accepted") return Promise.resolve(null);
  if (clientPromise)
    return clientPromise.then((client) => {
      if (client && getStoredConsent() === "accepted" && client.has_opted_out_capturing()) {
        client.opt_in_capturing();
      }
      return client;
    });

  clientPromise = import("posthog-js")
    .then(({ default: posthog }) => {
      if (getStoredConsent() !== "accepted") return null;
      posthog.init(key, {
        api_host: "https://us.i.posthog.com",
        autocapture: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_feature_flags: true,
        opt_out_capturing_by_default: true,
        persistence: "localStorage+cookie",
        property_denylist: [
          "$current_url",
          "$pathname",
          "$referrer",
          "$initial_current_url",
          "$initial_pathname",
          "$initial_referrer",
        ],
      });
      posthog.opt_in_capturing();
      return posthog;
    })
    .catch(() => null);
  void clientPromise.then((client) => {
    if (!client) clientPromise = null;
  });
  return clientPromise;
}

export async function captureProductEvent(
  event: string,
  properties?: Record<string, string | number | boolean>
): Promise<void> {
  const client = await getPostHogClient();
  if (client && getStoredConsent() === "accepted") client.capture(event, properties);
}

/** Called when consent is withdrawn; no further events or recordings are sent. */
export async function stopPostHogCapture(): Promise<void> {
  try {
    window.localStorage.removeItem(ACCOUNT_CREATED_KEY);
    window.localStorage.removeItem(FIRST_TURN_KEY);
  } catch {
    // Analytics storage is optional.
  }
  const client = await clientPromise;
  if (!client) return;
  client.opt_out_capturing();
  client.reset();
}

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
    const client = await getPostHogClient();
    if (!client || getStoredConsent() !== "accepted") return;
    client.capture("account_created");
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
    const client = await getPostHogClient();
    if (!client || getStoredConsent() !== "accepted") return;
    client.capture("character_created");
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
    const client = await getPostHogClient();
    if (!client || getStoredConsent() !== "accepted") return;
    client.capture("first_turn_completed");
    window.localStorage.removeItem(FIRST_TURN_KEY);
  } catch {
    // A later visit or navigation can retry.
  } finally {
    firstTurnCaptureInFlight.delete(characterId);
  }
}
