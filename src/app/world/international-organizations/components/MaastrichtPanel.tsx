"use client";

import { useTranslations } from "next-intl";
import type { OrgSummary } from "../orgTypes";

export function MaastrichtPanel({ org }: { org: OrgSummary }) {
  const t = useTranslations("worldOrganizations.maastricht");
  const state = org.europeanIntegration;
  if (!state) return null;
  return (
    <section className="rounded-xl border border-card-border bg-card p-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="mt-2 text-sm text-muted">{t(state.stage)}</p>
      <p className="mt-2 text-sm text-muted">{t("commonMarket")}</p>
      {(state.stage === "community" || state.source === "ratified-treaty") && (
        <ul className="mt-3 space-y-3">
          {org.members.map((member) => {
            const decision = state.ratifications[member.countryId];
            return (
              <li key={member.countryId} className="text-sm">
                <span className="font-medium">
                  {member.flagEmoji} {member.countryName}
                </span>
                {" · "}
                {t(!decision ? "pending" : decision.approved ? "approved" : "rejected")}
                {decision && (
                  <span className="ml-2 text-muted">{t("turn", { turn: decision.turn })}</span>
                )}
                {decision?.reasons?.map((reason) => (
                  <p key={reason} className="mt-1 text-muted">
                    {reason}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
