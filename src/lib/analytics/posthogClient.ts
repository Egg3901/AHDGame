"use client";

import { getStoredConsent } from "@/components/CookieConsent";
import { ACCOUNT_CREATED_KEY, FIRST_TURN_KEY } from "./storageKeys";

type PostHogClient = typeof import("posthog-js").default;

let clientPromise: Promise<PostHogClient | null> | null = null;

/**
 * PostHog transport layer.
 *
 * This module knows about PostHog and nothing else. Product events belong in
 * `captureProductEvent` from `./capture`, which fans out to every destination.
 * The funnel helpers and their storage anchors also live in `./capture`; this
 * module only clears those anchors when consent is withdrawn.
 */

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
        // Session replay is ON (executive decision 2026-09-26, reversal of the
        // removal-era default). Sampled, masked, and blocked on sensitive
        // screens; see ANALYTICS_ROLLOUT.md step 4 and the privacy policy.
        // Elements carrying data-replay-block are replaced with placeholders.
        session_recording: {
          sampleRate: 0.1,
          maskAllInputs: true,
          recordHeaders: false,
          recordBody: false,
          blockSelector: "[data-replay-block]",
        },
        disable_surveys: true,
        // Navigation experiment assignment runs only after analytics consent.
        advanced_disable_feature_flags: false,
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
      // The hosted PostHog widget owns the close button. Mirror only its
      // dismissal position through the shared wrapper, without survey answers.
      posthog.on(
        "eventCaptured",
        (captured: { event?: string; properties?: Record<string, unknown> }) => {
          if (captured.event !== "survey dismissed") return;
          const questions = captured.properties?.$survey_questions;
          const questionIndex = Array.isArray(questions)
            ? questions.filter(
                (question: { response?: unknown }) =>
                  question?.response !== undefined && question.response !== null
              ).length
            : 0;
          void import("./capture").then(({ captureProductEvent }) =>
            captureProductEvent("survey_dismissed", { question_index: questionIndex })
          );
        }
      );
      return posthog;
    })
    .catch(() => null);
  void clientPromise.then((client) => {
    if (!client) clientPromise = null;
  });
  return clientPromise;
}

/** Survey loading starts only after the SDK has the authenticated account ID. */
export function identifyPostHogUser(client: PostHogClient, userId: string): void {
  client.identify(userId, { is_player: true });
  client.set_config({ disable_surveys: false });
}

/** Keep later anonymous page views from loading surveys after logout. */
export function resetPostHogUser(client: PostHogClient): void {
  client.set_config({ disable_surveys: true });
  client.reset();
  client.opt_in_capturing();
}

/**
 * PostHog-specific capture. Product events should go through
 * `captureProductEvent` in `./capture`, which fans out to every destination;
 * call this directly only for a PostHog-only concern.
 */
export async function capturePostHogEvent(
  event: string,
  properties?: Record<string, string | number | boolean>
): Promise<void> {
  const client = await getPostHogClient();
  if (client && getStoredConsent() === "accepted") {
    // Preserve the original call arity so an event without properties is sent
    // exactly as it was before the fan-out wrapper existed.
    if (properties) client.capture(event, properties);
    else client.capture(event);
  }
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
  client.set_config({ disable_surveys: true });
  client.opt_out_capturing();
  client.reset();
}
