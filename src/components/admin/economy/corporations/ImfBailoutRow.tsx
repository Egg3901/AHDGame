"use client";

import type { Dispatch } from "react";
import type {
  CorpRow,
  CorporationsAdminAction,
  ImfBailoutPreviewResponse,
} from "../useCorporationsAdminState";
import { fmt, formatImfPayoffTurns } from "./format";

/** Inline IMF bailout preview/activation row rendered under a corporation row. */
export function ImfBailoutRow({
  row,
  actionLoading,
  imfTargetPct,
  imfAnnualRate,
  imfTurns,
  imfRetention,
  imfIncomeCapture,
  imfPreview,
  imfPreviewLoading,
  imfPreviewError,
  dispatch,
  onActivate,
  onSaveIncomeCapture,
  onEnd,
}: {
  row: CorpRow;
  actionLoading: string | null;
  imfTargetPct: string;
  imfAnnualRate: string;
  imfTurns: string;
  imfRetention: string;
  imfIncomeCapture: string;
  imfPreview: ImfBailoutPreviewResponse | null;
  imfPreviewLoading: boolean;
  imfPreviewError: string | null;
  dispatch: Dispatch<CorporationsAdminAction>;
  onActivate: (corpId: string) => void;
  onSaveIncomeCapture: (corpId: string) => void;
  onEnd: (corpId: string) => void;
}) {
  return (
    <tr>
      <td colSpan={9} className="px-4 py-3 bg-background/40 border-t border-card-border">
        <div className="space-y-3 text-xs">
          <p className="text-muted">
            Activate: bond haircut + IMF share issuance + facility (₳). Amounts are anchor units.
            Requires an IMF institution corp (seed form above or Server Setup). Preview uses last
            reported per-turn operating income; estimates assume that income stays flat.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {!row.imfBailoutActive && (
              <label className="flex items-center gap-1">
                Target IMF %
                <input
                  type="number"
                  value={imfTargetPct}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_IMF_TARGET_PCT",
                      value: e.target.value,
                    })
                  }
                  className="w-16 rounded border border-card-border bg-background px-1 py-0.5"
                />
              </label>
            )}
            <label className="flex items-center gap-1">
              Annual %
              <input
                type="number"
                value={imfAnnualRate}
                onChange={(e) => dispatch({ type: "SET_IMF_ANNUAL_RATE", value: e.target.value })}
                className="w-14 rounded border border-card-border bg-background px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-1">
              Amort. turns
              <input
                type="number"
                value={imfTurns}
                onChange={(e) => dispatch({ type: "SET_IMF_TURNS", value: e.target.value })}
                className="w-20 rounded border border-card-border bg-background px-1 py-0.5"
              />
            </label>
            {!row.imfBailoutActive && (
              <label className="flex items-center gap-1">
                Bond retention
                <input
                  type="number"
                  step="0.05"
                  value={imfRetention}
                  onChange={(e) => dispatch({ type: "SET_IMF_RETENTION", value: e.target.value })}
                  className="w-14 rounded border border-card-border bg-background px-1 py-0.5"
                />
              </label>
            )}
            <label className="flex items-center gap-1">
              Income capture %
              <input
                type="number"
                min={1}
                max={45}
                step={0.5}
                value={imfIncomeCapture}
                onChange={(e) =>
                  dispatch({
                    type: "SET_IMF_INCOME_CAPTURE",
                    value: e.target.value,
                  })
                }
                className="w-16 rounded border border-card-border bg-background px-1 py-0.5"
                title="Share of per-turn operating income (₳) that can go to facility payment (max 45%, server-capped)"
              />
            </label>
            {imfPreview && (
              <span className="text-muted">
                (max {imfPreview.incomeCapturePercentMax.toFixed(0)}%)
              </span>
            )}
          </div>

          {imfPreviewLoading && <p className="text-muted animate-pulse">Loading preview…</p>}
          {imfPreviewError && <p className="text-destructive">{imfPreviewError}</p>}

          {imfPreview && !imfPreviewLoading && (
            <div className="rounded border border-card-border bg-background/60 p-3 space-y-2">
              {imfPreview.mode === "active" && (
                <p className="text-muted">
                  Stored capture: {imfPreview.incomeCapturePercentStored}% · Preview uses sliders
                  above (may differ until saved).
                </p>
              )}
              {imfPreview.mode === "preview" && imfPreview.bonds.length > 0 && (
                <div>
                  <p className="font-medium text-foreground mb-1">
                    Outstanding bonds (pre-haircut → facility anchor)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-card-border text-muted">
                          <th className="py-1 pr-2">Bond</th>
                          <th className="py-1 pr-2">Face issued</th>
                          <th className="py-1 pr-2">After haircut (₳)</th>
                          <th className="py-1">Coupon %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {imfPreview.bonds.map((b) => (
                          <tr key={b.bondId} className="border-b border-card-border/50">
                            <td className="py-1 pr-2 font-mono">{b.bondId.slice(-8)}</td>
                            <td className="py-1 pr-2">{fmt(b.totalIssued)}</td>
                            <td className="py-1 pr-2">{fmt(b.afterHaircutFace)}</td>
                            <td className="py-1">
                              {b.couponRate != null ? `${b.couponRate}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {imfPreview.mode === "preview" && imfPreview.bonds.length === 0 && (
                <p className="text-warning font-medium">
                  No unmatured bonds — activation will fail until this corporation has bond
                  principal to consolidate.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                <p>
                  <span className="text-muted">Facility principal (₳):</span>{" "}
                  {fmt(imfPreview.facilityPrincipal)}
                </p>
                <p>
                  <span className="text-muted">Scheduled payment / turn:</span>{" "}
                  {fmt(imfPreview.scheduledPaymentPerTurn)}
                </p>
                <p>
                  <span className="text-muted">Last turn operating income:</span>{" "}
                  {fmt(imfPreview.lastReportedTurnIncome)}
                  {imfPreview.lastHistoryTurn != null && (
                    <span className="text-muted"> (turn {imfPreview.lastHistoryTurn})</span>
                  )}
                </p>
                <p>
                  <span className="text-muted">
                    Income cap / turn ({imfPreview.incomeCapturePercent}%):
                  </span>{" "}
                  {fmt(imfPreview.incomeCapPerTurn)}
                </p>
                <p className="sm:col-span-2">
                  <span className="text-muted">Est. turns to clear (flat income):</span>{" "}
                  <span className="font-medium text-foreground">
                    {formatImfPayoffTurns(
                      imfPreview.simulation.estimatedTurnsToClear,
                      imfPreview.facilityPrincipal
                    )}
                  </span>
                </p>
              </div>

              {imfPreview.simulation.warning && (
                <p className="text-warning border border-warning/30 rounded px-2 py-1">
                  {imfPreview.simulation.warning}
                </p>
              )}
              {imfPreview.mode === "preview" && imfPreview.note && (
                <p className="text-muted text-[10px]">{imfPreview.note}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!row.imfBailoutActive && (
              <button
                onClick={() => onActivate(row.id)}
                disabled={actionLoading === row.id}
                className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                Activate IMF bailout
              </button>
            )}
            {row.imfBailoutActive && (
              <button
                onClick={() => onSaveIncomeCapture(row.id)}
                disabled={actionLoading === row.id || imfPreviewLoading}
                className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                Save income capture %
              </button>
            )}
            <button
              onClick={() => onEnd(row.id)}
              disabled={actionLoading === row.id || !row.imfBailoutActive}
              className="text-xs px-3 py-1 rounded border border-card-border hover:bg-background/60"
            >
              End program (flags only)
            </button>
            <button
              onClick={() => dispatch({ type: "SET_INLINE", value: null })}
              className="text-xs text-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
