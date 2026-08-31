"use client";

/**
 * Site-wide poll/survey strip, shown under the navbar while an admin has it
 * switched on (Admin > Support > Poll Banner). Every page except the handful
 * that render no site chrome at all (see `isChromeHiddenPath`).
 *
 * Modeled on `MaintenancePartialBanner`: self-fetches the public
 * `/api/poll-banner` snapshot on mount, re-polls on a slow interval, and
 * renders nothing at all until the server says otherwise. Not gated on auth,
 * because a survey aimed at the playerbase should reach signed-out visitors
 * too, and not dismissible, because it stays up only as long as an admin
 * leaves it up.
 *
 * The strip itself is split out as `PollBannerStrip` so the admin editor can
 * preview the real thing instead of an approximation of it.
 *
 * Copy rules: the message is admin-authored, so no em or en dashes belong in
 * the surrounding chrome either.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isChromeHiddenPath } from "@/lib/constants/layoutPaths";
import type { PollBannerSnapshot } from "@/lib/pollBanner";

const POLL_INTERVAL_MS = 60_000; // 1 minute

/** Two tones, matching the palettes the country-level PeaceBanner already uses. */
const TONE_CLASSES: Record<PollBannerSnapshot["tone"], string> = {
  info: "border-info/30 bg-info/10 text-info",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

export function PollBannerStrip({ snapshot }: { snapshot: PollBannerSnapshot }) {
  if (!snapshot.enabled) return null;

  return (
    <div
      // Carries the notice role for anyone not looking at the top of the
      // screen. Note this region is inserted rather than pre-existing and
      // later filled, so announcement on arrival is not guaranteed across
      // every screen reader; the role is still correct and costs nothing.
      role="status"
      className={`border-b px-4 py-2 text-center text-sm break-words ${TONE_CLASSES[snapshot.tone]}`}
    >
      <span>{snapshot.message} </span>
      <a
        href={snapshot.url}
        target="_blank"
        // The destination is admin-supplied and off-site; never hand it a
        // live window.opener back into the game.
        rel="noopener noreferrer"
        className="font-semibold underline underline-offset-2 hover:opacity-80"
      >
        {snapshot.linkLabel}
      </a>
    </div>
  );
}

export function PollBannerNotice() {
  const pathname = usePathname();
  // The effect keys off the BOOLEAN, not the pathname: every client-side
  // navigation changes the pathname, and re-polling on each one would turn a
  // once-a-minute request into one per page view. Only crossing the
  // chrome boundary actually changes what this component should do.
  const chromeHidden = isChromeHiddenPath(pathname);
  const [snapshot, setSnapshot] = useState<PollBannerSnapshot | null>(null);

  useEffect(() => {
    // Nothing to draw on a chromeless page, so do not poll for it either.
    // Crossing back out flips `chromeHidden` and re-runs this, which is what
    // resumes polling.
    if (chromeHidden) return;

    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/poll-banner");
        if (!res.ok) return;
        const body = (await res.json()) as PollBannerSnapshot;
        if (!cancelled) setSnapshot(body);
      } catch {
        // ignore — the banner is best-effort and must never break a page
      }
    }
    void load();
    const handle = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [chromeHidden]);

  // Login, register, banned and maintenance draw no navbar, so a strip here
  // would sit alone at the top of the page against no chrome at all.
  if (chromeHidden) return null;
  if (!snapshot?.enabled) return null;
  return <PollBannerStrip snapshot={snapshot} />;
}
