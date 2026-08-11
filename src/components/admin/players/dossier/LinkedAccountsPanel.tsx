"use client";

// LinkedAccountsPanel — every alt-detection link and cluster touching this
// account, ranked by confidence. Each linked account is a PIVOT: clicking it
// re-centers the whole dossier on that user (AccountDossier keeps a trail so
// the investigator can walk back). Confidence rides the same severity scale
// + bar as the Alts screens so the two tools read as one system.

import { ConfidenceBar } from "@/components/admin/alts/ConfidenceMeter";
import {
  memberDisplayName,
  ROLE_HEX,
  ROLE_LABEL,
  signalMeta,
  formatPct,
  confidenceTextClass,
  type AltSignal,
} from "@/components/admin/alts/altTypes";
import {
  OVERLINE_CLS,
  PANEL_CLS,
  type DossierAltLinkRow,
  type DossierClusterRow,
} from "./dossierTypes";

interface LinkedAccountsPanelProps {
  links: DossierAltLinkRow[];
  clusters: DossierClusterRow[];
  onPivot: (userId: string) => void;
}

const CLUSTER_STATUS_STYLE: Record<string, string> = {
  open: "border border-blue-400/25 bg-blue-500/10 text-blue-400",
  reviewed: "border border-purple-400/25 bg-purple-500/10 text-purple-400",
  confirmed: "border border-red-400/25 bg-red-500/10 text-red-400",
  dismissed: "border border-gray-400/20 bg-gray-500/10 text-gray-400",
};

export function LinkedAccountsPanel({ links, clusters, onPivot }: LinkedAccountsPanelProps) {
  return (
    <section className={PANEL_CLS} aria-label="Linked accounts">
      <h3 className={`mb-2 ${OVERLINE_CLS}`}>Linked accounts ({links.length})</h3>

      {links.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          No alt-detection links point at this account.
        </p>
      ) : (
        <ul className="divide-y divide-card-border/50">
          {links.map((link) => (
            <li key={link.otherUserId}>
              <button
                type="button"
                onClick={() => onPivot(link.otherUserId)}
                title={`Open the dossier for ${memberDisplayName(link.otherUsername, link.otherUserId)}`}
                className="group flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-card-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:text-foreground">
                    {memberDisplayName(link.otherUsername, link.otherUserId)}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {link.topSignal
                      ? signalMeta(link.topSignal as AltSignal).label
                      : "No dominant signal"}
                    {" · "}
                    {link.signalCount} signal{link.signalCount === 1 ? "" : "s"}
                  </span>
                </span>
                <ConfidenceBar value={link.confidence} widthClass="w-20" />
                <svg
                  className="h-3.5 w-3.5 flex-shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {clusters.length > 0 && (
        <div className="mt-4">
          <div className={`mb-1.5 ${OVERLINE_CLS}`}>In rings ({clusters.length})</div>
          <ul className="space-y-2">
            {clusters.map((cluster) => (
              <li
                key={cluster.id}
                className="rounded-lg border border-card-border/70 bg-card-elevated/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`font-bold tabular-nums ${confidenceTextClass(cluster.confidence)}`}
                  >
                    {formatPct(cluster.confidence)}
                  </span>
                  <span className="font-medium">
                    {cluster.size} account{cluster.size === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full ring-2 ring-background"
                      style={{
                        backgroundColor: ROLE_HEX[cluster.role],
                      }}
                    />
                    {ROLE_LABEL[cluster.role]}
                  </span>
                  <span
                    className={`ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      CLUSTER_STATUS_STYLE[cluster.status] ?? CLUSTER_STATUS_STYLE.open
                    }`}
                  >
                    {cluster.status}
                  </span>
                </div>
                {cluster.topEvidence.length > 0 && (
                  <p
                    className="mt-1 truncate text-[11px] text-muted"
                    title={cluster.topEvidence[0]}
                  >
                    {cluster.topEvidence[0]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
