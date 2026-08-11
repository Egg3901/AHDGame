"use client";

import React, { type Dispatch } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type {
  ConfirmAction,
  CorpRow,
  CorporationsAdminAction,
  ImfBailoutPreviewResponse,
  InlinePanel,
} from "../useCorporationsAdminState";
import { CorpTimersCell } from "./CorpTimersCell";
import { ImfBailoutRow } from "./ImfBailoutRow";
import { fmt } from "./format";

export function CorporationsTable({
  corps,
  currentTurn,
  confirm,
  inline,
  actionLoading,
  capitalAmount,
  appointedCharId,
  appointedCharName,
  hqCountry,
  hqRegion,
  imfTargetPct,
  imfAnnualRate,
  imfTurns,
  imfRetention,
  imfIncomeCapture,
  imfPreview,
  imfPreviewLoading,
  imfPreviewError,
  dispatch,
  onConfirm,
  onGrantCapital,
  onAppointCeo,
  onMoveHq,
  onImfActivate,
  onImfIncomeCaptureSave,
  onImfEnd,
  openInline,
  openImfPanel,
  openConfirm,
}: {
  corps: CorpRow[];
  currentTurn: number;
  confirm: ConfirmAction;
  inline: InlinePanel;
  actionLoading: string | null;
  capitalAmount: string;
  appointedCharId: string | null;
  appointedCharName: string | null;
  hqCountry: string;
  hqRegion: string;
  imfTargetPct: string;
  imfAnnualRate: string;
  imfTurns: string;
  imfRetention: string;
  imfIncomeCapture: string;
  imfPreview: ImfBailoutPreviewResponse | null;
  imfPreviewLoading: boolean;
  imfPreviewError: string | null;
  dispatch: Dispatch<CorporationsAdminAction>;
  onConfirm: () => void;
  onGrantCapital: (corpId: string) => void;
  onAppointCeo: (corpId: string) => void;
  onMoveHq: (corpId: string) => void;
  onImfActivate: (corpId: string) => void;
  onImfIncomeCaptureSave: (corpId: string) => void;
  onImfEnd: (corpId: string) => void;
  openInline: (panel: InlinePanel) => void;
  openImfPanel: (row: CorpRow) => void;
  openConfirm: (action: ConfirmAction) => void;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background/50">
            <tr>
              {[
                "Corporation",
                "CEO",
                "Liquid Capital",
                "Revenue/turn",
                "Dividend",
                "Share Price",
                "Status",
                "Timers",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {corps.map((row) => (
              <React.Fragment key={row.id}>
                <tr
                  className={`transition-colors duration-150 ${
                    row.suspended ? "bg-error/5" : "hover:bg-background/40"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted">
                      {row.countryId} ·{" "}
                      {CORPORATION_TYPE_LABELS[row.type as keyof typeof CORPORATION_TYPE_LABELS] ??
                        row.type}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.ceoVacant ? (
                      <span className="text-error font-medium">Vacant</span>
                    ) : (
                      <span>{row.ceoName ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{fmt(row.liquidCapital)}</td>
                  <td className="px-4 py-3">{fmt(row.revenue)}</td>
                  <td className="px-4 py-3">{row.dividendRate}%</td>
                  <td className="px-4 py-3">{fmt(row.sharePrice)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {row.suspended && (
                        <span className="text-[10px] font-semibold bg-error/20 text-error px-1.5 py-0.5 rounded w-fit">
                          Suspended
                        </span>
                      )}
                      {row.bondDefaultCreditPenaltyUntilTurn != null && (
                        <span className="text-[10px] font-semibold bg-warning/20 text-warning px-1.5 py-0.5 rounded w-fit">
                          Bond Default
                        </span>
                      )}
                      {row.creditRatingSnapshot && (
                        <span className="text-[10px] text-muted">{row.creditRatingSnapshot}</span>
                      )}
                      {row.imfBailoutActive && (
                        <span className="text-[10px] font-semibold bg-accent/20 text-accent px-1.5 py-0.5 rounded w-fit">
                          IMF
                          {row.imfFacilityPrincipalOutstanding != null && (
                            <span className="text-muted font-normal">
                              {" "}
                              {fmt(row.imfFacilityPrincipalOutstanding)} ₳
                            </span>
                          )}
                        </span>
                      )}
                      {!row.suspended && row.bondDefaultCreditPenaltyUntilTurn == null && (
                        <span className="text-xs text-muted">OK</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <CorpTimersCell row={row} currentTurn={currentTurn} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() =>
                          openConfirm({
                            type: "resetTimers",
                            corpId: row.id,
                            corpName: row.name,
                          })
                        }
                        className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                      >
                        Timers
                      </button>
                      <button
                        onClick={() => openInline({ type: "capital", corpId: row.id })}
                        className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                      >
                        Capital
                      </button>
                      <button
                        onClick={() =>
                          openConfirm({
                            type: "forceDividend",
                            corpId: row.id,
                            corpName: row.name,
                          })
                        }
                        className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                      >
                        Dividend
                      </button>
                      <button
                        onClick={() => openInline({ type: "appointCeo", corpId: row.id })}
                        className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                      >
                        Appoint CEO
                      </button>
                      <button
                        onClick={() =>
                          openConfirm({ type: "vacateCeo", corpId: row.id, corpName: row.name })
                        }
                        className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10 transition-colors"
                      >
                        Vacate CEO
                      </button>
                      <button
                        onClick={() => openInline({ type: "hq", corpId: row.id })}
                        className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                      >
                        Move HQ
                      </button>
                      {!row.imfInstitution && (
                        <>
                          <button
                            onClick={() => openImfPanel(row)}
                            className="text-xs px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
                          >
                            IMF
                          </button>
                          <button
                            onClick={() =>
                              openConfirm({
                                type: "forceLiquidate",
                                corpId: row.id,
                                corpName: row.name,
                              })
                            }
                            className="text-xs px-2 py-1 rounded border border-error/50 text-error hover:bg-error/10 transition-colors"
                          >
                            Force Liq
                          </button>
                        </>
                      )}
                      {row.suspended ? (
                        <button
                          onClick={() =>
                            openConfirm({ type: "resume", corpId: row.id, corpName: row.name })
                          }
                          className="text-xs px-2 py-1 rounded border border-success/40 text-success hover:bg-success/10 transition-colors"
                        >
                          Resume
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            openConfirm({ type: "suspend", corpId: row.id, corpName: row.name })
                          }
                          className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10 transition-colors"
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Confirm strip */}
                {confirm?.corpId === row.id && (
                  <tr key={`${row.id}-confirm`}>
                    <td colSpan={9} className="px-4 py-3 bg-warning/5 border-t border-warning/20">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-medium">
                          {confirm.type === "resetTimers" && `Reset all timers for ${row.name}?`}
                          {confirm.type === "forceDividend" &&
                            `Force dividend payout for ${row.name}?`}
                          {confirm.type === "vacateCeo" && (
                            <>
                              Vacate CEO of {row.name}?{" "}
                              <span className="text-xs text-muted font-normal">
                                ceoVacant will be set to true.
                              </span>
                            </>
                          )}
                          {confirm.type === "suspend" &&
                            `Suspend ${row.name} from turn processing?`}
                          {confirm.type === "resume" && `Resume ${row.name}?`}
                          {confirm.type === "forceLiquidate" && (
                            <>
                              Force liquidate {row.name}? This pays creditors and deletes the
                              corporation (same as bond-default dissolve).
                            </>
                          )}
                        </span>
                        <button
                          onClick={onConfirm}
                          disabled={actionLoading === row.id}
                          className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground font-medium hover:opacity-90"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => dispatch({ type: "SET_CONFIRM", value: null })}
                          className="text-xs text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Inline: Grant Capital */}
                {inline?.corpId === row.id && inline.type === "capital" && (
                  <tr key={`${row.id}-capital`}>
                    <td
                      colSpan={9}
                      className="px-4 py-3 bg-background/40 border-t border-card-border"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted">Amount (negative to drain):</span>
                        <input
                          type="number"
                          value={capitalAmount}
                          onChange={(e) =>
                            dispatch({ type: "SET_CAPITAL_AMOUNT", value: e.target.value })
                          }
                          placeholder="e.g. 500000"
                          className="w-36 rounded border border-card-border bg-background px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => onGrantCapital(row.id)}
                          disabled={actionLoading === row.id}
                          className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => dispatch({ type: "SET_INLINE", value: null })}
                          className="text-xs text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Inline: Appoint CEO */}
                {inline?.corpId === row.id && inline.type === "appointCeo" && (
                  <tr key={`${row.id}-appointCeo`}>
                    <td
                      colSpan={9}
                      className="px-4 py-3 bg-background/40 border-t border-card-border"
                    >
                      <div className="space-y-3">
                        <PlayerSelector
                          onSelect={(c) => {
                            dispatch({ type: "SET_APPOINTED_CHAR_ID", value: c.id });
                            dispatch({ type: "SET_APPOINTED_CHAR_NAME", value: c.name });
                          }}
                          placeholder="Search for character…"
                        />
                        {appointedCharName && (
                          <p className="text-xs text-muted">
                            Selected: <strong>{appointedCharName}</strong> — appointment is
                            auto-accepted; ceoVacant set to false.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => onAppointCeo(row.id)}
                            disabled={!appointedCharId || actionLoading === row.id}
                            className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
                          >
                            Appoint
                          </button>
                          <button
                            onClick={() => dispatch({ type: "SET_INLINE", value: null })}
                            className="text-xs text-muted hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Inline: Move HQ */}
                {inline?.corpId === row.id && inline.type === "hq" && (
                  <tr key={`${row.id}-hq`}>
                    <td
                      colSpan={9}
                      className="px-4 py-3 bg-background/40 border-t border-card-border"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <select
                          value={hqCountry}
                          onChange={(e) =>
                            dispatch({ type: "SET_HQ_COUNTRY", value: e.target.value })
                          }
                          className="rounded border border-card-border bg-background px-2 py-1 text-sm"
                        >
                          {["US", "UK", "JP", "DE"].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={hqRegion}
                          onChange={(e) =>
                            dispatch({ type: "SET_HQ_REGION", value: e.target.value })
                          }
                          placeholder="Region ID (e.g. CA, england)"
                          className="w-44 rounded border border-card-border bg-background px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => onMoveHq(row.id)}
                          disabled={actionLoading === row.id}
                          className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                        >
                          Move
                        </button>
                        <button
                          onClick={() => dispatch({ type: "SET_INLINE", value: null })}
                          className="text-xs text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {inline?.corpId === row.id && inline.type === "imf" && (
                  <ImfBailoutRow
                    key={`${row.id}-imf`}
                    row={row}
                    actionLoading={actionLoading}
                    imfTargetPct={imfTargetPct}
                    imfAnnualRate={imfAnnualRate}
                    imfTurns={imfTurns}
                    imfRetention={imfRetention}
                    imfIncomeCapture={imfIncomeCapture}
                    imfPreview={imfPreview}
                    imfPreviewLoading={imfPreviewLoading}
                    imfPreviewError={imfPreviewError}
                    dispatch={dispatch}
                    onActivate={onImfActivate}
                    onSaveIncomeCapture={onImfIncomeCaptureSave}
                    onEnd={onImfEnd}
                  />
                )}
              </React.Fragment>
            ))}
            {corps.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted">
                  No corporations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
