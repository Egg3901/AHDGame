import { useTranslations } from "next-intl";
import { STAT_KEYS, STAT_MAX, type CharacterStats } from "@/lib/stats/statsConstants";
import { STAT_META, statBonus } from "@/lib/stats/statMeta";
import { deriveStatClass } from "@/lib/stats/statClass";
import { StatReallocateControl } from "@/components/stats/StatReallocateControl";
import { SectionHeader } from "./ProfileMeters";

/**
 * Read-only stat readout for the profile page. Each stat shows its value out
 * of 10, its current bonus and a thin neutral bar, with a hover/focus tooltip
 * describing what the stat does. Render only when the RPG-stats feature is
 * enabled and the character has an allocated stat block.
 */
export function CharacterStatsPanel({
  stats,
  canReallocate = false,
}: {
  stats: CharacterStats;
  /** Show the one-time free reallocation control (own profile, eligible only). */
  canReallocate?: boolean;
}) {
  const t = useTranslations("profile.stats");
  const statClass = deriveStatClass(stats);
  return (
    <section>
      <SectionHeader action={canReallocate ? <StatReallocateControl /> : undefined}>
        {t("title")}
      </SectionHeader>
      <div className="mb-3">
        <p className="text-body text-foreground">
          <span className="font-semibold">{statClass.name}</span>
          <span className="ml-2 text-muted">{statClass.pillars.join(" · ")}</span>
        </p>
        <p className="mt-0.5 text-body-sm leading-snug text-muted">{statClass.description}</p>
      </div>
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {STAT_KEYS.map((key) => {
          const value = Math.round(stats[key] ?? 1);
          const pct = (value / STAT_MAX) * 100;
          const { label, blurb } = STAT_META[key];
          const bonus = statBonus(key, value);
          return (
            <li
              key={key}
              tabIndex={0}
              aria-label={t("statAria", {
                label,
                value,
                max: STAT_MAX,
                detail: bonus.detail,
                blurb,
              })}
              className="group relative border-b border-card-border/60 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            >
              <div className="flex items-baseline gap-3">
                <span className="flex-1 text-body text-foreground">{label}</span>
                <span className="text-body-sm tabular-nums text-muted">{bonus.label}</span>
                <span className="text-body font-semibold tabular-nums text-foreground">
                  {value}
                  <span className="text-body-sm font-normal text-muted">/{STAT_MAX}</span>
                </span>
              </div>
              <div className="mt-2 h-1 w-full bg-card-border/60" aria-hidden>
                <div className="h-full bg-foreground/60" style={{ width: `${pct}%` }} />
              </div>

              {/* Tooltip */}
              <div
                role="tooltip"
                className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-60 max-w-[16rem] rounded-md border border-card-border bg-card p-3 text-left shadow-lg group-hover:visible group-focus-visible:visible"
              >
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-body font-semibold text-foreground">{label}</span>
                  <span className="ml-auto text-body-sm font-semibold tabular-nums text-muted">
                    {value}/{STAT_MAX}
                  </span>
                </div>
                <p className="mb-1 text-body-sm font-medium text-foreground">{bonus.detail}</p>
                <p className="text-body-sm leading-snug text-muted">{blurb}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
