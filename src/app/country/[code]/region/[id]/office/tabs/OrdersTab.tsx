"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IssueOrderModal } from "./orders/IssueOrderModal";
import {
  EXEC_ORDER_SLOT_CAP,
  GUBERNATORIAL_ACTION_CAP,
  GUBERNATORIAL_ACTION_REGEN_INTERVAL,
} from "@/lib/constants/governorOffice";
import {
  getExecutiveOrderName,
  getExecutiveOrderNamePlural,
  type CountryId,
} from "@/lib/constants/countries";

export interface ActiveOrder {
  _id: string;
  legislationTypeId: string;
  legislationTypeName: string;
  effectDirection: 1 | -1;
  policyOptionIndexBefore: number;
  policyOptionIndexAfter: number;
  policyOptionNameBefore: string | null;
  policyOptionNameAfter: string | null;
  expiresAtTurn: number;
  issuedByName: string;
}

export interface OrderHistoryEntry {
  _id: string;
  legislationTypeId: string;
  legislationTypeName: string;
  effectDirection: 1 | -1;
  policyOptionNameBefore: string | null;
  policyOptionNameAfter: string | null;
  status: "expired" | "rescinded" | "superseded";
  issuedAtTurn: number;
  expiresAtTurn: number;
  rescindedAtTurn: number | null;
  issuedByName: string;
}

export interface LegTypeOpt {
  id: string;
  name: string;
}

interface Props {
  countryId: string;
  stateId: string;
  activeOrders: ActiveOrder[];
  orderHistory: OrderHistoryEntry[];
  legislationTypes: LegTypeOpt[];
  gubernatorialActions: number;
  /** Holder OR authorized party officer of an NPP-held office. Gates actions. */
  viewerCanManage: boolean;
  viewerIsAdmin: boolean;
  currentTurn: number;
}

export function OrdersTab(props: Props) {
  const router = useRouter();
  /** "normal" = office-holder flow, "admin" = admin-override flow, null = closed. */
  const [modalMode, setModalMode] = useState<"normal" | "admin" | null>(null);
  const [rescindingId, setRescindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Country-aware order label: presidential systems issue "Executive Orders",
  // parliamentary systems issue "Orders in Council" — both at state/regional
  // scope and at the national scope.
  const countryId = props.countryId.toUpperCase() as CountryId;
  const orderName = getExecutiveOrderName(countryId);
  const orderNamePlural = getExecutiveOrderNamePlural(countryId);
  const orderNameLower = orderName.toLowerCase();
  const orderNamePluralLower = orderNamePlural.toLowerCase();

  async function rescind(orderId: string) {
    if (!props.viewerCanManage) return;
    setRescindingId(orderId);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${props.countryId.toLowerCase()}/region/${props.stateId.toLowerCase()}/office/orders/${orderId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to rescind.");
      } else {
        router.refresh();
      }
    } finally {
      setRescindingId(null);
    }
  }

  const slotsUsed = props.activeOrders.length;
  const canIssue =
    props.viewerCanManage && slotsUsed < EXEC_ORDER_SLOT_CAP && props.gubernatorialActions >= 1;
  const issueDisabledReason = !props.viewerCanManage
    ? "Office-holder or authorized party officer only."
    : slotsUsed >= EXEC_ORDER_SLOT_CAP
      ? "Both slots in use — rescind one to issue a new order."
      : props.gubernatorialActions < 1
        ? "Insufficient office action points."
        : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">
          <div>
            {slotsUsed}/{EXEC_ORDER_SLOT_CAP} active · Office AP {props.gubernatorialActions}/
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
          + Issue order
        </button>
      </div>
      {props.viewerIsAdmin && (
        <section className="flex flex-col gap-2 rounded-xl border border-error/40 bg-error/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Admin — issue {orderNameLower}</div>
            <div className="text-xs text-muted">
              Bypasses the office-holder check and the AP cost.
            </div>
          </div>
          <button
            onClick={() => setModalMode("admin")}
            disabled={props.activeOrders.length >= EXEC_ORDER_SLOT_CAP}
            className="self-end rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/80 disabled:opacity-50 sm:self-auto"
            title={
              props.activeOrders.length >= EXEC_ORDER_SLOT_CAP
                ? "Both slots in use — rescind one to issue a new order."
                : ""
            }
          >
            + Admin Override
          </button>
        </section>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {props.activeOrders.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-sm text-muted text-center">
          No active {orderNamePluralLower}.
        </div>
      ) : (
        <ul className="space-y-2">
          {props.activeOrders.map((o) => (
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
                  <span>
                    {" "}
                    · expires in {Math.max(0, o.expiresAtTurn - props.currentTurn)} turns
                  </span>
                  <span> · issued by {o.issuedByName}</span>
                </div>
              </div>
              <button
                onClick={() => rescind(o._id)}
                disabled={!props.viewerCanManage || rescindingId === o._id}
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
        countryId={props.countryId}
        stateId={props.stateId}
        adminOverride={modalMode === "admin"}
        existingOrderTypeIds={new Set(props.activeOrders.map((o) => o.legislationTypeId))}
        gubernatorialActions={props.gubernatorialActions}
        onClose={() => setModalMode(null)}
        onSuccess={() => {
          setModalMode(null);
          router.refresh();
        }}
      />

      {props.orderHistory.length > 0 && (
        <section className="pt-2">
          <h3 className="text-xs uppercase tracking-widest text-muted mb-2">Recent orders</h3>
          <ul className="space-y-1.5">
            {props.orderHistory.map((o) => (
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

function HistoryStatusBadge({ status }: { status: OrderHistoryEntry["status"] }) {
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
