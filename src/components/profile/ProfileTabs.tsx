"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { GeneralProfileClient } from "@/app/world/conflicts/generals/GeneralProfileClient";
import type { CharacterSubject } from "@/app/world/conflicts/generals/useCharacterGeneral";
import type { ProfileGeneral } from "@/lib/military/generalsTree";
import type { GeneralPosting } from "@/lib/military/generalPosting";
import type { BusinessProfileView } from "@/lib/character/businessProfileView";
import { BusinessProfile } from "./BusinessProfile";
import { MilitaryServiceRecord, type MilitaryService } from "./MilitaryServiceRecord";

type ProfileView = "political" | "military" | "business";

/** Shared role views for self and public profiles, with explicit applicability locks. */
export function ProfileTabs({
  conflictsEnabled,
  subject,
  adopted,
  general,
  editable,
  curEra,
  posting,
  isCommandingGeneral = false,
  militaryService,
  business = null,
  actions,
  children,
}: {
  conflictsEnabled: boolean;
  subject: CharacterSubject;
  adopted: Record<string, number>;
  general: ProfileGeneral | null;
  editable: boolean;
  curEra: number;
  posting?: GeneralPosting;
  isCommandingGeneral?: boolean;
  militaryService?: MilitaryService;
  business?: BusinessProfileView | null;
  /** Shown at the right end of the tab row, outside the tab list. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("profile.views");
  const id = useId();
  const [selection, setSelection] = useState<{ subjectId: string; view: ProfileView }>({
    subjectId: subject.id,
    view: "political",
  });
  const service = militaryService ?? { commissioned: !!general };
  const militaryAvailable =
    conflictsEnabled &&
    (service.commissioned ||
      !!general ||
      service.commissionedTurn != null ||
      service.dismissedTurn != null);
  const requested = selection.subjectId === subject.id ? selection.view : "political";
  const tab =
    (requested === "military" && !militaryAvailable) || (requested === "business" && !business)
      ? "political"
      : requested;
  const tabs: { id: ProfileView; locked: string | null }[] = [
    { id: "political", locked: null },
    {
      id: "military",
      locked: militaryAvailable
        ? null
        : t(conflictsEnabled ? "militaryLocked" : "militaryDisabled"),
    },
    { id: "business", locked: business ? null : t("businessLocked") },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-card-border">
        <div role="tablist" aria-label={t("label")} className="flex flex-wrap gap-x-6">
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`${id}-${item.id}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`${id}-panel`}
              aria-disabled={!!item.locked}
              aria-describedby={item.locked ? `${id}-${item.id}-reason` : undefined}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => {
                if (!item.locked) setSelection({ subjectId: subject.id, view: item.id });
              }}
              onKeyDown={(e) => {
                if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const available = tabs.filter((x) => !x.locked);
                const current = available.findIndex((x) => x.id === item.id);
                const next =
                  e.key === "Home"
                    ? available[0]
                    : e.key === "End"
                      ? available[available.length - 1]
                      : available[
                          (current + (e.key === "ArrowRight" ? 1 : -1) + available.length) %
                            available.length
                        ];
                if (next) {
                  setSelection({ subjectId: subject.id, view: next.id });
                  document.getElementById(`${id}-${next.id}`)?.focus();
                }
              }}
              className={`-mb-px min-w-0 border-b-2 py-2 text-body font-medium transition-colors ${item.locked ? "cursor-not-allowed border-transparent text-muted opacity-60" : tab === item.id ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              title={item.locked ?? undefined}
            >
              {t(item.id)}
              {item.locked && <span className="ml-2 text-body-sm">{t("locked")}</span>}
            </button>
          ))}
        </div>
        {actions && <div className="ml-auto pb-2">{actions}</div>}
      </div>
      <div className="space-y-1 text-body-sm text-muted">
        {tabs
          .filter((item) => item.locked)
          .map((item) => (
            <p id={`${id}-${item.id}-reason`} key={item.id}>
              {t(item.id)}: {item.locked}
            </p>
          ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        className="space-y-10"
      >
        {tab === "political" && children}
        {tab === "business" && business && <BusinessProfile data={business} />}
        {tab === "military" && (
          <>
            <MilitaryServiceRecord service={service} posting={posting} />
            {general ? (
              <GeneralProfileClient
                key={subject.id}
                subject={subject}
                adopted={adopted}
                general={general}
                editable={editable && service.commissioned}
                curEra={curEra}
                posting={posting}
                isCommandingGeneral={isCommandingGeneral}
                serviceRecord={<MilitaryServiceRecord service={service} posting={posting} />}
              />
            ) : (
              <p className="text-body text-muted">{t("awaiting")}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
