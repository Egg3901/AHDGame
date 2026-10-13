"use client";
import { useTranslations, useFormatter } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { GroupManagementView } from "./useGroupManagement";
export function GroupSupplyConnections({ data }: { data: GroupManagementView }) {
  const t = useTranslations("corporations.group"),
    fmt = useFormatter(),
    { formatAmount } = useCurrency();
  const f = data.forecast,
    connections = f?.connections;
  const names = new Map(data.members.map((m) => [m.id, m.name]));
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{t("supplyUI.connections")}</h3>
        <p className="mt-1 text-sm text-muted">{t("supplyUI.connectionsHelp")}</p>
      </div>
      {!data.canManage ? (
        <p className="text-sm text-muted">{t("supplyUI.connectionsPrivate")}</p>
      ) : !connections ? (
        <p className="text-sm text-muted">{t("supplyUI.unavailableConnections")}</p>
      ) : !connections.length ? (
        <p className="rounded-lg border border-card-border bg-card p-4 text-sm text-muted">
          {t("supplyUI.noConnections")}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted">
            {t("supplyUI.connectionCount", {
              shown: connections.length,
              count: f?.connectionCount ?? connections.length,
            })}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {connections.map((c) => (
              <article
                className="min-w-0 space-y-3 rounded-xl border border-card-border bg-card p-5"
                key={JSON.stringify([c.supplierId, c.buyerId, c.commodity])}
              >
                <p className="text-xs uppercase tracking-wide text-gold">
                  {c.commodityLabel ?? c.commodity}
                </p>
                <h4 className="break-words font-semibold">
                  {names.get(c.supplierId) ?? c.supplierId} → {names.get(c.buyerId) ?? c.buyerId}
                </h4>
                <dl className="space-y-2 text-sm">
                  {[
                    [
                      t("supplyUI.units"),
                      fmt.number(c.units, { maximumFractionDigits: 2 }) + " " + (c.unit ?? ""),
                    ],
                    [t("supplyUI.benchmark"), formatAmount(c.benchmarkValue)],
                    [t("supplyUI.rebate"), formatAmount(c.rebate)],
                    [t("supplyUI.payment"), formatAmount(c.estimatedPayment)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex flex-wrap justify-between gap-2 border-t border-card-border pt-2"
                    >
                      <dt className="text-muted">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted">{t("supplyUI.deliveryNote")}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
