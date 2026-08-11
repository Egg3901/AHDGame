"use client";

import { useCallback, useEffect, useState } from "react";
import { CORPORATION_TYPES, CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { fetchJson } from "@/lib/observability/fetchJson";
import { getBillPassRule } from "@/lib/congress/billPassRule";
import { CARVE_FRACTION_MIN, CARVE_FRACTION_MAX } from "@/lib/nationalization/constants";
import { SECTOR_SCOPE_LABELS } from "@/lib/nationalization/sectorScope";
import { MAX_PROVISIONS } from "@shared/constants/legislation";
import { natMoney } from "@/components/national/natMoney";
import { Slider } from "@/components/ui/Slider";

interface TargetDetail {
  name: string;
  ownerKind: "player" | "npc";
  triggers: string[];
  eligible: boolean;
  executivelyTakeable: boolean;
  hqStateName: string;
  sectorCount: number;
  regionCount: number;
  totalRevenuePerTurn: number;
  avgGrowthPct: number;
  avgProductionPct: number;
  marketCapLocal: number;
  currency: string;
  ceoVacant: boolean;
  ceoName: string | null;
}

/** Human "why this is a candidate" reasons for each eligibility trigger. */
const TRIGGER_REASON: Record<string, string> = {
  strategic: "Operates in a strategic sector",
  monopoly: "Holds a monopoly market share",
  distress: "Financially distressed",
  npc: "Unowned / NPC-run",
  unowned: "Unowned",
  supermajority: "A supermajority vote passed against it",
};

/** Conservative starting carve fraction for a freshly-selected bill sector (the
 *  market-control cap is enforced at enactment, not here). */
const DEFAULT_BILL_CARVE_FRACTION = 0.3;

export type NatProvisionInput =
  | {
      type: "nationalize";
      targetKind?: "corporation" | "sector";
      targetCorporationId?: string;
      targetCorpName?: string;
      /** Industry-wide sector taking. */
      targetSectorType?: string;
      sectorCarveFraction?: number;
      sectorScope?: "all" | "corporations" | "unowned" | "npp_unowned";
    }
  | { type: "designate_strategic_sector"; sectorType: string }
  | {
      type: "privatize";
      sourceNationalCorporationId: string;
      selections: { sectorId: string; carveFraction: number }[];
      newCorpName: string;
      goldenSharePercent: number;
      method: "ipo" | "auction";
      reservePrice?: number;
    };

/** Strip UI-only fields (e.g. targetCorpName) before posting. */
export function toNatPayload(rows: NatProvisionInput[]): unknown[] {
  return rows.map((r) => {
    if (r.type === "nationalize")
      return r.targetKind === "sector"
        ? {
            type: "nationalize",
            targetSectorType: r.targetSectorType,
            sectorCarveFraction: r.sectorCarveFraction ?? 1,
            sectorScope: r.sectorScope ?? "all",
          }
        : { type: "nationalize", targetCorporationId: r.targetCorporationId };
    if (r.type === "designate_strategic_sector")
      return { type: "designate_strategic_sector", sectorType: r.sectorType };
    return {
      type: "privatize",
      sourceNationalCorporationId: r.sourceNationalCorporationId,
      selections: r.selections,
      newCorpName: r.newCorpName,
      goldenSharePercent: r.goldenSharePercent,
      method: r.method,
      ...(r.method === "auction" && r.reservePrice ? { reservePrice: r.reservePrice } : {}),
    };
  });
}

export function validateNatRows(rows: NatProvisionInput[]): string | null {
  if (rows.length === 0) return "Add at least one provision.";
  for (const r of rows) {
    if (r.type === "nationalize") {
      if (r.targetKind === "sector" && !r.targetSectorType)
        return "Select a sector type to nationalize.";
      if (r.targetKind !== "sector" && !r.targetCorporationId)
        return "Select a corporation to nationalize.";
    }
    if (r.type === "designate_strategic_sector" && !r.sectorType)
      return "Select a sector to designate.";
    if (r.type === "privatize") {
      if (!r.sourceNationalCorporationId) return "Select the source National Corporation.";
      if (r.selections.length === 0) return "Select at least one sector to privatize.";
      if (r.newCorpName.trim().length < 2) return "Name the new corporation.";
      if (r.method === "auction" && !(r.reservePrice && r.reservePrice > 0))
        return "Auction privatizations need a reserve price.";
    }
  }
  return null;
}

interface RosterCorp {
  id: string;
  name: string;
}
interface SectorOpt {
  sectorId: string;
  sectorType: string;
  stateId: string;
}

export function NationalizationProvisionEditor({
  countryCode,
  value,
  onChange,
}: {
  countryCode: string;
  value: NatProvisionInput[];
  onChange: (rows: NatProvisionInput[]) => void;
}) {
  const code = countryCode.toLowerCase();
  const [natCorps, setNatCorps] = useState<RosterCorp[]>([]);
  const [stateOwnership, setStateOwnership] = useState<{
    concentration: number;
    status: { tier: string; label: string; inDangerZone: boolean; note: string };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ corporations?: { id: string; name: string }[] }>(
      `/api/country/${code}/national-corporations`,
      { feature: "nationalization-national-corporations" }
    )
      .then((d) => {
        if (!cancelled)
          setNatCorps((d.corporations ?? []).map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Current State Ownership Concentration — to warn before a taking deepens it.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ stateOwnership?: typeof stateOwnership } | null>(`/api/country/${code}/economy`, {
      feature: "nationalization-economy",
    })
      .then((d) => {
        if (!cancelled && d?.stateOwnership) setStateOwnership(d.stateOwnership);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code]);

  function setRow(i: number, row: NatProvisionInput) {
    const next = [...value];
    next[i] = row;
    onChange(next);
  }
  function addRow() {
    if (value.length >= MAX_PROVISIONS) return;
    onChange([...value, { type: "nationalize" }]);
  }
  function removeRow(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  const hasNatPriv = value.some((r) => r.type === "nationalize" || r.type === "privatize");
  const passRule = getBillPassRule(
    getCountryConfig(countryCode.toUpperCase() as CountryId).governmentType,
    hasNatPriv
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs text-muted">State-ownership provisions</label>
        {value.length < MAX_PROVISIONS && (
          <button type="button" onClick={addRow} className="text-xs text-primary hover:underline">
            + Add provision
          </button>
        )}
      </div>
      {value.length === 0 && (
        <p className="text-xs text-muted">
          No provisions yet — add a nationalize, privatize, or designation.
        </p>
      )}
      {value.some((r) => r.type === "nationalize") && stateOwnership && (
        <p
          className={`rounded-lg border px-3 py-2 text-xs leading-snug ${
            stateOwnership.status.inDangerZone
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-card-border bg-card-muted text-muted"
          }`}
        >
          State ownership is {Math.round(stateOwnership.concentration)}% of national corporate
          revenue ({stateOwnership.status.label}). {stateOwnership.status.note} This taking raises
          it further.
        </p>
      )}
      {value.map((row, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <select
              value={row.type}
              onChange={(e) => {
                const t = e.target.value as NatProvisionInput["type"];
                if (t === "nationalize") setRow(i, { type: "nationalize" });
                else if (t === "designate_strategic_sector")
                  setRow(i, { type: "designate_strategic_sector", sectorType: "" });
                else
                  setRow(i, {
                    type: "privatize",
                    sourceNationalCorporationId: "",
                    selections: [],
                    newCorpName: "",
                    goldenSharePercent: 0,
                    method: "ipo",
                  });
              }}
              className="flex-1 rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="nationalize">Nationalize a corporation/sector</option>
              <option value="privatize">Privatize a state holding</option>
              <option value="designate_strategic_sector">Designate a strategic sector</option>
            </select>
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="text-xs text-error hover:underline"
            >
              Remove
            </button>
          </div>

          {row.type === "nationalize" && (
            <NationalizeRow code={code} row={row} onChange={(r) => setRow(i, r)} />
          )}
          {row.type === "designate_strategic_sector" && (
            <select
              value={row.sectorType}
              onChange={(e) =>
                setRow(i, { type: "designate_strategic_sector", sectorType: e.target.value })
              }
              className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Select sector type —</option>
              {CORPORATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {row.type === "privatize" && (
            <PrivatizeRow natCorps={natCorps} row={row} onChange={(r) => setRow(i, r)} />
          )}
        </div>
      ))}

      {hasNatPriv && (
        <p className="text-[11px] text-amber-400">
          Passing this bill will require a <span className="font-semibold">{passRule.label}</span>
          {passRule.rule === "twoThirds" ? " of votes cast in each chamber" : ""}.
        </p>
      )}
    </div>
  );
}

function NationalizeRow({
  code,
  row,
  onChange,
}: {
  code: string;
  row: Extract<NatProvisionInput, { type: "nationalize" }>;
  onChange: (r: NatProvisionInput) => void;
}) {
  const kind = row.targetKind ?? "corporation";
  const [q, setQ] = useState(row.targetCorpName ?? "");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [detail, setDetail] = useState<TargetDetail | null>(null);

  // Pull the selected corporation's nationalization detail (who/what/why-eligible).
  useEffect(() => {
    const id = kind === "corporation" ? row.targetCorporationId : null;
    let cancelled = false;
    const run = async () => {
      if (!id) {
        if (!cancelled) setDetail(null);
        return;
      }
      try {
        const r = await fetch(
          `/api/country/${code}/nationalization-target-detail?corporationId=${id}`
        );
        const d = r.ok ? ((await r.json()) as TargetDetail) : null;
        if (!cancelled) setDetail(d);
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, kind, row.targetCorporationId]);

  const search = useCallback(
    async (text: string) => {
      if (text.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/country/${code}/corp-search?q=${encodeURIComponent(text)}`);
        if (res.ok) {
          const d = (await res.json()) as { results: { id: string; name: string }[] };
          setResults(d.results);
        }
      } catch {
        /* ignore */
      }
    },
    [code]
  );

  return (
    <div className="space-y-2">
      <select
        value={kind}
        onChange={(e) => {
          const k = e.target.value as "corporation" | "sector";
          setQ("");
          setResults([]);
          onChange(
            k === "sector"
              ? {
                  type: "nationalize",
                  targetKind: "sector",
                  sectorCarveFraction: 1,
                  sectorScope: "all",
                }
              : { type: "nationalize", targetKind: "corporation" }
          );
        }}
        className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
      >
        <option value="corporation">Whole corporation</option>
        <option value="sector">A sector — industry-wide</option>
      </select>

      {kind === "corporation" && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
          Nationalizing a whole corporation will{" "}
          <span className="font-semibold">destroy the corporation</span>: its domestic sectors are
          nationalized into the National Corporation, and any foreign sectors are released to the
          unowned market.
        </p>
      )}

      {kind === "sector" && <SectorTakeoverRow code={code} row={row} onChange={onChange} />}

      {kind === "corporation" && (
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onChange({ type: "nationalize", targetKind: "corporation" });
            search(e.target.value);
          }}
          placeholder="Search a corporation…"
          className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
        />
      )}

      {kind === "corporation" && results.length > 0 && !row.targetCorporationId && (
        <div className="max-h-32 overflow-y-auto rounded-lg border border-card-border">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({
                  type: "nationalize",
                  targetKind: "corporation",
                  targetCorporationId: c.id,
                  targetCorpName: c.name,
                });
                setQ(c.name);
                setResults([]);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-card-elevated"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {kind === "corporation" && row.targetCorporationId && (
        <div className="rounded-lg border border-card-border bg-card-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">
              {detail?.name ?? row.targetCorpName}
            </span>
            {detail && (
              <span className="text-[11px] uppercase tracking-wide text-muted">
                {detail.ownerKind === "npc" ? "NPC-run" : "Player-owned"} · HQ {detail.hqStateName}
              </span>
            )}
          </div>

          {detail ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                <Metric label="CEO" value={detail.ceoVacant ? "Vacant" : (detail.ceoName ?? "—")} />
                <Metric
                  label="Revenue/turn"
                  value={natMoney(detail.totalRevenuePerTurn, detail.currency)}
                />
                <Metric label="Value" value={natMoney(detail.marketCapLocal, detail.currency)} />
                <Metric label="Avg growth" value={`${detail.avgGrowthPct.toFixed(1)}%`} />
                <Metric
                  label="Avg production"
                  value={`${detail.avgProductionPct > 0 ? "+" : ""}${detail.avgProductionPct.toFixed(0)}%`}
                />
                <Metric
                  label="Holdings"
                  value={`${detail.sectorCount} sector${detail.sectorCount === 1 ? "" : "s"} · ${detail.regionCount} region${detail.regionCount === 1 ? "" : "s"}`}
                />
              </div>

              {detail.triggers.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted/70">
                    Why it&apos;s a candidate
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {detail.triggers.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
                      >
                        {TRIGGER_REASON[t] ?? t}
                      </span>
                    ))}
                  </div>
                  {!detail.executivelyTakeable && (
                    <p className="mt-1.5 text-[11px] text-muted">
                      Solvent private corporation — only the legislature can nationalize it (this
                      bill).
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-success">Selected: {row.targetCorpName}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface SectorPreview {
  currency: string;
  affectedCount: number;
  totalCompensationLocal: number;
  unownedSliceRevenuePerTurn: number;
  affectedCorps: {
    corporationId: string;
    name: string;
    regionCount: number;
    sectorCount: number;
    estCompensationLocal: number;
  }[];
}

/** Industry-wide sector taking: pick a type, carve %, scope, with a live cost preview. */
function SectorTakeoverRow({
  code,
  row,
  onChange,
}: {
  code: string;
  row: Extract<NatProvisionInput, { type: "nationalize" }>;
  onChange: (r: NatProvisionInput) => void;
}) {
  const sectorType = row.targetSectorType ?? "";
  const fraction = row.sectorCarveFraction ?? 1;
  const scope = row.sectorScope ?? "all";
  const [preview, setPreview] = useState<SectorPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!sectorType) {
        if (!cancelled) setPreview(null);
        return;
      }
      try {
        const r = await fetch(
          `/api/country/${code}/sector-nationalization-preview?sectorType=${sectorType}&carveFraction=${fraction}&scope=${scope}`
        );
        const d = r.ok ? ((await r.json()) as SectorPreview) : null;
        if (!cancelled) setPreview(d);
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, sectorType, fraction, scope]);

  const money = (n: number) => natMoney(n, preview?.currency ?? "USD");

  return (
    <div className="space-y-2">
      <select
        value={sectorType}
        onChange={(e) =>
          onChange({ ...row, targetKind: "sector", targetSectorType: e.target.value || undefined })
        }
        className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
      >
        <option value="">— Select sector type —</option>
        {CORPORATION_TYPES.map((t) => (
          <option key={t} value={t}>
            {CORPORATION_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      <label className="block text-xs text-muted">
        Nationalize{" "}
        <span className="font-semibold text-foreground">{Math.round(fraction * 100)}%</span> of each
        holding
        <Slider
          variant="warning"
          min={0.01}
          max={1}
          step={0.01}
          value={fraction}
          onChange={(e) =>
            onChange({
              ...row,
              targetKind: "sector",
              sectorCarveFraction: parseFloat(e.target.value),
            })
          }
          className="mt-1.5 w-full"
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        {(["all", "corporations", "unowned", "npp_unowned"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ ...row, targetKind: "sector", sectorScope: s })}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              scope === s
                ? "border-gold/40 bg-gold/15 text-gold"
                : "border-card-border text-muted hover:text-foreground"
            }`}
          >
            {SECTOR_SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      {scope === "unowned" && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
          <span className="font-semibold">Unowned market only</span> takes just the unclaimed share
          of this sector — it nationalizes nothing from existing companies and pays no compensation.
          To take company-held holdings, choose{" "}
          <span className="font-semibold">Corporations only</span> or{" "}
          <span className="font-semibold">All holders + unowned market</span>.
        </p>
      )}

      {sectorType && preview && (
        <div className="rounded-lg border border-card-border bg-card-muted p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-foreground">
              {preview.affectedCount} corporation{preview.affectedCount === 1 ? "" : "s"} affected
            </span>
            <span className="text-muted">
              Treasury cost ~
              <span className="font-medium text-foreground">
                {money(preview.totalCompensationLocal)}
              </span>
            </span>
          </div>
          {preview.unownedSliceRevenuePerTurn > 0 && scope !== "corporations" && (
            <div className="mt-1 text-[11px] text-muted">
              + {money(preview.unownedSliceRevenuePerTurn)}/turn of unowned market taken free.
            </div>
          )}
          {preview.affectedCorps.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
              {preview.affectedCorps.map((c) => (
                <li key={c.corporationId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-foreground">
                    {c.name}{" "}
                    <span className="text-[10px] text-muted">
                      · {c.sectorCount} in {c.regionCount} region{c.regionCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-muted">
                    {money(c.estCompensationLocal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview.affectedCount === 0 && scope !== "unowned" && (
            <p className="mt-1 text-[11px] text-muted">
              No corporation currently holds this sector type.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PrivatizeRow({
  natCorps,
  row,
  onChange,
}: {
  natCorps: RosterCorp[];
  row: Extract<NatProvisionInput, { type: "privatize" }>;
  onChange: (r: NatProvisionInput) => void;
}) {
  const [sectors, setSectors] = useState<SectorOpt[]>([]);
  const sourceId = row.sourceNationalCorporationId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sourceId) {
        if (!cancelled) setSectors([]);
        return;
      }
      try {
        const r = await fetch(`/api/corporations/${sourceId}/national`);
        const vm = r.ok
          ? ((await r.json()) as { holdingsByRegion?: { sectors: SectorOpt[] }[] })
          : null;
        if (!cancelled && vm) setSectors((vm.holdingsByRegion ?? []).flatMap((rg) => rg.sectors));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  function toggleSector(sectorId: string) {
    const has = row.selections.some((s) => s.sectorId === sectorId);
    const selections = has
      ? row.selections.filter((s) => s.sectorId !== sectorId)
      : [...row.selections, { sectorId, carveFraction: DEFAULT_BILL_CARVE_FRACTION }];
    onChange({ ...row, selections });
  }

  return (
    <div className="space-y-2">
      <select
        value={row.sourceNationalCorporationId}
        onChange={(e) =>
          onChange({ ...row, sourceNationalCorporationId: e.target.value, selections: [] })
        }
        className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
      >
        <option value="">— Source National Corporation —</option>
        {natCorps.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {sectors.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-lg border border-card-border p-1">
          {sectors.map((s) => (
            <label key={s.sectorId} className="flex items-center gap-2 px-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={row.selections.some((sel) => sel.sectorId === s.sectorId)}
                onChange={() => toggleSector(s.sectorId)}
              />
              <span className="capitalize">{s.sectorType}</span>
              <span className="text-xs text-muted">· {s.stateId}</span>
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={row.newCorpName}
          maxLength={60}
          onChange={(e) => onChange({ ...row, newCorpName: e.target.value })}
          placeholder="New corp name"
          className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
        />
        <select
          value={row.method}
          onChange={(e) => onChange({ ...row, method: e.target.value as "ipo" | "auction" })}
          className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="ipo">IPO float</option>
          <option value="auction">Auction</option>
        </select>
      </div>
      <label className="block text-xs text-muted">
        Carve fraction per sector:{" "}
        {Math.round((row.selections[0]?.carveFraction ?? DEFAULT_BILL_CARVE_FRACTION) * 100)}%
        <Slider
          min={CARVE_FRACTION_MIN}
          max={CARVE_FRACTION_MAX}
          step={0.01}
          value={row.selections[0]?.carveFraction ?? DEFAULT_BILL_CARVE_FRACTION}
          onChange={(e) =>
            onChange({
              ...row,
              selections: row.selections.map((s) => ({
                ...s,
                carveFraction: parseFloat(e.target.value),
              })),
            })
          }
          className="mt-1.5 w-full"
        />
      </label>
      <p className="text-[11px] text-muted">
        Applies to every selected sector. The anti-monopoly limit — a spin-out may not exceed 30% of
        a region&apos;s sector market — is checked when the bill is enacted, so a small holding may
        be carved in full while a dominant one is capped lower.
      </p>
      {row.method === "auction" && (
        <input
          type="number"
          min={0}
          value={row.reservePrice ?? ""}
          onChange={(e) =>
            onChange({ ...row, reservePrice: parseFloat(e.target.value) || undefined })
          }
          placeholder="Reserve price"
          className="w-full rounded-lg border border-card-border bg-background px-2 py-1.5 font-mono text-sm"
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted/70">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
