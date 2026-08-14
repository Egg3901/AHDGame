"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PATREON_BORDER_OPTIONS, PATREON_HIGHLIGHT_COLORS } from "@/lib/db/types";
import type {
  PatreonBorderOption,
  ProfileBorderKey,
  PatreonTier,
  SupporterProvider,
} from "@/lib/db/types";
import { ProfileBorder } from "@/components/patreon/ProfileBorder";
import { LocalTime } from "@/components/time/LocalTime";

type PatreonAdPreference = "ad-free" | "player-only" | "all-ads";

interface PatreonState {
  patreonTier: PatreonTier;
  supporterProvider: SupporterProvider;
  patreonExpiresAt: string | null;
  adsDisabled: boolean;
  patreonAdPreference: PatreonAdPreference;
  patreonHighlightColor: string | null;
  patreonProfileBorder: ProfileBorderKey | null;
  isPatronActive: boolean;
  isAdmin: boolean;
}

const PATREON_SUBSCRIBE_URL =
  process.env.NEXT_PUBLIC_PATREON_URL ?? "https://www.patreon.com/cw/AHouseDividedGame/membership";
const LAKESIDE_ACCOUNT_URL = "https://lakesidegames.net/account";
const DISCORD_URL = "https://discord.gg/DmF8zJJuqN";
const SUPPORTER_GROUPS = new Set(["default", "static"]);
const SURFACE_CLASS =
  "relative overflow-hidden rounded-3xl border border-card-border/80 bg-gradient-to-br from-card via-card to-card-elevated/55 shadow-sm";

function formatTierLabel(tier: PatreonTier): string {
  if (tier === "supporter-plus-plus") return "Supporter++";
  if (tier === "supporter-plus") return "Supporter+";
  if (tier === "supporter") return "Supporter";
  return "Not subscribed";
}

function getAccessLevel(
  state: PatreonState | null | undefined
): "signed-out" | "guest" | "supporter" | "supporter-plus" {
  if (state === undefined) return "signed-out";
  if (state?.isAdmin) return "supporter-plus";
  if (!state?.isPatronActive || state.patreonTier === null) return "guest";
  // Supporter++ unlocks everything Supporter+ does.
  if (state.patreonTier === "supporter-plus" || state.patreonTier === "supporter-plus-plus")
    return "supporter-plus";
  return "supporter";
}

function isBorderUnlocked(
  option: PatreonBorderOption,
  accessLevel: ReturnType<typeof getAccessLevel>
) {
  if (accessLevel === "supporter-plus") return true;
  if (accessLevel === "supporter") return SUPPORTER_GROUPS.has(option.group);
  return false;
}

function FrostedOverlay({
  title,
  description,
  buttonLabel = "Subscribe on Patreon",
}: {
  title: string;
  description: string;
  buttonLabel?: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-background/50 backdrop-blur-[4px]">
      <div className="pointer-events-auto mx-4 max-w-[15rem] rounded-2xl border border-white/15 bg-background/78 px-4 py-3 text-center shadow-xl">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted">{description}</p>
        <Link
          href={PATREON_SUBSCRIBE_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center justify-center rounded-lg border border-primary/35 bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/18"
        >
          {buttonLabel}
        </Link>
      </div>
    </div>
  );
}

function TierPreviewCard({
  name,
  price,
  highlighted = false,
  description,
  benefits,
}: {
  name: string;
  price: string;
  highlighted?: boolean;
  description: string;
  benefits: string[];
}) {
  return (
    <div
      className={`rounded-3xl border p-5 ${
        highlighted
          ? "border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card-elevated/70 shadow-sm"
          : "border-card-border/80 bg-gradient-to-br from-card via-card to-card-elevated/45"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-foreground">{name}</p>
          <p className="mt-1 text-sm text-muted">{price}</p>
        </div>
        {highlighted && (
          <div className="rounded-full border border-primary/30 bg-primary/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Highlighted
          </div>
        )}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
          What&apos;s included
        </p>
        <div className="mt-3 space-y-2">
          {benefits.map((benefit) => (
            <div key={benefit} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-[2px] text-primary">•</span>
              <span>{benefit}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PatreonBenefitsSection() {
  const [state, setState] = useState<PatreonState | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const accessLevel = getAccessLevel(state);
  const tintColor = state?.patreonHighlightColor ?? PATREON_HIGHLIGHT_COLORS.default;
  const isStripe = state?.supporterProvider === "stripe";
  const baseTierLabel = formatTierLabel(state?.patreonTier ?? null);
  // Stripe subscribers came in through the Lakeside account portal, not Patreon,
  // so show provider-neutral wording and point manage links at their portal.
  const tierLabel =
    isStripe && state?.patreonTier ? `${baseTierLabel} (Lakeside subscription)` : baseTierLabel;
  const membershipHeading = isStripe ? "Supporter Benefits" : "Patreon Benefits";
  const manageUrl = isStripe ? LAKESIDE_ACCOUNT_URL : PATREON_SUBSCRIBE_URL;
  const manageLabel = isStripe ? "Manage subscription" : "View Patreon Benefits";

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.status === 401) {
          setState(undefined);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data?.user) {
          setState(null);
          return;
        }

        setState({
          patreonTier: data.user.patreonTier,
          supporterProvider: data.user.supporterProvider ?? null,
          patreonExpiresAt: data.user.patreonExpiresAt,
          adsDisabled: Boolean(data.user.adsDisabled),
          patreonAdPreference:
            data.user.patreonAdPreference ?? (data.user.adsDisabled ? "ad-free" : "all-ads"),
          patreonHighlightColor: data.user.patreonHighlightColor,
          patreonProfileBorder: data.user.patreonProfileBorder,
          isPatronActive: Boolean(data.user.isPatronActive),
          isAdmin: Boolean(data.user.isAdmin),
        });
      })
      .catch(() => setState(null));
  }, []);

  const groups = useMemo(
    () => [
      { id: "default", label: "Default" },
      { id: "static", label: "Tinted Static" },
      { id: "animated", label: "Animated" },
      { id: "frame", label: "Frames" },
    ],
    []
  );

  async function save(patch: Partial<PatreonState>) {
    if (!state?.isPatronActive) return;

    const next = { ...state, ...patch };
    setState(next);
    setSaving(true);
    setError("");
    setSaved("");

    try {
      const res = await fetch("/api/settings/patreon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save Patreon settings");
        setState(state);
        return;
      }
      setSaved("Patreon settings saved.");
    } catch {
      setError("Failed to save Patreon settings");
      setState(state);
    } finally {
      setSaving(false);
    }
  }

  const lockedOverlay =
    accessLevel === "signed-out"
      ? {
          title: "Sign in for supporter controls",
          description: "Sign in to change ad settings, tint color, and borders.",
        }
      : accessLevel === "guest"
        ? {
            title: "Subscribe to unlock this",
            description: "Supporter unlocks ad settings, tint color, and static borders.",
          }
        : null;

  return (
    <div className="space-y-6">
      {(accessLevel === "guest" || accessLevel === "signed-out") && (
        <div className={`${SURFACE_CLASS} p-5 md:p-6`}>
          <div className="mb-4">
            <h5 className="text-lg font-semibold text-foreground">Membership Tiers</h5>
            <p className="mt-1 text-sm text-muted">
              Pick a tier before unlocking the settings below.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <TierPreviewCard
              name="Supporter"
              price="$4.99 / month"
              description="Support the game development and server costs, with ad-free browsing, free banner ads, and core supporter cosmetics."
              benefits={[
                "Ad-free content",
                "1 free player banner ad every 72 hours (featured on news page and more)",
                "Access to supporter chat",
                "Supporter badge in-game and in Discord",
                "Animated GIF profile picture upload",
                "Cosmetic benefits in game: PFP frame and profile color selection",
              ]}
            />
            <TierPreviewCard
              name="Supporter+"
              price="$9.99 / month"
              highlighted
              description="Support the game development and unlock the full cosmetic set, permanent supporter achievement, and premium patron perks."
              benefits={[
                "Ad-free content",
                "2 free player banner ads every 48 hours (featured on news page and more)",
                "Cosmetic benefits in game: PFP frame and profile color selection",
                "Achievement in game",
                "Access to supporter chat",
                "Future access to development/sandbox server (not currently implemented)",
                "Animated profile frames and additional styles",
              ]}
            />
          </div>
        </div>
      )}

      <div className={`${SURFACE_CLASS} p-5 md:p-6`}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-primary/12 via-primary/5 to-transparent"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Membership
            </div>
            <div>
              <h4 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                {membershipHeading}
              </h4>
              <p className="mt-1 text-sm text-muted">
                Supporter status: <span className="font-medium text-foreground">{tierLabel}</span>.
              </p>
            </div>
          </div>
          <Link
            href={manageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/16"
          >
            {manageLabel}
          </Link>
        </div>
        <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-card-border/70 bg-background/45 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
              Access
            </p>
            <p className="mt-1 text-sm text-foreground">
              Supporter gets tint color, ad controls, and static borders. Supporter+ adds animated
              borders and frames.
            </p>
          </div>
          <div className="rounded-2xl border border-card-border/70 bg-background/45 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
              Status
            </p>
            <p className="mt-1 text-sm text-foreground">
              {state?.patreonExpiresAt ? (
                // wall-clock by design: patreon subscription billing runs on real time
                <>
                  Benefits active until{" "}
                  <LocalTime value={state.patreonExpiresAt} options={{ dateStyle: "medium" }} />.
                </>
              ) : accessLevel === "supporter" || accessLevel === "supporter-plus" ? (
                "Membership is currently active."
              ) : (
                "Previewing locked supporter controls."
              )}
            </p>
          </div>
        </div>
      </div>

      <div className={SURFACE_CLASS}>
        <div className={`${lockedOverlay ? "opacity-60" : ""} space-y-4 p-5`}>
          <div>
            <p className="text-base font-semibold text-foreground">Ad preference</p>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Supporters default to ad-free and can decide what third-party and player ads appear
              for them.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                key: "ad-free" as const,
                label: "Ad-Free",
                description: "Default for subscribers. No ads shown.",
              },
              {
                key: "player-only" as const,
                label: "Player Ads",
                description: "Show player-run banner ads to support the community.",
              },
            ].map((option) => {
              const pref = state?.patreonAdPreference ?? "all-ads";
              const selected =
                pref === option.key || (pref === "all-ads" && option.key === "player-only");
              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={!state?.isPatronActive}
                  onClick={() =>
                    void save({
                      patreonAdPreference: option.key,
                      adsDisabled: option.key === "ad-free",
                    })
                  }
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    selected
                      ? "border-primary/45 bg-primary/10 shadow-sm"
                      : "border-card-border/80 bg-background/55 hover:border-primary/30"
                  } ${!state?.isPatronActive ? "cursor-default" : ""}`}
                >
                  <p className="text-sm font-medium text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs text-muted">{option.description}</p>
                </button>
              );
            })}
          </div>
        </div>
        {lockedOverlay && <FrostedOverlay {...lockedOverlay} />}
      </div>

      <div className={SURFACE_CLASS}>
        <div className={`${lockedOverlay ? "opacity-60" : ""} space-y-3 p-5`}>
          <div>
            <label className="block text-base font-semibold text-foreground">Highlight Color</label>
            <p className="mt-1 text-sm text-muted">
              Used for supporter accents and all tint-aware profile borders.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-card-border/80 bg-background/50 px-4 py-4">
            <input
              type="color"
              value={tintColor}
              disabled={!state?.isPatronActive}
              onChange={(e) => void save({ patreonHighlightColor: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded border border-card-border bg-transparent disabled:cursor-default"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Custom highlight tint</p>
              <p className="text-xs text-muted">
                Applies anywhere the profile uses supporter tint.
              </p>
            </div>
            <code className="ml-auto rounded-lg bg-card px-2.5 py-1.5 text-xs text-muted">
              {tintColor}
            </code>
          </div>
        </div>
        {lockedOverlay && <FrostedOverlay {...lockedOverlay} />}
      </div>

      <div className={`${SURFACE_CLASS} p-5`}>
        <div>
          <label className="block text-lg font-semibold text-foreground">Profile Border</label>
          <p className="mt-1 text-sm text-muted">
            Supporter unlocks default and tinted static borders. Supporter+ unlocks animated borders
            and frame styles.
          </p>
        </div>

        {groups.map((group) => {
          const options = PATREON_BORDER_OPTIONS.filter((option) => option.group === group.id);
          if (options.length === 0) return null;

          return (
            <div key={group.id} className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
                {group.label}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {options.map((option) => {
                  const selected = state?.patreonProfileBorder === option.key;
                  const unlocked = isBorderUnlocked(option, accessLevel);
                  const showLock = !unlocked;

                  return (
                    <div key={option.key} className="relative overflow-hidden rounded-2xl">
                      <button
                        type="button"
                        disabled={!unlocked || !state?.isPatronActive}
                        onClick={() =>
                          void save({
                            patreonProfileBorder: selected ? null : option.key,
                          })
                        }
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selected
                            ? "border-primary/50 bg-primary/10 shadow-sm"
                            : "border-card-border/80 bg-background/50 hover:border-primary/30"
                        } ${showLock ? "opacity-65" : ""} ${!unlocked ? "cursor-default" : ""}`}
                      >
                        <div className="mb-3 flex items-center justify-center rounded-2xl bg-background/45 py-4">
                          <ProfileBorder borderKey={option.key} tintColor={tintColor}>
                            <div className="flex h-16 w-16 items-center justify-center rounded-[1.1rem] bg-card text-lg font-bold text-foreground">
                              A
                            </div>
                          </ProfileBorder>
                        </div>
                        <p className="text-sm font-medium text-foreground">{option.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                          {option.tintable
                            ? "Uses your selected tint color."
                            : "Fixed theme style."}
                        </p>
                      </button>

                      {showLock && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-background/38 backdrop-blur-[2px]">
                          <div className="rounded-full border border-white/10 bg-background/70 px-3 py-1 text-[11px] font-medium text-foreground shadow">
                            {accessLevel === "supporter"
                              ? "Supporter+ only"
                              : group.id === "animated"
                                ? "Supporter+ animated"
                                : group.id === "frame"
                                  ? "Supporter+ frames"
                                  : "Supporter unlock"}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {(error || saved) && state?.isPatronActive && (
        <p className={`text-sm ${error ? "text-error" : "text-success"}`}>
          {error || saved}
          {saving ? " Saving..." : ""}
        </p>
      )}

      <div className={`${SURFACE_CLASS} p-5 md:p-6`}>
        <div className="mb-4">
          <h5 className="text-base font-semibold text-foreground">Claiming Benefits & Support</h5>
          <p className="mt-1 text-sm text-muted">
            Patreon benefits are applied automatically when you link your Patreon account. If your
            benefits are missing or incorrect, you have two options:
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-card-border/70 bg-background/45 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 text-primary">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.05a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Submit a Discord ticket</p>
                <p className="mt-1 text-xs text-muted">
                  Join our Discord server and open a support ticket in the{" "}
                  <span className="font-medium text-foreground">#patreon-support</span> channel to
                  claim or fix your benefits.
                </p>
                <Link
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/16"
                >
                  Open Discord
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-card-border/70 bg-background/45 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 text-primary">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Report an issue</p>
                <p className="mt-1 text-xs text-muted">
                  Use the in-game feedback tool or contact page to report a Patreon benefit issue
                  directly to the team.
                </p>
                <Link
                  href="/contact"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-card-border/80 bg-background/55 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  Contact page
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
