import {
  Sparkles,
  Mic,
  Zap,
  Banknote,
  Briefcase,
  Landmark,
  Brain,
  type LucideIcon,
} from "lucide-react";
import { STAT_KEYS, STAT_MAX, type CharacterStats } from "@/lib/stats/statsConstants";
import type { StatKey } from "@/lib/stats/statsConstants";
import { STAT_META, statBonus } from "@/lib/stats/statMeta";
import { deriveStatClass } from "@/lib/stats/statClass";
import { StatReallocateControl } from "@/components/stats/StatReallocateControl";

/**
 * Per-stat icon + accent. Class strings are written out in full (no
 * interpolation) so Tailwind's scanner keeps them in the bundle.
 */
const STAT_STYLE: Record<StatKey, { Icon: LucideIcon; chip: string; icon: string; bar: string }> = {
  charisma: {
    Icon: Sparkles,
    chip: "bg-amber-500/15",
    icon: "text-amber-500",
    bar: "from-amber-400 to-amber-600",
  },
  debate: {
    Icon: Mic,
    chip: "bg-rose-500/15",
    icon: "text-rose-500",
    bar: "from-rose-400 to-rose-600",
  },
  energy: {
    Icon: Zap,
    chip: "bg-lime-500/15",
    icon: "text-lime-500",
    bar: "from-lime-400 to-lime-600",
  },
  fundraising: {
    Icon: Banknote,
    chip: "bg-emerald-500/15",
    icon: "text-emerald-500",
    bar: "from-emerald-400 to-emerald-600",
  },
  businessAcumen: {
    Icon: Briefcase,
    chip: "bg-cyan-500/15",
    icon: "text-cyan-500",
    bar: "from-cyan-400 to-cyan-600",
  },
  statecraft: {
    Icon: Landmark,
    chip: "bg-violet-500/15",
    icon: "text-violet-500",
    bar: "from-violet-400 to-violet-600",
  },
  intellect: {
    Icon: Brain,
    chip: "bg-sky-500/15",
    icon: "text-sky-500",
    bar: "from-sky-400 to-sky-600",
  },
};

/**
 * Read-only stat readout for the profile page. Each stat shows an accent icon,
 * its rounded value out of 10, and a proportional colored bar, with a hover/focus
 * tooltip describing what the stat does. Render only when the RPG-stats feature
 * is enabled and the character has an allocated stat block.
 */
export function CharacterStatsPanel({
  stats,
  canReallocate = false,
}: {
  stats: CharacterStats;
  /** Show the one-time free reallocation control (own profile, eligible only). */
  canReallocate?: boolean;
}) {
  const statClass = deriveStatClass(stats);
  return (
    <div className="rounded-xl border border-card-border bg-card/50 p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-2">
          <h2 className="text-lg font-semibold text-foreground">Stats</h2>
          {canReallocate && <StatReallocateControl />}
        </div>
        <div className="max-w-[60%] text-right">
          <div className="text-sm font-semibold text-foreground">{statClass.name}</div>
          <div className="text-xs text-muted">{statClass.pillars.join(" · ")}</div>
          <div className="mt-0.5 text-xs leading-snug text-muted">{statClass.description}</div>
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {STAT_KEYS.map((key) => {
          const value = Math.round(stats[key] ?? 1);
          const pct = (value / STAT_MAX) * 100;
          const { label, blurb } = STAT_META[key];
          const { Icon, chip, icon, bar } = STAT_STYLE[key];
          const bonus = statBonus(key, value);
          return (
            <div
              key={key}
              tabIndex={0}
              aria-label={`${label}: ${value} of ${STAT_MAX}. ${bonus.detail}. ${blurb}`}
              className="group relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${chip}`}
                >
                  <Icon className={`h-4 w-4 ${icon}`} aria-hidden />
                </span>
                <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
                <span className="text-xs font-semibold tabular-nums text-muted">{bonus.label}</span>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {value}
                  <span className="text-xs font-normal text-muted">/{STAT_MAX}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-card-muted">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${bar} transition-[width] duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Tooltip */}
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-60 max-w-[16rem] origin-bottom-left scale-95 rounded-lg border border-card-border bg-card p-3 text-left opacity-0 shadow-lg transition-all duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${icon}`} aria-hidden />
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                  <span className="ml-auto text-xs font-bold tabular-nums text-muted">
                    {value}/{STAT_MAX}
                  </span>
                </div>
                <p className={`mb-1 text-xs font-semibold ${icon}`}>{bonus.detail}</p>
                <p className="text-xs leading-snug text-muted">{blurb}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
