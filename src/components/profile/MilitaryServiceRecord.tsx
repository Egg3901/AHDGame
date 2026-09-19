"use client";
import { useTranslations } from "next-intl";
import type { GeneralPosting } from "@/lib/military/generalPosting";
export interface MilitaryService {
  commissioned: boolean;
  commissionedTurn?: number;
  dismissedTurn?: number;
}
export function MilitaryServiceRecord({
  service,
  posting,
}: {
  service: MilitaryService;
  posting?: GeneralPosting;
}) {
  const t = useTranslations("profile.views");
  const events = [
    ...(service.commissionedTurn != null
      ? [{ turn: service.commissionedTurn, kind: "commission" as const }]
      : []),
    ...(service.dismissedTurn != null
      ? [{ turn: service.dismissedTurn, kind: "dismissal" as const }]
      : []),
  ].sort((a, b) => b.turn - a.turn);
  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <h2 className="text-lg font-semibold">{t("service")}</h2>
      <p className="font-medium">{t(service.commissioned ? "active" : "retired")}</p>
      {events.length ? (
        <ol className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.kind}>{t(e.kind, { turn: e.turn })}</li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">{t("unknownDates")}</p>
      )}
      {service.commissioned && (
        <div className="border-t border-card-border pt-3 text-sm space-y-1">
          <h3 className="font-semibold">{t("currentPosting")}</h3>
          <p>
            {posting?.formationName ? t("command", { name: posting.formationName }) : t("reserve")}
          </p>
          {posting?.theaterName && <p>{t("theater", { name: posting.theaterName })}</p>}
          <p>{t("units", { count: posting?.unitCount ?? 0 })}</p>
        </div>
      )}
      <p className="text-xs text-muted">{t("recordHint")}</p>
    </section>
  );
}
