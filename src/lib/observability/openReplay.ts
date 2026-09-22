import * as Sentry from "@sentry/nextjs";
import type Tracker from "@openreplay/tracker";
import type { CookieConsentValue } from "@/components/CookieConsent";

let tracker: Tracker | null = null;
let starting: Promise<void> | null = null;

export function normalizeOpenReplayIngestUrl(url: string): string {
  return `${url
    .trim()
    .replace(/\/$/, "")
    .replace(/\/ingest$/, "")}/ingest`;
}

export function parseOpenReplaySampleRate(raw: string | undefined): number {
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function shouldRecordOpenReplay(
  consent: CookieConsentValue | null,
  sampleRate: number,
  roll: number
): boolean {
  return consent === "accepted" && sampleRate > 0 && roll < sampleRate;
}

export async function startOpenReplay(opaqueUserId?: string): Promise<void> {
  if (tracker || starting) return starting ?? Promise.resolve();
  const projectKey = process.env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY;
  const rawUrl = process.env.NEXT_PUBLIC_OPENREPLAY_URL;
  if (!projectKey || !rawUrl) return;

  starting = (async () => {
    try {
      const { default: OpenReplayTracker } = await import("@openreplay/tracker");
      const instance = new OpenReplayTracker({
        projectKey,
        ingestPoint: normalizeOpenReplayIngestUrl(rawUrl),
        respectDoNotTrack: true,
        obscureTextEmails: true,
        defaultInputMode: 2,
        network: {
          sessionTokenHeader: false,
          failuresOnly: false,
          capturePayload: false,
          captureInIframes: false,
          ignoreHeaders: true,
        },
        capturePerformance: true,
      });
      const result = await instance.start();
      if (!result.success) return;
      tracker = instance;
      if (opaqueUserId) tracker.setUserID(opaqueUserId);
      const sessionUrl = tracker.getSessionURL({ withCurrentTime: true });
      if (sessionUrl) Sentry.setTag("openreplay.session", sessionUrl);
    } catch (error) {
      console.warn("[OpenReplay] Failed to initialize", error);
    } finally {
      starting = null;
    }
  })();
  return starting;
}

export function identifyOpenReplayUser(opaqueUserId?: string): void {
  if (opaqueUserId) tracker?.setUserID(opaqueUserId);
}

export function stopOpenReplay(): void {
  tracker?.stop();
  tracker = null;
}
