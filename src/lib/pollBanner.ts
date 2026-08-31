import type { GameConfig } from "@/lib/db/types";

/**
 * PURE half of the poll banner, deliberately free of any database import: the
 * admin editor is a client component and imports the validator and the field
 * limits from here, so anything added to this file ships to the browser. The
 * cached `gameConfig` read lives in `./pollBannerCache` for that reason.
 */
export type PollBannerTone = "info" | "warning";

export interface PollBannerSnapshot {
  enabled: boolean;
  /** Sentence shown before the link. Empty whenever `enabled` is false. */
  message: string;
  /** Anchor text for the link. Empty whenever `enabled` is false. */
  linkLabel: string;
  /** Absolute http(s) destination. Empty whenever `enabled` is false. */
  url: string;
  tone: PollBannerTone;
}

/** Anchor text used when an admin enables the banner without naming one. */
export const DEFAULT_POLL_BANNER_LINK_LABEL = "Click Here";

/** Field limits, shared between the admin Zod schema and the admin form. */
export const POLL_BANNER_MESSAGE_MAX = 300;
export const POLL_BANNER_LINK_LABEL_MAX = 60;
export const POLL_BANNER_URL_MAX = 500;

/**
 * The "nothing to show" snapshot. Deliberately carries no message and no URL:
 * a disabled banner must not hand a draft link to every anonymous visitor who
 * curls the public endpoint.
 *
 * Built fresh per call rather than shared as a module const, because the result
 * is handed to a module-level cache that outlives the request; one caller
 * mutating a shared object would corrupt every later reader in the process.
 */
function disabledSnapshot(): PollBannerSnapshot {
  return {
    enabled: false,
    message: "",
    linkLabel: "",
    url: "",
    tone: "info",
  };
}

/**
 * True only for an absolute http(s) URL. The banner renders an admin-supplied
 * href to every visitor, so `javascript:` and `data:` are rejected here rather
 * than trusted to the browser; relative paths are rejected too, since the
 * banner exists to point off-site at a survey.
 */
export function isSafePollBannerUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Unrecognized or absent tones fall back to the routine "info" treatment. */
export function normalizePollBannerTone(raw: unknown): PollBannerTone {
  return raw === "warning" ? "warning" : "info";
}

type PollBannerConfig = Pick<
  GameConfig,
  | "pollBannerEnabled"
  | "pollBannerMessage"
  | "pollBannerLinkLabel"
  | "pollBannerUrl"
  | "pollBannerTone"
>;

/**
 * Resolves the stored fields into what the banner should actually render.
 *
 * Every "should this show at all" rule lives here, so the public route, the
 * admin preview and the component itself cannot drift apart: the toggle must
 * be on, the message must be non-blank, and the URL must survive
 * {@link isSafePollBannerUrl}. Any failure collapses to {@link disabledSnapshot},
 * which is why a caller can render the result without re-checking anything.
 */
export function resolvePollBannerSnapshot(
  config: PollBannerConfig | null | undefined
): PollBannerSnapshot {
  if (!config?.pollBannerEnabled) return disabledSnapshot();

  const message = (config.pollBannerMessage ?? "").trim();
  const url = (config.pollBannerUrl ?? "").trim();
  if (!message || !isSafePollBannerUrl(url)) return disabledSnapshot();

  const linkLabel = (config.pollBannerLinkLabel ?? "").trim() || DEFAULT_POLL_BANNER_LINK_LABEL;

  return {
    enabled: true,
    message,
    linkLabel,
    url,
    tone: normalizePollBannerTone(config.pollBannerTone),
  };
}
