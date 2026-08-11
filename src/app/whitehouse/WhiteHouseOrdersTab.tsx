"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EXEC_ORDER_SLOT_CAP,
  GUBERNATORIAL_ACTION_CAP,
  GUBERNATORIAL_ACTION_REGEN_INTERVAL,
} from "@/lib/constants/governorOffice";
import { IssueOrderModal } from "@/app/country/[code]/region/[id]/office/tabs/orders/IssueOrderModal";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import {
  getExecutiveOrderName,
  getExecutiveOrderNamePlural,
  type CountryId,
} from "@/lib/constants/countries";

interface OrderShape<TStatus extends string = "active" | "expired" | "rescinded" | "superseded"> {
  _id: string;
  legislationTypeId: string;
  legislationTypeName: string;
  effectDirection: 1 | -1;
  policyOptionNameBefore: string | null;
  policyOptionNameAfter: string | null;
  status: TStatus;
  issuedByName: string;
  issuedAtTurn: number;
  expiresAtTurn: number;
  rescindedAtTurn: number | null;
}

type HistoryStatus = "expired" | "rescinded" | "superseded";

interface LegTypeOpt {
  id: string;
  name: string;
}

interface OrdersResponse {
  active: OrderShape<"active">[];
  history: OrderShape<HistoryStatus>[];
  gubernatorialActions: number;
  currentTurn: number;
  legislationTypes: LegTypeOpt[];
  viewerIsLeader: boolean;
  viewerIsAdmin: boolean;
}

interface Props {
  countryId: CountryId;
}

export function WhiteHouseOrdersTab({ countryId }: Props) {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** "normal" = president flow, "admin" = admin-override flow, null = closed. */
  const [modalMode, setModalMode] = useState<"normal" | "admin" | null>(null);
  const [rescindingId, setRescindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orderName = getExecutiveOrderName(countryId);
  const orderNamePlural = getExecutiveOrderNamePlural(countryId).toLowerCase();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/executive/orders`, {
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as OrdersResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function rescind(orderId: string) {
    if (!data?.viewerIsLeader) return;
    setRescindingId(orderId);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/executive/orders/${orderId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Failed to rescind.");
      } else {
        await refresh();
      }
    } finally {
      setRescindingId(null);
    }
  }

  if (loading || !data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-sm text-muted text-center animate-pulse">
        Loading {orderNamePlural}…
      </div>
    );
  }

  const slotsUsed = data.active.length;
  const canIssue =
    data.viewerIsLeader && slotsUsed < EXEC_ORDER_SLOT_CAP && data.gubernatorialActions >= 1;
  const issueDisabledReason = !data.viewerIsLeader
    ? "Leader only."
    : slotsUsed >= EXEC_ORDER_SLOT_CAP
      ? "Both slots in use — rescind one to issue a new order."
      : data.gubernatorialActions < 1
        ? "Insufficient office action points."
        : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">
          <div>
            {slotsUsed}/{EXEC_ORDER_SLOT_CAP} active · Office AP {data.gubernatorialActions}/
            {GUBERNATORIAL_ACTION_CAP}
          </div>
          <div className="text-xs text-muted/70 mt-0.5">
            Regenerates by 1 every {GUBERNATORIAL_ACTION_REGEN_INTERVAL} turns
          </div>
        </div>
        <button
          onClick={() => setModalMode("normal")}
          disabled={!canIssue}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
          title={issueDisabledReason}
        >
          + Issue {orderName}
        </button>
      </div>
      {data.viewerIsAdmin && (
        <section className="flex flex-col gap-2 rounded-xl border border-error/40 bg-error/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Admin — issue {orderName}</div>
            <div className="text-xs text-muted">
              Bypasses the office-holder check and the AP cost.
            </div>
          </div>
          <button
            onClick={() => setModalMode("admin")}
            disabled={slotsUsed >= EXEC_ORDER_SLOT_CAP}
            className="self-end rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/80 disabled:opacity-50 sm:self-auto"
            title={
              slotsUsed >= EXEC_ORDER_SLOT_CAP
                ? "Both slots in use — rescind one to issue a new order."
                : ""
            }
          >
            + Admin Override
          </button>
        </section>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {data.active.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-sm text-muted text-center">
          No active {orderNamePlural}.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.active.map((o) => (
            <li
              key={o._id}
              className="rounded-xl border border-card-border bg-card p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{o.legislationTypeName}</div>
                <div className="text-xs text-muted">
                  {o.policyOptionNameBefore && o.policyOptionNameAfter ? (
                    <>
                      <span>{o.policyOptionNameBefore}</span>
                      <span className="mx-1">→</span>
                      <span className="text-foreground">{o.policyOptionNameAfter}</span>
                    </>
                  ) : (
                    <span>{o.effectDirection > 0 ? "Shifted up" : "Shifted down"}</span>
                  )}
                  <span> · expires in {Math.max(0, o.expiresAtTurn - data.currentTurn)} turns</span>
                  <span> · issued by {o.issuedByName}</span>
                </div>
              </div>
              <button
                onClick={() => rescind(o._id)}
                disabled={!data.viewerIsLeader || rescindingId === o._id}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:bg-background/60 disabled:opacity-50"
              >
                {rescindingId === o._id ? "Rescinding…" : "Rescind"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <IssueOrderModal
        open={modalMode !== null}
        countryId={countryId}
        stateId={getNationalStateId(countryId)}
        scope="national"
        adminOverride={modalMode === "admin"}
        existingOrderTypeIds={new Set(data.active.map((o) => o.legislationTypeId))}
        gubernatorialActions={data.gubernatorialActions}
        onClose={() => setModalMode(null)}
        onSuccess={() => {
          setModalMode(null);
          void refresh();
        }}
      />

      {data.history.length > 0 && (
        <section className="pt-2">
          <h3 className="text-xs uppercase tracking-widest text-muted mb-2">Recent orders</h3>
          <ul className="space-y-1.5">
            {data.history.map((o) => (
              <li
                key={o._id}
                className="rounded-lg border border-card-border bg-card/40 px-3 py-2 text-xs flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{o.legislationTypeName}</span>
                    {o.policyOptionNameBefore && o.policyOptionNameAfter && (
                      <span className="text-muted">
                        {" "}
                        · {o.policyOptionNameBefore} → {o.policyOptionNameAfter}
                      </span>
                    )}
                    <span className="text-muted"> · by {o.issuedByName}</span>
                  </div>
                  <div className="text-muted/80 mt-0.5">
                    T{o.issuedAtTurn} →{" "}
                    {o.status === "rescinded"
                      ? `rescinded T${o.rescindedAtTurn ?? "?"}`
                      : o.status === "superseded"
                        ? "superseded by bill"
                        : `expired T${o.expiresAtTurn}`}
                  </div>
                </div>
                <HistoryStatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HistoryStatusBadge({ status }: { status: HistoryStatus }) {
  const cls =
    status === "expired"
      ? "bg-card-border/40 text-muted"
      : status === "rescinded"
        ? "bg-warning/15 text-warning"
        : "bg-info/15 text-info";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}
