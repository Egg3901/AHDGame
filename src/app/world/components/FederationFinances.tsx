"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { LegacyServiceSnapshot } from "@/lib/world/succession/legacyServiceSnapshot";

export default function FederationFinances({ snapshots }: { snapshots: LegacyServiceSnapshot[] }) {
  const t = useTranslations("worldConflicts.federationFinances");
  const format = useFormatter();
  const amount = (minor: number) =>
    format.number(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!snapshots.length) return null;
  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted">{t("accounting")}</p>
      {snapshots.map((snapshot) => (
        <article
          key={snapshot.sourceCountryId}
          className="rounded-lg border border-card-border bg-card p-5 space-y-3"
        >
          <h3 className="font-semibold">
            {t(
              snapshot.servicingKind === "continuing-state" ? "continuingIssuer" : "administration",
              { source: snapshot.sourceName, turn: snapshot.turn }
            )}
          </h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt>{t("creditorDue")}</dt>
              <dd>{amount(snapshot.creditorDueMinor)}</dd>
            </div>
            <div>
              <dt>
                {t(snapshot.servicingKind === "continuing-state" ? "issuerOwnShare" : "overdraft")}
              </dt>
              <dd>
                {amount(
                  snapshot.servicingKind === "continuing-state"
                    ? (snapshot.issuerOwnShareMinor ?? 0)
                    : snapshot.bridgeOutstandingMinor
                )}
              </dd>
            </div>
            <div>
              <dt>{t(snapshot.servicingKind === "continuing-state" ? "issuerCash" : "cash")}</dt>
              <dd>{amount(snapshot.administrationCashAfterMinor)}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">{t("successor")}</th>
                  <th scope="col">{t("contribution")}</th>
                  <th scope="col">{t("arrears")}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.successors.map((successor) => (
                  <tr key={successor.entityId}>
                    <th scope="row">{successor.name}</th>
                    <td>{amount(successor.contributionMinor)}</td>
                    <td>{amount(successor.arrearsMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            {t(snapshot.servicingKind === "continuing-state" ? "continuingRisk" : "risk")}
          </p>
        </article>
      ))}
    </section>
  );
}
