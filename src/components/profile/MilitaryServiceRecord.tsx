"use client";
import { useTranslations } from "next-intl";
import type { GeneralPosting } from "@/lib/military/generalPosting";
import { SectionHeader } from "@/app/profile/components/ProfileMeters";
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
    <section className="space-y-3">
      <SectionHeader>{t("service")}</SectionHeader>
      <p className="text-body font-medium text-foreground">
        {t(service.commissioned ? "active" : "retired")}
      </p>
      {events.length ? (
        <ol className="space-y-2 text-body text-foreground">
          {events.map((e) => (
            <li key={e.kind}>{t(e.kind, { turn: e.turn })}</li>
          ))}
        </ol>
      ) : (
        <p className="text-body text-muted">{t("unknownDates")}</p>
      )}
      {service.commissioned && (
        <div className="space-y-1 border-t border-card-border/60 pt-3 text-body text-foreground">
          <h3 className="font-semibold">{t("currentPosting")}</h3>
          <p>
            {posting?.formationName ? t("command", { name: posting.formationName }) : t("reserve")}
          </p>
          {posting?.theaterName && <p>{t("theater", { name: posting.theaterName })}</p>}
          <p>{t("units", { count: posting?.unitCount ?? 0 })}</p>
        </div>
      )}
      <p className="text-body-sm text-muted">{t("recordHint")}</p>
    </section>
  );
}
