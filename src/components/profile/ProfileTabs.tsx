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
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t("label")}
        className="flex flex-wrap gap-1 rounded-lg border border-card-border bg-card p-1"
      >
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
            className={`min-w-0 rounded-md px-3 py-2 text-sm font-semibold ${item.locked ? "cursor-not-allowed text-muted opacity-60" : tab === item.id ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"}`}
            title={item.locked ?? undefined}
          >
            {t(item.id)}
            {item.locked && <span className="ml-2 text-xs">{t("locked")}</span>}
          </button>
        ))}
      </div>
      <div className="text-xs text-muted space-y-1">
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
        className="space-y-5"
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
              <p className="text-sm text-muted">{t("awaiting")}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
