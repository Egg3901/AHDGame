"use client";

// AccountDossier — the investigator's one-screen cockpit for a single
// account (forensics v2 plan, Wave 2 "dossier UI"). Self-contained: given a
// `userId` it fetches GET /api/admin/players/[userId]/dossier and renders
// the full footprint — identity + devices, sessions, money (totals, flow
// graph, recent txs), alt links/rings, and the recent-action audit stream.
//
// Pivoting: clicking a linked account re-centers the dossier on that user
// and pushes a breadcrumb trail, so an investigator can walk a ring
// account-by-account and step back. The `context` prop mirrors the sibling
// admin Players sub-tabs ("admin" unlocks raw PII server-side; "moderator"
// gets the masked footprint) — masking itself is enforced by the API.
//
// Wiring (coordinator): `import AccountDossier from
// "@/components/admin/players/dossier/AccountDossier"` and render
// `<AccountDossier userId={selectedUserId} context={context} />`. No other
// props are required.

import { useCallback, useEffect, useState } from "react";
import { DossierHeader } from "./DossierHeader";
import { IdentityPanel } from "./IdentityPanel";
import { SessionsPanel } from "./SessionsPanel";
import { MoneyPanel } from "./MoneyPanel";
import { LinkedAccountsPanel } from "./LinkedAccountsPanel";
import { RecentActionsPanel } from "./RecentActionsPanel";
import { accountLabel, type DossierContext, type DossierResponse } from "./dossierTypes";

interface AccountDossierProps {
  /** The account under investigation (User._id hex). */
  userId: string;
  /** Same prop the sibling Players sub-tabs receive; default "admin". */
  context?: DossierContext;
}

export default function AccountDossier({ userId, context = "admin" }: AccountDossierProps) {
  // Pivot trail — trail[0] is the account the cockpit was opened on; the
  // last entry is the one currently displayed.
  const [trail, setTrail] = useState<string[]>([userId]);
  const activeUserId = trail[trail.length - 1];

  const [dossier, setDossier] = useState<DossierResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // A new investigation target from the parent resets the trail.
  useEffect(() => {
    setTrail([userId]);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/players/${activeUserId}/dossier`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const body: DossierResponse = await res.json();
        if (!cancelled) setDossier(body);
      } catch (e) {
        if (!cancelled) {
          setDossier(null);
          setError(e instanceof Error ? e.message : "Failed to load dossier");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeUserId, reloadNonce]);

  const pivot = useCallback((nextUserId: string) => {
    setTrail((t) => (t[t.length - 1] === nextUserId ? t : [...t, nextUserId]));
  }, []);

  const back = useCallback(() => {
    setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
  }, []);

  return (
    <div className="space-y-4">
      {/* Pivot breadcrumb — only once the investigator has stepped off the
          original account. */}
      {trail.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <button
            type="button"
            onClick={back}
            className="flex items-center gap-1.5 rounded-md text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            Pivot trail:{" "}
            {trail.map((id, i) => (
              <span key={`${id}-${i}`}>
                {i > 0 && <span aria-hidden> → </span>}
                <span className={i === trail.length - 1 ? "font-semibold text-foreground" : ""}>
                  {accountLabel(
                    i === trail.length - 1 ? (dossier?.identity.username ?? null) : null,
                    id
                  )}
                </span>
              </span>
            ))}
          </span>
        </div>
      )}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-10 text-center text-sm text-red-400">
          {error}
          <div>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="mt-3 inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-xs text-foreground transition-colors hover:bg-card-elevated motion-reduce:transition-none"
            >
              Retry
            </button>
          </div>
        </div>
      ) : !dossier ? (
        <DossierSkeleton />
      ) : (
        <>
          <DossierHeader dossier={dossier} context={context} refreshing={loading} />

          {/* Money gets the full width — the flow graph is the centerpiece. */}
          <MoneyPanel
            userId={dossier.userId}
            totals={dossier.money.totals}
            recent={dossier.money.recent}
          />

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <IdentityPanel
                identity={dossier.identity}
                devicesAndIps={dossier.devicesAndIps}
                context={context}
              />
              <SessionsPanel sessions={dossier.sessions} />
            </div>
            <div className="space-y-4">
              <LinkedAccountsPanel
                links={dossier.linkedAccounts.links}
                clusters={dossier.linkedAccounts.clusters}
                onPivot={pivot}
              />
              <RecentActionsPanel
                recentActions={dossier.recentActions}
                flaggedActions={dossier.flags.flaggedAuditRows}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Skeleton mirroring the loaded layout: hero strip, wide money panel, then
 * the two-column grid — same pulse idiom as the Alts detail skeleton. */
function DossierSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex animate-pulse items-center gap-6 rounded-xl border border-card-border bg-card p-5 motion-reduce:animate-none">
        <div className="h-[136px] w-[136px] flex-shrink-0 rounded-full bg-card-elevated" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-28 rounded bg-card-elevated/80" />
          <div className="h-5 w-48 rounded bg-card-elevated" />
          <div className="h-3 w-2/3 rounded bg-card-elevated/60" />
          <div className="h-3 w-1/2 rounded bg-card-elevated/50" />
        </div>
      </div>
      <div className="h-96 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
      </div>
    </div>
  );
}
