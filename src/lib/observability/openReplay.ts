import * as Sentry from "@sentry/nextjs";
import type Tracker from "@openreplay/tracker";
import type { CookieConsentValue } from "@/components/CookieConsent";

let tracker: Tracker | null = null;
let starting: Promise<void> | null = null;

export interface OpenReplayGameContext {
  authenticated: boolean;
  hasCharacter: boolean;
  characterCountryId?: string | null;
  corporationId?: number | null;
  corporationType?: string | null;
  corporationCountryId?: string | null;
  partyCountryId?: string | null;
  hasCabinetOffice: boolean;
  hasGovernorOffice: boolean;
  isImperialMode: boolean;
}

export function buildOpenReplayMetadata(context: OpenReplayGameContext): Record<string, string> {
  const metadata: Record<string, string> = {
    authenticated: String(context.authenticated),
    has_character: String(context.hasCharacter),
    has_cabinet_office: String(context.hasCabinetOffice),
    has_governor_office: String(context.hasGovernorOffice),
    imperial_mode: String(context.isImperialMode),
  };
  if (context.characterCountryId) metadata.character_country = context.characterCountryId;
  if (context.corporationId != null) metadata.corporation_id = String(context.corporationId);
  if (context.corporationType) metadata.corporation_type = context.corporationType;
  if (context.corporationCountryId) {
    metadata.corporation_country = context.corporationCountryId;
  }
  if (context.partyCountryId) metadata.party_country = context.partyCountryId;
  return metadata;
}

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

export async function startOpenReplay(
  opaqueUserId?: string,
  metadata: Readonly<Record<string, string>> = {}
): Promise<void> {
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
      for (const [key, value] of Object.entries(metadata)) tracker.setMetadata(key, value);
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

export function setOpenReplayMetadata(metadata: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(metadata)) tracker?.setMetadata(key, value);
}

export function stopOpenReplay(): void {
  tracker?.stop();
  tracker = null;
}
