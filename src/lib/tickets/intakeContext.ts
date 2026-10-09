export interface TicketVisit {
  path: string;
  recordedAt: Date;
  platform: "android" | "ios" | "desktop" | "mobile" | "unknown";
  device: "mobile" | "tablet" | "desktop" | "unknown";
  gameVersion: string;
  clientVersion?: string;
}

export const SUPPORT_VISIT_LIMIT = 5;
export const SUPPORT_VISIT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Keep game links only. Never retain query strings, fragments or account pages. */
export function sanitizeSupportPath(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s<>]/.test(raw)) return null;
  const path = raw.split(/[?#]/, 1)[0];
  if (path.length > 300 || /%|\.\./.test(path)) return null;
  if (
    /^\/(?:api|admin|moderator|auth|login|logout|register|reset-password|settings|account)(?:\/|$)/i.test(
      path
    )
  )
    return null;
  return path;
}

export function classifySupportRuntime(
  ua: string | null
): Pick<TicketVisit, "platform" | "device" | "clientVersion"> {
  const text = ua ?? "";
  const ios = /iPhone|iPad|iPod|Macintosh.*Mobile\//i.test(text);
  const android = /Android/i.test(text);
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(text);
  const mobile = ios || android || /Mobile/i.test(text);
  const desktop = /Mozilla|Chrome|Firefox|Safari|Electron/i.test(text);
  const version = text.match(
    /\bAHDClient(?:-(?:Mobile|Desktop))?\/(\d+\.\d+\.\d+(?:[.+-][\w.-]+)?)/i
  )?.[1];
  return {
    platform: ios
      ? "ios"
      : android
        ? "android"
        : mobile
          ? "mobile"
          : desktop
            ? "desktop"
            : "unknown",
    device: tablet ? "tablet" : mobile ? "mobile" : desktop ? "desktop" : "unknown",
    ...(version ? { clientVersion: version.slice(0, 64) } : {}),
  };
}

/** Re-project the allowlist at ticket creation, including old stored documents. */
export function recentSupportVisits(visits: TicketVisit[] | undefined, now: Date): TicketVisit[] {
  const seen = new Set<string>();
  return (visits ?? [])
    .filter((visit) => {
      const at = new Date(visit.recordedAt).getTime();
      const path = sanitizeSupportPath(visit.path);
      if (
        !path ||
        at > now.getTime() ||
        now.getTime() - at > SUPPORT_VISIT_MAX_AGE_MS ||
        !Number.isFinite(at) ||
        seen.has(path)
      )
        return false;
      seen.add(path);
      return true;
    })
    .slice(0, SUPPORT_VISIT_LIMIT)
    .map((visit) => ({
      path: sanitizeSupportPath(visit.path)!,
      recordedAt: new Date(visit.recordedAt),
      platform: visit.platform,
      device: visit.device,
      gameVersion: visit.gameVersion,
      ...(visit.clientVersion ? { clientVersion: visit.clientVersion } : {}),
    }));
}

export function buildIntakeQuestions(
  text: string,
  visits: TicketVisit[],
  needsPage: boolean
): string[] {
  const questions: string[] = [];
  if (needsPage) {
    const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const ranked = visits
      .map((visit) => ({
        visit,
        score: words.reduce(
          (score, word) => score + (visit.path.toLowerCase().includes(word) ? 1 : 0),
          0
        ),
      }))
      .sort((a, b) => b.score - a.score);
    const suppliedPath = (text.match(/https?:\/\/[^\s<>()]+/gi) ?? [])
      .map((value) => {
        try {
          const url = new URL(value);
          return /^(?:www\.)?ahousedividedgame\.com$/i.test(url.hostname)
            ? sanitizeSupportPath(url.pathname)
            : null;
        } catch {
          return null;
        }
      })
      .find(Boolean);
    const candidatePath = suppliedPath ?? ranked[0]?.visit.path;
    questions.push(
      candidatePath
        ? `It seems like you are reporting an issue that may affect a specific page. Is this the page you are having trouble with: <https://ahousedividedgame.com${candidatePath}>? If not, please send the correct game page or menu path.`
        : "Which game page or menu path are you having trouble with?"
    );
  }
  const latest = visits[0];
  questions.push(
    latest
      ? `Please confirm the platform details from your latest game visit: ${latest.platform}, ${latest.device}; game version ${latest.gameVersion}; client version ${latest.clientVersion ?? "unknown"}. Were you using this platform when the issue happened? Please correct any details, including browser or app version.`
      : "Please confirm your platform (Android, iOS, desktop or mobile), whether you use the browser or client app, and your game and client/app versions if available."
  );
  return questions;
}
