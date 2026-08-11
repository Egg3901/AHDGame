"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useGameClock } from "@/contexts/useGameClock";
import { getCabinetActionCopy } from "./actionCopy";
import { MINISTERIAL_ACTION_RESET_HINT } from "@/lib/cabinet/ministerialActionPool";

interface Order {
  id: string;
  name: string;
  description: string;
  duration: number;
  effects: unknown[];
}

interface ActiveOrder {
  orderId: string;
  orderName: string;
  issuedTurn: number;
  expiresTurn: number;
}

interface RegionRow {
  regionId: string;
  regionName: string;
}

interface MinisterialOrderPanelProps {
  orders: Order[];
  activeOrders: ActiveOrder[];
  actionsRemaining: number;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  singleRegionFocus: string | null;
  regionData: RegionRow[];
  onUpdate: () => void;
}

export function MinisterialOrderPanel({
  orders,
  activeOrders,
  actionsRemaining,
  canAct,
  positionId,
  countryCode,
  singleRegionFocus,
  regionData,
  onUpdate,
}: MinisterialOrderPanelProps) {
  const [regionSelections, setRegionSelections] = useState<Record<string, string>>({});
  const [issuing, setIssuing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    orderId: string;
    type: "success" | "error";
    message: string;
  } | null>(null);

  const { formatRemainingTurns } = useGameClock();

  const canIssue = canAct && actionsRemaining > 0;
  const actionCopy = getCabinetActionCopy(countryCode);
  const panelTitle =
    actionCopy.title === "Cabinet Actions" ? "Cabinet Orders" : "Ministerial Orders";

  async function handleIssue(orderId: string) {
    if (!canIssue || issuing) return;
    setIssuing(orderId);
    setFeedback(null);

    const regionId = singleRegionFocus ?? regionSelections[orderId] ?? null;

    try {
      const response = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, targetRegionId: regionId }),
        }
      );
      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        setFeedback({
          orderId,
          type: "error",
          message: json.error ?? "Failed to issue order",
        });
        return;
      }
      setFeedback({ orderId, type: "success", message: "Order issued." });
      onUpdate();
    } catch {
      setFeedback({ orderId, type: "error", message: "Network error" });
    } finally {
      setIssuing(null);
    }
  }

  const activeOrderIds = new Set(activeOrders.map((order) => order.orderId));

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{panelTitle}</h2>
          <p className="mt-0.5 text-sm text-muted">
            Issue standing orders that apply department effects each turn.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`text-sm font-semibold ${actionsRemaining > 0 ? "text-foreground" : "text-muted"}`}
          >
            {actionsRemaining} {actionsRemaining !== 1 ? actionCopy.plural : actionCopy.singular}{" "}
            remaining
          </span>
          {actionsRemaining < 2 && (
            <p className="mt-1 text-xs text-muted">{MINISTERIAL_ACTION_RESET_HINT}</p>
          )}
        </div>
      </div>

      {activeOrders.length > 0 && (
        <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
            Active Orders
          </p>
          <ul className="space-y-1">
            {activeOrders.map((order) => {
              const remaining = formatRemainingTurns(order.expiresTurn);
              return (
                <li key={order.orderId} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{order.orderName}</span>
                  <span className="text-xs text-muted">{remaining.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="text-sm text-muted">
          No {actionCopy.title === "Cabinet Actions" ? "cabinet orders" : "ministerial orders"}{" "}
          available for this position.
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const isActive = activeOrderIds.has(order.id);
            const isIssuingThis = issuing === order.id;
            const orderFeedback = feedback?.orderId === order.id ? feedback : null;
            // An order is regional only if it carries a region-scoped effect; the
            // turn engine ignores the picked region for purely national effects.
            const isRegional = order.effects.some(
              (e) =>
                typeof e === "object" &&
                e !== null &&
                (e as { scope?: string }).scope === "regional"
            );

            return (
              <div
                key={order.id}
                className={[
                  "rounded-lg border p-4",
                  isActive
                    ? "border-primary/30 bg-primary/5"
                    : "border-card-border bg-card-elevated",
                ].join(" ")}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{order.name}</h3>
                      <span
                        className={[
                          "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          isRegional
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-card-border bg-card-muted text-muted",
                        ].join(" ")}
                        title={
                          isRegional
                            ? "Applies to the selected region"
                            : "Applies nationwide, across all regions"
                        }
                      >
                        {isRegional ? "Regional" : "National"}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-snug text-muted">{order.description}</p>
                    <p className="mt-1 text-xs text-muted">Duration: {order.duration} turns</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    {isRegional && !singleRegionFocus && regionData.length > 0 && !isActive && (
                      <select
                        value={regionSelections[order.id] ?? ""}
                        disabled={!canIssue}
                        onChange={(event) =>
                          setRegionSelections((current) => ({
                            ...current,
                            [order.id]: event.target.value,
                          }))
                        }
                        className={[
                          "rounded-lg border border-card-border bg-card px-2 py-1 text-xs text-foreground",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                          !canIssue ? "cursor-not-allowed opacity-50" : "",
                        ]
                          .join(" ")
                          .trim()}
                      >
                        <option value="">- Region -</option>
                        {regionData.map((region) => (
                          <option key={region.regionId} value={region.regionId}>
                            {region.regionName}
                          </option>
                        ))}
                      </select>
                    )}

                    {!isActive && (
                      <Button
                        variant="secondary"
                        disabled={!canIssue || isIssuingThis}
                        isLoading={isIssuingThis}
                        onClick={() => handleIssue(order.id)}
                      >
                        Issue Order
                      </Button>
                    )}
                  </div>
                </div>

                {orderFeedback && (
                  <p
                    className={`mt-2 text-xs ${orderFeedback.type === "success" ? "text-success" : "text-error"}`}
                  >
                    {orderFeedback.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
