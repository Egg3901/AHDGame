"use client";

import Image from "next/image";
import {
  STAT_KEYS,
  STAT_MIN,
  STAT_MAX,
  STAT_FREE_POINTS,
  ENERGY_BASE_ACTION_CAP,
  ENERGY_MAX_ACTION_CAP,
  type CharacterStats,
  type StatKey,
} from "@/lib/stats/statsConstants";
import { STAT_META, statBonus } from "@/lib/stats/statMeta";
import { CDN_ACTION_IMAGE_URLS } from "@/lib/images/staticCdnAssets";

/** Free points spent so far above the 1-floor on every stat. */
export function pointsSpent(stats: CharacterStats): number {
  return STAT_KEYS.reduce((sum, k) => sum + (stats[k] - STAT_MIN), 0);
}

/** Remaining distributable points (0 when a build is complete/legal). */
export function pointsRemaining(stats: CharacterStats): number {
  return STAT_FREE_POINTS - pointsSpent(stats);
}

/**
 * Backdrop art per stat — the action each stat actually powers, so the image
 * reinforces the mechanic rather than decorating it. Statecraft is trained by
 * whipping and filibustering, neither of which has an action image, so it falls
 * back to the neutral actions hero.
 */
const STAT_BACKDROP: Record<StatKey, string> = {
  charisma: CDN_ACTION_IMAGE_URLS.campaign,
  debate: CDN_ACTION_IMAGE_URLS.debatePrep,
  energy: CDN_ACTION_IMAGE_URLS.canvass,
  fundraising: CDN_ACTION_IMAGE_URLS.fundraise,
  businessAcumen: CDN_ACTION_IMAGE_URLS.convertCash,
  statecraft: CDN_ACTION_IMAGE_URLS.hero,
  intellect: CDN_ACTION_IMAGE_URLS.poll,
};

/**
 * A build is flagged as lopsided once the spread between the best and worst
 * stat opens this far while at least two stats are still on the floor. Advisory
 * only — the allocation is legal, it just carries a real cost.
 */
const LOPSIDED_SPREAD = 6;

export function isLopsided(stats: CharacterStats): boolean {
  const values = STAT_KEYS.map((k) => stats[k]);
  const atFloor = values.filter((v) => v <= STAT_MIN).length;
  return Math.max(...values) - Math.min(...values) >= LOPSIDED_SPREAD && atFloor >= 2;
}

interface StatPointAllocatorProps {
  value: CharacterStats;
  onChange: (next: CharacterStats) => void;
}

/**
 * Spread `points` free points over `keys` as evenly as the 1 to 10 band allows,
 * starting from the current build. Used by the quick-allocate controls so a
 * player is not obliged to make {@link STAT_FREE_POINTS} separate clicks.
 */
function spreadPoints(base: CharacterStats, keys: readonly StatKey[], points: number) {
  const next = { ...base };
  let left = points;
  // Round-robin rather than a big step on one stat: an even spread is the
  // neutral opener, and anyone who wants a spike can still click from here.
  while (left > 0) {
    const raisable = keys.filter((k) => next[k] < STAT_MAX);
    if (raisable.length === 0) break;
    for (const key of raisable) {
      if (left <= 0) break;
      next[key] += 1;
      left -= 1;
    }
  }
  return next;
}

/**
 * Controlled point-buy allocator. Each stat ranges 1 to 10; the caller
 * distributes exactly STAT_FREE_POINTS on top of the floor. Nothing is
 * pre-assigned: every stat opens on the floor so all the points are spent
 * deliberately.
 */
export function StatPointAllocator({ value, onChange }: StatPointAllocatorProps) {
  const remaining = pointsRemaining(value);
  const lopsided = isLopsided(value);

  const adjust = (key: StatKey, delta: number) => {
    const nextVal = value[key] + delta;
    if (nextVal < STAT_MIN || nextVal > STAT_MAX) return;
    if (delta > 0 && remaining <= 0) return;
    onChange({ ...value, [key]: nextVal });
  };

  const spendRemainingEvenly = () => {
    if (remaining <= 0) return;
    onChange(spreadPoints(value, STAT_KEYS, remaining));
  };

  const resetBuild = () => onChange(defaultStatBuild());

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border bg-background/50 px-4 py-3">
        <div>
          <span className="block text-sm font-medium text-foreground">Points remaining</span>
          <span className="block text-body-xs text-muted">
            Spend all {STAT_FREE_POINTS} to continue
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* {STAT_FREE_POINTS} points at one click each is a lot of clicking for
              a player who just wants a rounded opener. */}
          <button
            type="button"
            onClick={spendRemainingEvenly}
            disabled={remaining <= 0}
            className="rounded-md border border-card-border bg-background px-2.5 py-1.5 text-body-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Spread evenly
          </button>
          <button
            type="button"
            onClick={resetBuild}
            disabled={remaining >= STAT_FREE_POINTS}
            className="rounded-md border border-card-border bg-background px-2.5 py-1.5 text-body-xs font-semibold text-muted transition-colors hover:border-error/40 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
          <span
            className={`text-2xl font-bold tabular-nums ${
              remaining === 0 ? "text-success" : "text-primary"
            }`}
          >
            {remaining}
          </span>
        </div>
      </div>

      {lopsided && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-body-sm text-warning"
        >
          <p className="font-semibold">That is a very lopsided build.</p>
          <p className="mt-1 leading-relaxed">
            A stat left on {STAT_MIN} runs at{" "}
            <span className="font-mono">{statBonus("charisma", STAT_MIN).label}</span> effectiveness
            on everything it powers, against{" "}
            <span className="font-mono">{statBonus("charisma", STAT_MAX).label}</span> at {STAT_MAX}
            . Energy is harsher: at {STAT_MIN} your action stockpile tops out at{" "}
            <span className="font-mono">{ENERGY_BASE_ACTION_CAP}</span> instead of{" "}
            <span className="font-mono">{ENERGY_MAX_ACTION_CAP}</span>. Unused stats also decay over
            time, so a dumped stat tends to stay dumped. Specialising is a valid choice — just go in
            knowing the cost.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {STAT_KEYS.map((key) => {
          const meta = STAT_META[key];
          const val = value[key];
          const bonus = statBonus(key, val);
          return (
            <div
              key={key}
              className="relative overflow-hidden rounded-lg border border-card-border bg-card/50"
            >
              {/* Backdrop: the action this stat powers. */}
              <Image
                src={STAT_BACKDROP[key]}
                alt=""
                aria-hidden
                fill
                sizes="(min-width: 640px) 40rem, 100vw"
                unoptimized
                className="pointer-events-none object-cover object-center opacity-[0.10]"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-r from-card/95 via-card/85 to-card/60"
              />

              <div className="relative flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                    <span
                      className="rounded border border-card-border bg-background/70 px-1.5 font-mono text-body-xs font-semibold text-foreground"
                      title={bonus.detail}
                    >
                      {bonus.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-muted">{meta.blurb}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Lower ${meta.label}`}
                    onClick={() => adjust(key, -1)}
                    disabled={val <= STAT_MIN}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-card-border bg-background text-lg font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-lg font-bold tabular-nums text-foreground">
                    {val}
                  </span>
                  <button
                    type="button"
                    aria-label={`Raise ${meta.label}`}
                    onClick={() => adjust(key, 1)}
                    disabled={val >= STAT_MAX || remaining <= 0}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-card-border bg-background text-lg font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The opening build: every stat on the floor, all {@link STAT_FREE_POINTS}
 * still to spend, so nothing is pre-assigned for the player.
 */
export function defaultStatBuild(): CharacterStats {
  return STAT_KEYS.reduce((acc, k) => {
    acc[k] = STAT_MIN;
    return acc;
  }, {} as CharacterStats);
}
