"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BLEND, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import { apiErrorText } from "@/lib/errors/catalog";
import { formatCurrency } from "@/lib/utils/formatters";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import type {
  FieldOfficeSubdivisionDto,
  FieldOfficeView,
} from "@/lib/campaigns/fieldOffices/queries";
import {
  formatPct,
  leanFill,
  leanLabel,
  pathCentre,
  pinRadius,
  valueFill,
} from "./fieldOfficeMapMath";

export interface FieldOfficesSectionProps {
  campaignId: string;
  /** Called after an open or close so the war chest and actions refresh. */
  onChanged: () => void;
  variant?: "desktop" | "mobile";
}

type ColorMode = "lean" | "value";

const BUTTON: React.CSSProperties = {
  border: `1px solid ${BLEND.chipBorder}`,
  background: "transparent",
  padding: "7px 13px",
  fontFamily: FONT.mono,
  fontSize: 10.5,
  letterSpacing: ".08em",
  fontWeight: 700,
  textTransform: "uppercase",
  color: BLEND.ink,
  cursor: "pointer",
};

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={BLEND_LABEL}>{label}</div>
      <div
        style={{
          marginTop: 4,
          fontFamily: FONT.mono,
          fontSize: 20,
          color: tone ?? BLEND.ink,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StrengthBar({ strength }: { strength: number }) {
  return (
    <span
      aria-label={`${Math.round(strength * 100)}% strength`}
      style={{
        display: "inline-block",
        width: 64,
        height: 6,
        borderRadius: 3,
        background: BLEND.track,
        overflow: "hidden",
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.round(strength * 100)}%`,
          background: strength >= 1 ? BLEND.positive : BLEND.caution,
        }}
      />
    </span>
  );
}

/**
 * Field offices: where the campaign has people on the ground.
 *
 * In county-scope countries this is a map of the selected state's counties,
 * shaded by lean (or by what a new office there would be worth), with a pin
 * on every county you already hold. Region-scope countries get one card per
 * region instead. Every figure comes from the server view, so the panel never
 * quotes a price or an effect the engine does not use.
 */
export function FieldOfficesSection({
  campaignId,
  onChanged,
  variant = "desktop",
}: FieldOfficesSectionProps) {
  const mobile = variant === "mobile";
  const [region, setRegion] = useState<string | null>(null);
  const [view, setView] = useState<FieldOfficeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ColorMode>("lean");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = region ? `?region=${encodeURIComponent(region)}` : "";
      const res = await fetch(`/api/campaigns/${campaignId}/field-offices${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(apiErrorText(data, "Could not load field offices."));
        return;
      }
      setLoadError(null);
      setView(data.fieldOffices as FieldOfficeView);
    } catch {
      setLoadError("Network error");
    }
  }, [campaignId, region]);

  useEffect(() => {
    void load();
  }, [load]);

  const subById = useMemo(
    () => new Map((view?.map?.subdivisions ?? []).map((s) => [s.id, s])),
    [view?.map]
  );
  const maxMarginal = useMemo(
    () => Math.max(0, ...(view?.map?.subdivisions ?? []).map((s) => s.marginalPct ?? 0)),
    [view?.map]
  );

  if (loadError && !view) {
    return (
      <Shell mobile={mobile}>
        <p style={{ color: BLEND.negative, fontFamily: FONT.sans, fontSize: 14 }}>{loadError}</p>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell mobile={mobile}>
        <p style={{ color: BLEND.mutedDim, fontFamily: FONT.mono, fontSize: 11 }}>Loading...</p>
      </Shell>
    );
  }
  if (!view.enabled) return null;

  const selectedRegion = view.regions.find((r) => r.id === view.selectedRegionId) ?? null;
  const canAct = view.canManage && view.raceActive;
  const atCap = view.offices.length >= view.cap;
  const funds = view.funds ?? 0;
  const actions = view.actions ?? 0;
  const currency = view.costs?.currency ?? "USD";
  const blockReason = !canAct
    ? null
    : atCap
      ? `This race allows ${view.cap} offices. Close one to open another.`
      : view.costs && funds < view.costs.open
        ? `Needs ${formatCurrency(view.costs.open, currency)} in the war chest.`
        : view.costs && actions < view.costs.actions
          ? `Needs ${view.costs.actions} campaign actions.`
          : null;

  const act = async (key: string, run: () => Promise<Response>, success: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await run();
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ ok: true, text: success });
        await load();
        onChanged();
      } else {
        setMessage({ ok: false, text: apiErrorText(data, "That did not work.") });
      }
    } catch {
      setMessage({ ok: false, text: "Network error" });
    } finally {
      setBusy(null);
    }
  };

  const openOffice = (regionId: string, subdivisionId: string | null, label: string) => {
    trackAction("campaign.field-office.open", { regionId, subdivisionId: subdivisionId ?? "" });
    return act(
      `open:${regionId}:${subdivisionId ?? ""}`,
      () =>
        fetch(`/api/campaigns/${campaignId}/field-offices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regionId, subdivisionId }),
        }),
      `Office opened in ${label}. It reaches full strength in ${view.rampTurns} turns.`
    );
  };
  const closeOffice = (officeId: string, label: string) => {
    trackAction("campaign.field-office.close", { officeId });
    return act(
      `close:${officeId}`,
      () => fetch(`/api/campaigns/${campaignId}/field-offices/${officeId}`, { method: "DELETE" }),
      `Closed the ${label} office.`
    );
  };

  const upkeepTotal = (view.costs?.upkeep ?? 0) * view.offices.length;
  const focus = (selected && subById.get(selected)) || (hovered && subById.get(hovered)) || null;

  return (
    <Shell mobile={mobile}>
      <h2
        style={{
          margin: "0 0 4px",
          fontFamily: FONT.sans,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        Field offices
      </h2>
      <p
        style={{
          margin: "0 0 18px",
          fontFamily: FONT.sans,
          fontSize: 14.5,
          lineHeight: 1.55,
          color: BLEND.muted,
          maxWidth: 680,
        }}
      >
        {view.scope === "county"
          ? `Put staff in a county and your voters there turn out in bigger numbers. Every office also lifts turnout across its state, with diminishing returns. Offices reach full strength over ${view.rampTurns} turns, so early ground counts.`
          : `Offices lift your turnout across the region they stand in. Up to ${view.maxPerRegion ?? 3} per region, with diminishing returns. Each reaches full strength over ${view.rampTurns} turns.`}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
          gap: 16,
          paddingBottom: 18,
          borderBottom: `1px solid ${BLEND.hairline}`,
        }}
      >
        <Figure label="Offices" value={`${view.offices.length}/${view.cap}`} />
        {view.costs ? (
          <Figure
            label="Upkeep per turn"
            value={formatCurrency(upkeepTotal, currency)}
            tone={upkeepTotal > 0 ? BLEND.caution : undefined}
          />
        ) : null}
        {view.costs ? (
          <Figure label="New office" value={formatCurrency(view.costs.open, currency)} />
        ) : null}
        {selectedRegion ? (
          <Figure
            label={`Turnout boost, ${selectedRegion.name}`}
            value={formatPct(selectedRegion.effectPct)}
            tone={selectedRegion.effectPct > 0 ? BLEND.positive : BLEND.muted}
          />
        ) : null}
      </div>

      {view.regions.length > 1 && view.scope === "county" ? (
        <RegionPicker
          regions={view.regions}
          value={view.selectedRegionId}
          onChange={(id) => {
            setSelected(null);
            setHovered(null);
            setRegion(id);
          }}
        />
      ) : null}

      {view.scope === "county" && view.map ? (
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: mobile ? "1fr" : "minmax(0, 1.6fr) minmax(0, 1fr)",
            gap: 22,
            alignItems: "start",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div style={BLEND_LABEL}>
                {view.liveLeanActive
                  ? `County lean, moved by the ${view.liveLeanYear ?? "last"} presidential result`
                  : "County lean (2020 and 2024 results)"}
              </div>
              {view.canManage ? (
                <div style={{ display: "flex", gap: 6 }}>
                  {(["lean", "value"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      style={{
                        ...BUTTON,
                        padding: "4px 9px",
                        fontSize: 9.5,
                        color: mode === m ? BLEND.ink : BLEND.mutedDim,
                        borderColor: mode === m ? BLEND.hairlineStrong : BLEND.chipBorder,
                        background: mode === m ? BLEND.inset : "transparent",
                      }}
                    >
                      {m === "lean" ? "Lean" : "Opportunity"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <CountyMap
              viewBox={view.map.viewBox}
              subdivisions={view.map.subdivisions}
              mode={mode}
              maxMarginal={maxMarginal}
              hovered={hovered}
              selected={selected}
              onHover={setHovered}
              onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            />
            <Legend mode={mode} regionLivePvi={view.map.regionLivePvi} />
          </div>

          <div>
            {focus ? (
              <CountyCard
                sub={focus}
                regionId={view.map.regionId}
                pinned={selected === focus.id}
                canAct={canAct}
                blockReason={blockReason}
                busy={busy}
                currency={currency}
                openCost={view.costs?.open ?? null}
                openActions={view.costs?.actions ?? null}
                onOpen={() => openOffice(view.map!.regionId, focus.id, `${focus.name} County`)}
                onClose={() =>
                  focus.officeId ? closeOffice(focus.officeId, focus.name) : undefined
                }
              />
            ) : (
              <p
                style={{
                  margin: 0,
                  fontFamily: FONT.sans,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: BLEND.muted,
                }}
              >
                {view.canManage
                  ? "Pick a county on the map. Big counties where your side is strong turn out the most votes per office. Switch to Opportunity to see that directly."
                  : "Pins mark this campaign's offices. Hover a county for its lean."}
              </p>
            )}
            <OfficeList
              view={view}
              canAct={canAct}
              busy={busy}
              onClose={closeOffice}
              onFocus={(regionId, subId) => {
                if (regionId !== view.selectedRegionId) setRegion(regionId);
                setSelected(subId);
              }}
            />
          </div>
        </div>
      ) : null}

      {view.scope === "region" ? (
        <RegionCards
          view={view}
          canAct={canAct}
          blockReason={blockReason}
          busy={busy}
          onOpen={(id, name) => openOffice(id, null, name)}
          onClose={closeOffice}
        />
      ) : null}

      {message ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            fontFamily: FONT.mono,
            fontSize: 11,
            color: message.ok ? BLEND.positive : BLEND.negative,
          }}
        >
          {message.text}
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ mobile, children }: { mobile: boolean; children: React.ReactNode }) {
  return (
    <section
      style={{
        padding: mobile ? "18px 16px" : "24px 26px",
        borderBottom: mobile ? undefined : `1px solid ${BLEND.hairlineStrong}`,
      }}
    >
      {children}
    </section>
  );
}

function RegionPicker({
  regions,
  value,
  onChange,
}: {
  regions: FieldOfficeView["regions"];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const active = regions.filter((r) => r.officeCount > 0);
  return (
    <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label style={BLEND_LABEL} htmlFor="field-office-region">
        State
      </label>
      <select
        id="field-office-region"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: BLEND.field,
          color: BLEND.ink,
          border: `1px solid ${BLEND.chipBorder}`,
          padding: "6px 10px",
          fontFamily: FONT.sans,
          fontSize: 13,
        }}
      >
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.officeCount > 0 ? ` (${r.officeCount})` : ""}
          </option>
        ))}
      </select>
      {active.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onChange(r.id)}
          style={{
            ...BUTTON,
            padding: "4px 9px",
            fontSize: 9.5,
            borderColor: r.id === value ? BLEND.hairlineStrong : BLEND.chipBorder,
            background: r.id === value ? BLEND.inset : "transparent",
          }}
        >
          {r.id} {r.officeCount} · {formatPct(r.effectPct, 1)}
        </button>
      ))}
    </div>
  );
}

function CountyMap({
  viewBox,
  subdivisions,
  mode,
  maxMarginal,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  viewBox: string;
  subdivisions: FieldOfficeSubdivisionDto[];
  mode: ColorMode;
  maxMarginal: number;
  hovered: string | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const r = pinRadius(viewBox);
  const pins = subdivisions
    .filter((s) => s.officeId)
    .map((s) => ({ id: s.id, c: pathCentre(s.path) }))
    .filter((p): p is { id: string; c: { x: number; y: number } } => p.c !== null);
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label="County map"
      style={{ width: "100%", height: "auto", maxHeight: 460, display: "block" }}
      onMouseLeave={() => onHover(null)}
    >
      {subdivisions.map((s) => {
        const active = s.id === hovered || s.id === selected;
        return (
          <path
            key={s.id}
            d={s.path}
            fill={
              mode === "value" ? valueFill(s.marginalPct ?? 0, maxMarginal) : leanFill(s.livePvi)
            }
            stroke={active ? BLEND.ink : BLEND.page}
            strokeWidth={active ? r * 0.35 : r * 0.12}
            style={{ cursor: "pointer", transition: "fill 160ms ease" }}
            onMouseEnter={() => onHover(s.id)}
            onClick={() => onSelect(s.id)}
          >
            <title>{`${s.name}: ${leanLabel(s.livePvi)}`}</title>
          </path>
        );
      })}
      {pins.map((p) => (
        <g key={`pin-${p.id}`} pointerEvents="none">
          <circle cx={p.c.x} cy={p.c.y} r={r * 1.6} fill={BLEND.gold} opacity={0.22} />
          <circle
            cx={p.c.x}
            cy={p.c.y}
            r={r * 0.8}
            fill={BLEND.gold}
            stroke={BLEND.page}
            strokeWidth={r * 0.25}
          />
        </g>
      ))}
    </svg>
  );
}

function Legend({ mode, regionLivePvi }: { mode: ColorMode; regionLivePvi: number }) {
  const stops =
    mode === "lean"
      ? [-30, -15, -5, 0, 5, 15, 30].map((v) => ({ key: String(v), fill: leanFill(v) }))
      : [0.1, 0.3, 0.5, 0.75, 1].map((v) => ({ key: String(v), fill: valueFill(v, 1) }));
  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: FONT.mono,
        fontSize: 10,
        color: BLEND.mutedDim,
      }}
    >
      <span>{mode === "lean" ? "Left" : "Low"}</span>
      <span style={{ display: "flex", gap: 2 }}>
        {stops.map((s) => (
          <span key={s.key} style={{ width: 18, height: 8, borderRadius: 2, background: s.fill }} />
        ))}
      </span>
      <span>{mode === "lean" ? "Right" : "High"}</span>
      <span style={{ marginLeft: "auto" }}>
        {mode === "lean" ? `State ${leanLabel(regionLivePvi)}` : "Turnout from one new office"}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: BLEND.gold,
            display: "inline-block",
          }}
        />
        Office
      </span>
    </div>
  );
}

function CountyCard({
  sub,
  regionId,
  pinned,
  canAct,
  blockReason,
  busy,
  currency,
  openCost,
  openActions,
  onOpen,
  onClose,
}: {
  sub: FieldOfficeSubdivisionDto;
  regionId: string;
  pinned: boolean;
  canAct: boolean;
  blockReason: string | null;
  busy: string | null;
  currency: string;
  openCost: number | null;
  openActions: number | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const openKey = `open:${regionId}:${sub.id}`;
  return (
    <div
      style={{
        padding: "14px 16px",
        background: BLEND.inset,
        border: `1px solid ${pinned ? BLEND.hairlineStrong : BLEND.hairline}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 17, fontWeight: 600 }}>
          {sub.name} County
        </div>
        {sub.officeId ? (
          <span style={{ fontFamily: FONT.mono, fontSize: 10, color: BLEND.gold }}>
            OFFICE OPEN
          </span>
        ) : null}
      </div>
      <dl
        style={{
          margin: "10px 0 0",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 4,
          columnGap: 14,
          fontFamily: FONT.mono,
          fontSize: 12,
        }}
      >
        <dt style={{ color: BLEND.mutedDim }}>Lean</dt>
        <dd style={{ margin: 0 }}>
          {leanLabel(sub.livePvi)}
          {Math.abs(sub.livePvi - sub.basePvi) >= 0.1 ? (
            <span style={{ color: BLEND.mutedDim }}> (was {leanLabel(sub.basePvi)})</span>
          ) : null}
        </dd>
        <dt style={{ color: BLEND.mutedDim }}>Share of state</dt>
        <dd style={{ margin: 0 }}>{(sub.electorateShare * 100).toFixed(1)}%</dd>
        {sub.yieldFactor != null ? (
          <>
            <dt style={{ color: BLEND.mutedDim }}>Your yield</dt>
            <dd style={{ margin: 0 }}>{sub.yieldFactor.toFixed(2)}x</dd>
          </>
        ) : null}
        {sub.marginalPct != null && !sub.officeId ? (
          <>
            <dt style={{ color: BLEND.mutedDim }}>New office</dt>
            <dd style={{ margin: 0, color: BLEND.positive }}>
              {formatPct(sub.marginalPct)} turnout statewide
            </dd>
          </>
        ) : null}
      </dl>
      {canAct ? (
        <div style={{ marginTop: 12 }}>
          {sub.officeId ? (
            <button
              type="button"
              onClick={onClose}
              disabled={busy !== null}
              style={{ ...BUTTON, color: BLEND.muted }}
            >
              {busy === `close:${sub.officeId}` ? "Closing..." : "Close office"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onOpen}
                disabled={busy !== null || blockReason !== null}
                style={{
                  ...BUTTON,
                  borderColor: BLEND.accent,
                  background: blockReason ? "transparent" : BLEND.accent,
                  color: blockReason ? BLEND.mutedDim : "#fff",
                  cursor: blockReason ? "not-allowed" : "pointer",
                }}
              >
                {busy === openKey
                  ? "Opening..."
                  : `Open office${openCost != null ? ` · ${formatCurrency(openCost, currency)}` : ""}${openActions != null ? ` · ${openActions} actions` : ""}`}
              </button>
              {blockReason ? (
                <p
                  style={{
                    margin: "6px 0 0",
                    fontFamily: FONT.sans,
                    fontSize: 12.5,
                    color: BLEND.caution,
                  }}
                >
                  {blockReason}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function OfficeList({
  view,
  canAct,
  busy,
  onClose,
  onFocus,
}: {
  view: FieldOfficeView;
  canAct: boolean;
  busy: string | null;
  onClose: (officeId: string, label: string) => void;
  onFocus: (regionId: string, subdivisionId: string | null) => void;
}) {
  if (view.offices.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ ...BLEND_LABEL, marginBottom: 6 }}>Your offices</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {view.offices.map((o) => (
          <li
            key={o.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 0",
              borderTop: `1px solid ${BLEND.hairline}`,
              fontFamily: FONT.mono,
              fontSize: 12,
            }}
          >
            <button
              type="button"
              onClick={() => onFocus(o.regionId, o.subdivisionId)}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                background: "transparent",
                border: 0,
                padding: 0,
                color: BLEND.ink,
                fontFamily: FONT.sans,
                fontSize: 13.5,
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {o.label}
              <span style={{ color: BLEND.mutedDim, fontFamily: FONT.mono, fontSize: 11 }}>
                {" "}
                {o.regionId}
              </span>
            </button>
            <StrengthBar strength={o.strength} />
            {canAct ? (
              <button
                type="button"
                onClick={() => onClose(o.id, o.label)}
                disabled={busy !== null}
                aria-label={`Close the ${o.label} office`}
                style={{ ...BUTTON, padding: "3px 8px", fontSize: 9.5, color: BLEND.mutedDim }}
              >
                {busy === `close:${o.id}` ? "..." : "Close"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegionCards({
  view,
  canAct,
  blockReason,
  busy,
  onOpen,
  onClose,
}: {
  view: FieldOfficeView;
  canAct: boolean;
  blockReason: string | null;
  busy: string | null;
  onOpen: (regionId: string, name: string) => void;
  onClose: (officeId: string, label: string) => void;
}) {
  const perRegion = view.maxPerRegion ?? 3;
  return (
    <div
      style={{
        marginTop: 18,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {view.regions.map((r) => {
        const offices = view.offices.filter((o) => o.regionId === r.id);
        const full = offices.length >= perRegion;
        return (
          <div
            key={r.id}
            style={{
              padding: "14px 16px",
              background: BLEND.inset,
              border: `1px solid ${offices.length > 0 ? BLEND.hairlineStrong : BLEND.hairline}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: FONT.sans, fontSize: 15, fontWeight: 600 }}>{r.name}</span>
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: r.effectPct > 0 ? BLEND.positive : BLEND.mutedDim,
                }}
              >
                {formatPct(r.effectPct)}
              </span>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 4 }}>
              {Array.from({ length: perRegion }, (_, i) => {
                const o = offices[i];
                return (
                  <span
                    key={i}
                    title={o ? `${Math.round(o.strength * 100)}% strength` : "Empty slot"}
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 2,
                      background: o ? (o.strength >= 1 ? BLEND.gold : BLEND.caution) : BLEND.track,
                      opacity: o ? 0.4 + 0.6 * o.strength : 1,
                    }}
                  />
                );
              })}
            </div>
            {canAct ? (
              <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => onOpen(r.id, r.name)}
                  disabled={busy !== null || full || blockReason !== null}
                  title={full ? "Region is full" : (blockReason ?? undefined)}
                  style={{
                    ...BUTTON,
                    color: full || blockReason ? BLEND.mutedDim : BLEND.ink,
                    cursor: full || blockReason ? "not-allowed" : "pointer",
                  }}
                >
                  {busy === `open:${r.id}:` ? "Opening..." : "Open office"}
                </button>
                {offices.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onClose(offices[offices.length - 1].id, r.name)}
                    disabled={busy !== null}
                    style={{ ...BUTTON, color: BLEND.mutedDim }}
                  >
                    Close one
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {canAct && blockReason ? (
        <p
          style={{
            gridColumn: "1 / -1",
            margin: 0,
            fontFamily: FONT.sans,
            fontSize: 12.5,
            color: BLEND.caution,
          }}
        >
          {blockReason}
        </p>
      ) : null}
    </div>
  );
}
