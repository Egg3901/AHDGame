import { CountryFlag } from "@/components/CountryFlag";
import type { ReferendumStatus } from "@/lib/db/types/referendum";
import { CampaignStatusPill } from "./CampaignStatusPill";

export interface MastheadTile {
  label: string;
  value: string;
  sub?: string;
  tone?: "fg" | "yes" | "no" | "amber";
}

const TILE_TONE: Record<NonNullable<MastheadTile["tone"]>, string> = {
  fg: "text-foreground",
  yes: "text-[var(--ref-yes)]",
  no: "text-[var(--ref-no)]",
  amber: "text-[var(--ref-amber)]",
};

/**
 * Emblem for a region-transfer referendum: two national flags filling the box,
 * split along the anti-diagonal (top-left ▸ bottomRight). Each flag covers the
 * whole box and is clipped to its triangle; a thin gold line marks the cut.
 */
function SplitFlagEmblem({ topLeft, bottomRight }: { topLeft: string; bottomRight: string }) {
  return (
    <div className="relative h-16 w-16 flex-none overflow-hidden rounded-xl border-2 border-[var(--ref-gold)]/60 bg-background/40">
      <div
        data-ref="emblem-br"
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(/api/flags/country/${bottomRight})`,
          clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
        }}
      />
      <div
        data-ref="emblem-tl"
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(/api/flags/country/${topLeft})`,
          clipPath: "polygon(0 0, 100% 0, 0 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, transparent calc(50% - 0.75px), var(--ref-gold) calc(50% - 0.75px), var(--ref-gold) calc(50% + 0.75px), transparent calc(50% + 0.75px))",
        }}
      />
    </div>
  );
}

/**
 * Campaigns-panel masthead, used by both the hub (country) and the detail
 * (region) surfaces. Pure/props-driven; server-renderable. The `controls` slot
 * holds the admin preview-as-role toggle on the detail page.
 */
export function ReferendumMasthead({
  emblemCountry,
  registry,
  title,
  subtitle,
  statusPill,
  tiles,
  controls,
  accent = "neutral",
  emblemSeal,
  emblemSplit,
  watermark,
  viewingAs,
}: {
  countryId: string;
  emblemCountry: string;
  /** Two flags split along the anti-diagonal (transfer referendums); overrides
   *  the single `emblemCountry` flag when set. */
  emblemSplit?: { topLeft: string; bottomRight: string };
  registry: string;
  title: string;
  subtitle?: string;
  statusPill?: ReferendumStatus;
  tiles: MastheadTile[];
  controls?: React.ReactNode;
  /** `yes` paints a green campaigning gradient behind the header. */
  accent?: "yes" | "neutral";
  /** Circular crest, top-right (kind-aware text). */
  emblemSeal?: { line1: string; line2: string };
  /** Faded oversized watermark behind the header. */
  watermark?: string;
  /** A row under the title (the admin "Viewing as" control). */
  viewingAs?: React.ReactNode;
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
      <div
        className="relative px-6 pb-4 pt-5"
        style={
          accent === "yes"
            ? {
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--ref-yes) 22%, var(--card)) 0%, var(--card) 62%)",
              }
            : undefined
        }
      >
        {watermark && (
          <span className="pointer-events-none absolute right-6 top-1 select-none text-[68px] font-black leading-none tracking-tighter text-foreground/[0.06]">
            {watermark}
          </span>
        )}
        <div className="relative flex flex-wrap items-center gap-4">
          {emblemSplit ? (
            <SplitFlagEmblem topLeft={emblemSplit.topLeft} bottomRight={emblemSplit.bottomRight} />
          ) : (
            <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl border-2 border-[var(--ref-gold)]/60 bg-background/40">
              <CountryFlag country={emblemCountry} size="lg" />
            </div>
          )}
          <div className="min-w-[200px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              {registry}
            </div>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
              {statusPill && <CampaignStatusPill status={statusPill} />}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-background/40 px-2.5 py-1 text-[11px] font-semibold text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--success)]" />
                Live · turn-weighted
              </span>
            </div>
            {viewingAs && <div className="mt-3">{viewingAs}</div>}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {emblemSeal && (
              <div className="flex h-[72px] w-[72px] flex-none flex-col items-center justify-center rounded-full border-2 border-[var(--ref-yes)]/50 bg-background/40 px-1 text-center">
                <span className="text-[8px] font-bold uppercase leading-tight tracking-wide text-[var(--ref-yes)]">
                  {emblemSeal.line1}
                </span>
                <span className="mt-0.5 text-[8px] font-bold uppercase leading-tight tracking-wide text-muted">
                  {emblemSeal.line2}
                </span>
              </div>
            )}
            {controls && <div className="flex items-center gap-2">{controls}</div>}
          </div>
        </div>
      </div>
      <div
        className="h-0.5 opacity-80"
        style={{
          background:
            "linear-gradient(90deg,transparent,var(--ref-gold) 16%,var(--ref-amber) 50%,var(--ref-gold) 84%,transparent)",
        }}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] bg-background/40">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="flex min-w-0 flex-col gap-0.5 border-r border-t border-card-border px-4 py-3"
          >
            <span className="truncate text-[10px] font-bold uppercase tracking-wider text-muted">
              {t.label}
            </span>
            <span
              className={`truncate font-mono text-lg font-extrabold leading-tight ${
                TILE_TONE[t.tone ?? "fg"]
              }`}
            >
              {t.value}
            </span>
            {t.sub && <span className="truncate text-[11px] text-muted">{t.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
