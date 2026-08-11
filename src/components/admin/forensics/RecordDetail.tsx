"use client";

// Single-record inspector. Fetches GET /api/admin/audit/:id for the record plus
// its `related` bundle (actor's other actions, subject history, counterparty),
// renders the before/after delta, exposes every pivot the plan calls for, and —
// for admins only — the raw meta/net blobs behind a disclosure.

import { useCallback, useEffect, useState } from "react";
import { DeltaView } from "./DeltaView";
import { FlagChips } from "./FlagChips";
import {
  type ActionAuditRecord,
  type AuditRecordResponse,
  categoryMeta,
  describeActor,
  describeParty,
  formatRelative,
  formatTimestamp,
  humanizeAction,
  OUTCOME_META,
  summarizeRecord,
} from "./types";

interface RecordDetailProps {
  recordId: string;
  apiBase: string;
  isAdmin: boolean;
  /** Paint immediately from the list row while the full record loads. */
  initialRecord?: ActionAuditRecord;
  onFollowTrace: (traceId: string) => void;
  onSelectRecord: (record: ActionAuditRecord) => void;
  onPivotActor: (record: ActionAuditRecord) => void;
  onPivotSubject: (record: ActionAuditRecord) => void;
  onPivotCounterparty: (record: ActionAuditRecord) => void;
  onPivotToAlts?: (userId: string) => void;
  onRefPivot?: (refKey: string, refId: string) => void;
  onClose: () => void;
}

function PivotButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-card-border bg-card/40 px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

const OVERLINE_CLS = "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted";

function RelatedList({
  title,
  records,
  onSelectRecord,
  emptyHint,
}: {
  title: string;
  records: ActionAuditRecord[] | undefined;
  onSelectRecord: (r: ActionAuditRecord) => void;
  emptyHint: string;
}) {
  return (
    <div>
      <h4 className={`mb-2 ${OVERLINE_CLS}`}>{title}</h4>
      {!records || records.length === 0 ? (
        <p className="text-xs italic text-muted">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-card-border/50 overflow-hidden rounded-lg border border-card-border bg-card/40">
          {records.map((r) => (
            <li key={r._id}>
              <button
                type="button"
                onClick={() => onSelectRecord(r)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-card-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 motion-reduce:transition-none"
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${categoryMeta(r.category).dot}`}
                />
                <span className="truncate text-foreground">{summarizeRecord(r)}</span>
                <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-muted">
                  T{r.turn} · {formatRelative(r.ts)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecordDetail({
  recordId,
  apiBase,
  isAdmin,
  initialRecord,
  onFollowTrace,
  onSelectRecord,
  onPivotActor,
  onPivotSubject,
  onPivotCounterparty,
  onPivotToAlts,
  onRefPivot,
  onClose,
}: RecordDetailProps) {
  const [record, setRecord] = useState<ActionAuditRecord | null>(initialRecord ?? null);
  const [related, setRelated] = useState<AuditRecordResponse["related"]>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/audit/${recordId}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: AuditRecordResponse = await res.json();
      setRecord(data.record);
      setRelated(data.related ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load record");
    } finally {
      setLoading(false);
    }
  }, [apiBase, recordId]);

  useEffect(() => {
    load();
  }, [load]);

  const r = record;
  const cat = r ? categoryMeta(r.category) : null;
  const actorUserId = r?.actor.userId;

  return (
    <aside className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-card-border bg-card/40 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          {r && cat ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cat.badge}`}
                >
                  {cat.label}
                </span>
                <span className="font-mono text-xs text-muted">{r.action}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${OUTCOME_META[r.outcome].badge}`}
                >
                  {OUTCOME_META[r.outcome].label}
                </span>
              </div>
              <h3 className="mt-2 text-base font-semibold tracking-tight">
                {humanizeAction(r.action)}
              </h3>
              <p className="mt-0.5 text-sm text-muted">{summarizeRecord(r)}</p>
            </>
          ) : (
            <h3 className="text-sm font-semibold">Record</h3>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close record"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-card-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
            <p>{error}</p>
            <button onClick={load} className="mt-1 text-xs underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {r && (
          <>
            {/* Meta grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-card-border/60 bg-card/40 p-3 text-sm">
              <div>
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  When
                </dt>
                <dd className="tabular-nums" title={formatTimestamp(r.ts)}>
                  {formatTimestamp(r.ts)}{" "}
                  <span className="text-muted">({formatRelative(r.ts)})</span>
                </dd>
              </div>
              <div>
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Turn
                </dt>
                <dd className="tabular-nums">{r.turn}</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Actor
                </dt>
                <dd className="truncate">
                  {describeActor(r.actor)}{" "}
                  <span className="text-xs text-muted">({r.actor.kind})</span>
                </dd>
              </div>
              <div>
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Subject
                </dt>
                <dd className="truncate">{describeParty(r.subject)}</dd>
              </div>
              {r.counterparty && (
                <div>
                  <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Counterparty
                  </dt>
                  <dd className="truncate">{describeParty(r.counterparty)}</dd>
                </div>
              )}
              <div>
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Source
                </dt>
                <dd>
                  {r.source}
                  {r.phase ? ` · ${r.phase}` : ""}
                </dd>
              </div>
            </dl>

            {r.reason && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
                {r.reason}
              </p>
            )}

            {r.flags && r.flags.length > 0 && (
              <div>
                <h4 className={`mb-2 ${OVERLINE_CLS}`}>Anomaly flags</h4>
                <FlagChips flags={r.flags} size="sm" />
              </div>
            )}

            {/* Delta / what changed */}
            <div>
              <h4 className={`mb-2 ${OVERLINE_CLS}`}>What changed</h4>
              <DeltaView record={r} onRefPivot={onRefPivot} />
            </div>

            {/* Pivots */}
            <div>
              <h4 className={`mb-2 ${OVERLINE_CLS}`}>Pivot</h4>
              <div className="flex flex-wrap gap-2">
                <PivotButton onClick={() => onFollowTrace(r.traceId)}>
                  Follow this trace →
                </PivotButton>
                <PivotButton
                  onClick={() => onPivotActor(r)}
                  disabled={!r.actor.userId && !r.actor.characterId}
                  title="See everything this actor did"
                >
                  Actor&apos;s other actions
                </PivotButton>
                <PivotButton
                  onClick={() => onPivotSubject(r)}
                  disabled={!r.subject.id}
                  title="See this subject's history"
                >
                  Subject history
                </PivotButton>
                <PivotButton
                  onClick={() => onPivotCounterparty(r)}
                  disabled={!r.counterparty?.id}
                  title="See the counterparty's activity"
                >
                  Counterparty
                </PivotButton>
                {onPivotToAlts && actorUserId && (
                  <PivotButton
                    onClick={() => onPivotToAlts(actorUserId)}
                    title="Check the alt-detection view for this actor"
                  >
                    {r.clusterId ? "View alt cluster →" : "Check for alts →"}
                  </PivotButton>
                )}
              </div>
            </div>

            {/* Related activity */}
            <RelatedList
              title="Actor's recent actions"
              records={related.actorRecent}
              onSelectRecord={onSelectRecord}
              emptyHint="No other recent actions for this actor."
            />
            <RelatedList
              title="Subject history"
              records={related.subjectHistory}
              onSelectRecord={onSelectRecord}
              emptyHint="No prior actions on this subject."
            />
            {related.counterpartyRecent && related.counterpartyRecent.length > 0 && (
              <RelatedList
                title="Counterparty recent"
                records={related.counterpartyRecent}
                onSelectRecord={onSelectRecord}
                emptyHint=""
              />
            )}

            {/* Admin-only raw inspection */}
            {isAdmin ? (
              (r.meta || r.net) && (
                <div className="overflow-hidden rounded-lg border border-card-border bg-card/40">
                  <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    aria-expanded={showRaw}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-card-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 motion-reduce:transition-none ${OVERLINE_CLS}`}
                  >
                    <svg
                      className={`h-3 w-3 transition-transform motion-reduce:transition-none ${showRaw ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    Raw meta / net (admin)
                  </button>
                  {showRaw && (
                    <div className="space-y-3 px-3 pb-3">
                      {r.net && (
                        <div>
                          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                            net
                          </div>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border/60 bg-card-muted p-2.5 font-mono text-[11px] leading-relaxed">
                            {JSON.stringify(r.net, null, 2)}
                          </pre>
                        </div>
                      )}
                      {r.meta && (
                        <div>
                          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                            meta
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border/60 bg-card-muted p-2.5 font-mono text-[11px] leading-relaxed">
                            {JSON.stringify(r.meta, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <p className="rounded-lg border border-card-border bg-card/40 px-3 py-2 text-xs italic text-muted">
                Raw metadata and network details are admin-only.
              </p>
            )}
          </>
        )}

        {loading && !r && (
          <div className="space-y-3" aria-hidden>
            <div className="h-20 w-full animate-pulse rounded-lg bg-card motion-reduce:animate-none" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-card motion-reduce:animate-none" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-card motion-reduce:animate-none" />
            <div className="h-24 w-full animate-pulse rounded-lg bg-card motion-reduce:animate-none" />
          </div>
        )}
      </div>
    </aside>
  );
}
