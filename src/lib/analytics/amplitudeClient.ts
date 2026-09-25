"use client";

import { getStoredConsent } from "@/components/CookieConsent";

type AmplitudeModule = typeof import("@amplitude/analytics-browser");

/**
 * Amplitude is the depth tool: retention curves, behavioural cohorts and funnel
 * decomposition. PostHog stays the daily driver (replay, flags, experiments).
 * Both receive the same thin event stream from `captureProductEvent`.
 *
 * Like PostHog, Amplitude never loads until the player has opted in on the
 * hosted site, and it sends identified events under an opaque account id only.
 * With no `NEXT_PUBLIC_AMPLITUDE_API_KEY` present this is a silent no-op, so it
 * is safe to ship ahead of the key being provisioned.
 */
let modulePromise: Promise<AmplitudeModule | null> | null = null;

export function getAmplitudeModule(): Promise<AmplitudeModule | null> {
  const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  if (!apiKey || getStoredConsent() !== "accepted") return Promise.resolve(null);
  if (modulePromise) return modulePromise;

  modulePromise = import("@amplitude/analytics-browser")
    .then((mod) => {
      if (getStoredConsent() !== "accepted") return null;
      mod.init(apiKey, undefined, {
        // Named-area events only; no autocapture, no default page views, no
        // session replay. PostHog owns replay if it is ever piloted.
        autocapture: false,
        defaultTracking: false,
        flushIntervalMillis: 10_000,
        trackingOptions: {
          ipAddress: false,
          language: false,
          platform: false,
        },
        // Keep the user id opaque and stable across the same browser.

        deviceId: undefined,
      });
      mod.setOptOut(false);
      return mod;
    })
    .catch(() => null);

  void modulePromise.then((mod) => {
    if (!mod) modulePromise = null;
  });
  return modulePromise;
}

export async function captureAmplitudeEvent(
  event: string,
  properties?: Record<string, string | number | boolean>
): Promise<void> {
  const mod = await getAmplitudeModule();
  if (mod && getStoredConsent() === "accepted") {
    if (properties) mod.track(event, properties);
    else mod.track(event);
  }
}

/** Called when consent is withdrawn; no further events are sent to Amplitude. */
export async function stopAmplitudeCapture(): Promise<void> {
  const mod = await modulePromise;
  if (!mod) return;
  mod.setOptOut(true);
  mod.reset();
}
