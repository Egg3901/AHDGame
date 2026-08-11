"use client";

import { useEffect, useState } from "react";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { COMMUNITY_DISCORD_URL, COMMUNITY_PATREON_URL } from "@/lib/communityLinks";

type DiscordStats = {
  guildName: string;
  memberCount: number;
  onlineCount: number;
};

const REFRESH_MS = 5 * 60 * 1000;

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function PatreonGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.386 0H8.614C3.858 0 0 3.858 0 8.614v6.772C0 20.142 3.858 24 8.614 24h6.772C20.142 24 24 20.142 24 15.386V8.614C24 3.858 20.142 0 15.386 0zM4.5 17.25V6.75h3.75v10.5H4.5zm7.5 0V6.75H18c2.07 0 3.75 1.68 3.75 3.75S20.07 14.25 18 14.25h-3v3h-3z" />
    </svg>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
    </span>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function DiscordMemberStat({ stats, loading }: { stats: DiscordStats | null; loading: boolean }) {
  if (loading && !stats) {
    return (
      <div className="mt-5 space-y-2" aria-busy="true" aria-label="Loading Discord member count">
        <div className="h-10 w-28 animate-pulse rounded-md bg-card-elevated" />
        <div className="h-4 w-36 animate-pulse rounded-md bg-card-elevated/80" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="mt-5">
      <div className="flex items-end gap-2">
        <p className="font-display text-display font-semibold leading-none tracking-tight text-foreground">
          {formatCount(stats.memberCount)}
        </p>
        <span className="mb-1 text-body-sm font-medium text-muted">members</span>
      </div>
      <p className="mt-2 flex items-center gap-2 text-body-sm text-muted">
        <LiveDot />
        <span>
          <span className="font-medium text-success">{formatCount(stats.onlineCount)}</span> online
          now
        </span>
      </p>
    </div>
  );
}

function ExternalCta({
  href,
  accent,
  children,
}: {
  href: string;
  accent: "discord" | "patreon";
  children: React.ReactNode;
}) {
  const accentClasses =
    accent === "discord"
      ? "bg-secondary text-white hover:bg-secondary-dark hover:shadow-secondary/25 focus-visible:ring-secondary"
      : "bg-gold text-background hover:bg-gold-muted hover:shadow-gold/25 focus-visible:ring-gold";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`group mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4.5 h-11 text-sm font-semibold transition-all duration-150 hover:shadow-lg active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto ${accentClasses}`}
    >
      {children}
      <span className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">
        →
      </span>
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

export function CommunitySupportSection({
  initialStats = null,
}: {
  /** Server-fetched Discord counts so the first paint skips the loading skeleton. */
  initialStats?: DiscordStats | null;
}) {
  const [stats, setStats] = useState<DiscordStats | null>(initialStats);
  const [loading, setLoading] = useState(initialStats == null);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      try {
        const response = await fetch("/api/community/discord-stats");
        if (!response.ok) return;
        const data = (await response.json()) as DiscordStats;
        if (!cancelled) setStats(data);
      } catch {
        // Keep the CTA usable even if counts fail to load.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // When the server already provided stats, skip the immediate post-hydration
    // fetch (avoids competing with the globe's chunk/topojson waterfall) and
    // only keep the 5-minute poll for freshness.
    if (initialStats == null) {
      void loadStats();
    } else {
      setLoading(false);
    }

    const interval = window.setInterval(() => {
      void loadStats();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [initialStats]);

  return (
    <section className="border-t border-card-border bg-card-muted/20">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <SectionLabel as="h2">Join the community</SectionLabel>
        <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
          Meet other players, get help from the team, and help keep the simulation running. The game
          is free — Patreon support is optional but deeply appreciated.
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Discord */}
          <article className="group relative overflow-hidden rounded-xl border border-card-border bg-card p-6 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-secondary/35 hover:shadow-lg sm:p-7">
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-secondary"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-secondary/10 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden="true"
            />

            <div className="relative z-10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-secondary/30 bg-secondary/10 text-secondary">
                      <DiscordGlyph className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-heading-sm font-semibold text-foreground">Discord</h3>
                      <p className="text-body-xs text-muted">Official server</p>
                    </div>
                  </div>
                  <p className="mt-4 max-w-md text-body leading-relaxed text-muted">
                    Coordinate campaigns, report bugs, and talk politics with players and admins who
                    are active every day.
                  </p>
                </div>
              </div>

              <DiscordMemberStat stats={stats} loading={loading} />

              <ExternalCta href={COMMUNITY_DISCORD_URL} accent="discord">
                <DiscordGlyph className="h-4 w-4" />
                Join Discord
              </ExternalCta>
            </div>
          </article>

          {/* Patreon */}
          <article className="group relative overflow-hidden rounded-xl border border-card-border bg-card p-6 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-gold/35 hover:shadow-lg sm:p-7">
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gold"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/10 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden="true"
            />

            <div className="relative z-10">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                  <PatreonGlyph className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-heading-sm font-semibold text-foreground">Patreon</h3>
                  <p className="text-body-xs text-muted">Support the project</p>
                </div>
              </div>

              <p className="mt-4 max-w-md text-body leading-relaxed text-muted">
                Optional monthly support helps fund servers and development. Supporters unlock
                cosmetic perks, ad preferences, and a private channel on Discord.
              </p>

              <ul className="mt-5 space-y-2 text-body-sm text-muted">
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold"
                    aria-hidden="true"
                  />
                  Profile borders and highlight colors
                </li>
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold"
                    aria-hidden="true"
                  />
                  Ad-free or player-ad-only browsing
                </li>
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold"
                    aria-hidden="true"
                  />
                  Access to #patreon-support on Discord
                </li>
              </ul>

              <ExternalCta href={COMMUNITY_PATREON_URL} accent="patreon">
                <PatreonGlyph className="h-4 w-4" />
                Support on Patreon
              </ExternalCta>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
