"use client";

import { useTranslations } from "next-intl";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import type { MapOfficeholder } from "@/lib/map/officeholderService";
import type { RegionCell } from "@/components/maps/RegionalGeoMap";
import { chamberBreakdown, type AtlasBar } from "./atlasModel";
import styles from "./atlas.module.css";

const OFFICE_ORDER: Record<string, number> = { governor: 0, senate: 1, house: 2 };
const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function OfficeholderCard({ holder }: { holder: MapOfficeholder }) {
  const t = useTranslations("elections.atlas");
  return (
    <div className={styles.holder}>
      <Avatar url={holder.avatarUrl} name={holder.name} size="h-12 w-12" />
      <div className="min-w-0">
        <p className={styles.overline}>{t(holder.office as "house" | "senate" | "governor")}</p>
        <p className="font-semibold leading-snug">{holder.name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <span className={styles.dot} style={{ background: holder.color }} />
          {holder.partyName}
        </p>
      </div>
    </div>
  );
}

export function AtlasTooltip({
  id,
  data,
  cell,
  mode,
}: {
  id: string;
  data: MapOverviewResponse | null;
  cell?: RegionCell;
  mode: string;
}) {
  const t = useTranslations("elections.atlas");
  const region = data?.regions?.find((r) => r.id === id);
  const holders = data?.officeholders?.[id] ?? [];
  const relevant = holders.filter((h) =>
    ["house", "senate", "governor"].includes(mode) ? h.office === mode : h.office === "governor"
  );
  return (
    <div className={styles.tooltip}>
      <div className="flex items-center justify-between gap-3">
        <span className={styles.overline}>{t("briefing")}</span>
        <span className="font-mono text-muted">{id}</span>
      </div>
      <h3 className="mt-1 text-lg font-semibold text-foreground">{region?.name ?? id}</h3>
      <p className="mt-1 text-sm text-muted">
        {cell?.label === id ? t(mode as "house") : (cell?.label ?? t("noData"))}
      </p>
      {relevant.slice(0, 2).map((h) => (
        <OfficeholderCard key={h.id} holder={h} />
      ))}
      {relevant.length > 2 && (
        <p className="mt-2 text-xs text-muted">
          {t("moreHolders", { count: relevant.length - 2 })}
        </p>
      )}
    </div>
  );
}

export function AtlasBars({ rows, unit }: { rows: AtlasBar[]; unit: string }) {
  const t = useTranslations("elections.atlas");
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <p className="py-5 text-sm text-muted">{t("noChart")}</p>;
  return (
    <div className={styles.bars}>
      {rows.map((row) => (
        <div key={row.id}>
          <div className="mb-1.5 flex justify-between gap-3 text-xs">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 font-mono text-muted">
              {unit === t("seats")
                ? t("seatCount", { count: row.value })
                : `${compact(row.value)} ${unit}`}
            </span>
          </div>
          <div className={styles.track}>
            <div
              className={styles.bar}
              style={{ width: `${Math.max(0, (row.value / max) * 100)}%`, background: row.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AtlasBreakdown({
  data,
  mode,
  cells,
  values,
  valueUnit,
}: {
  data: MapOverviewResponse;
  mode: string;
  cells: Record<string, RegionCell>;
  values?: Record<string, number>;
  valueUnit?: string;
}) {
  const t = useTranslations("elections.atlas");
  const regions = data.regions ?? [];
  const holders = regions.flatMap((r) => data.officeholders?.[r.id] ?? []);
  const isChamber = ["house", "senate", "governor"].includes(mode);
  let rows: AtlasBar[];
  let unit = t("states");
  let note: string;
  if (values) {
    rows = regions
      .flatMap((r) =>
        Number.isFinite(values[r.id])
          ? [
              {
                id: r.id,
                label: r.name,
                value: values[r.id],
                color: cells[r.id]?.color ?? "#38bdf8",
              },
            ]
          : []
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    unit = valueUnit ?? "";
    note = t("ranking");
  } else if (mode === "presidential") {
    rows = Object.entries(data.presidentialElectoralVotes ?? {})
      .map(([id, value]) => ({
        id,
        value,
        label: data.presidentialCandidateNames?.[id] ?? id,
        color: data.presidentialCandidateColors?.[id] ?? "#8b5cf6",
      }))
      .sort((a, b) => b.value - a.value);
    unit = t("electoralVotes");
    note = t("presidentialNote");
  } else if (isChamber) {
    rows = chamberBreakdown(holders, mode);
    unit = mode === "governor" ? t("governor") : t("seats");
    note = t(`${mode}Note` as "houseNote" | "senateNote" | "governorNote");
  } else if (mode === "population" || mode === "representation") {
    rows = regions
      .map((r) => ({
        id: r.id,
        label: r.name,
        value: mode === "population" ? r.population : r.seats,
        color: cells[r.id]?.color ?? "#38bdf8",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    unit = mode === "population" ? t("people") : t("seats");
    note = t(mode === "population" ? "populationNote" : "representationNote");
  } else if (mode === "approval") {
    rows = [
      { id: "low", label: t("below"), color: "#f59e0b", value: 0 },
      { id: "high", label: t("above"), color: "#34d399", value: 0 },
    ];
    for (const r of regions) {
      const a = data.approval[r.id]?.approval;
      if (Number.isFinite(a)) rows[a < 50 ? 0 : 1].value++;
    }
    note = t("meanNote");
  } else {
    const grouped = new Map<string, AtlasBar>();
    for (const r of regions) {
      const cell = cells[r.id];
      if (!cell) continue;
      const label = cell.label ?? t("noData");
      const row = grouped.get(label) ?? { id: label, label, color: cell.color, value: 0 };
      row.value++;
      grouped.set(label, row);
    }
    rows = [...grouped.values()].sort((a, b) => b.value - a.value).slice(0, 8);
    note = t("distribution");
  }
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <Card className={styles.panel}>
      <p className={styles.overline}>{t("national")}</p>
      <h3 className="mt-1 text-lg font-semibold">{t(mode as "house")}</h3>
      {isChamber && total > 0 && (
        <div className={styles.composition} aria-label={t("distribution")}>
          {rows.map((r) => (
            <div
              key={r.id}
              title={`${r.label}: ${r.value}`}
              style={{ flex: r.value, background: r.color }}
            />
          ))}
        </div>
      )}
      <AtlasBars rows={rows} unit={unit} />
      <p className="mt-4 text-xs leading-relaxed text-muted">{note}</p>
    </Card>
  );
}

export function AtlasInspector({
  id,
  data,
  cells,
  onOpen,
  onClear,
  mode,
}: {
  id: string | null;
  data: MapOverviewResponse;
  cells: Record<string, RegionCell>;
  mode: string;
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("elections.atlas");
  const region = data.regions?.find((r) => r.id === id);
  if (!id || !region)
    return (
      <Card className={styles.panel}>
        <p className={styles.overline}>{t("inspect")}</p>
        <h3 className="text-lg font-semibold">{t("select")}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("selectHint")}</p>
      </Card>
    );
  const holders = data.officeholders?.[id] ?? [];
  const approval = data.approval[id]?.approval;
  const politicalMode = ["house", "senate", "governor"].includes(mode) ? mode : null;
  const seats = politicalMode ? chamberBreakdown(holders, politicalMode) : [];
  const visibleHolders = politicalMode
    ? holders.filter((h) => h.office === politicalMode)
    : holders;
  return (
    <Card className={styles.panel}>
      <div className="flex items-center justify-between">
        <p className={styles.overline}>{t("selected")}</p>
        <button className={styles.iconButton} onClick={onClear} aria-label={t("clear")}>
          ×
        </button>
      </div>
      <div className="mt-2 flex items-start gap-3">
        <span className={styles.stateBadge} style={{ borderColor: cells[id]?.color }}>
          {id}
        </span>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{region.name}</h2>
          <p className="mt-1 text-xs text-muted">{region.grouping}</p>
        </div>
      </div>
      {mode === "population" && (
        <p className="mt-4 text-body text-muted">
          {t("population")}: {compact(region.population)}
        </p>
      )}
      {mode === "approval" && (
        <p className="mt-4 text-body text-muted">
          {t("approval")}: {Number.isFinite(approval) ? `${approval.toFixed(1)}%` : t("noData")}
        </p>
      )}
      {!politicalMode && (
        <div className="my-4 rounded-lg bg-background p-3 text-xs leading-relaxed text-muted">
          {cells[id]?.tooltip?.length
            ? cells[id].tooltip?.map((line, i) => <p key={i}>{line}</p>)
            : (cells[id]?.label ?? t("noData"))}
        </div>
      )}
      {seats.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-3 text-sm font-semibold">
            {t(politicalMode as "house" | "senate" | "governor")}
          </h3>
          <AtlasBars rows={seats} unit={t("seats")} />
        </div>
      )}
      <h3 className="text-sm font-semibold">{t("seated")}</h3>
      {!visibleHolders.length && <p className="mt-2 text-xs text-muted">{t("noHolders")}</p>}
      <div className={styles.holderList}>
        {[...visibleHolders]
          .sort((a, b) => (OFFICE_ORDER[a.office] ?? 3) - (OFFICE_ORDER[b.office] ?? 3))
          .map((holder) => (
            <OfficeholderCard key={holder.id} holder={holder} />
          ))}
      </div>
      <Button variant="secondary" className="w-full" onClick={() => onOpen(id)}>
        {t("openState")}
      </Button>
    </Card>
  );
}
