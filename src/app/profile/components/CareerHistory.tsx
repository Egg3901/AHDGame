"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyTenure } from "@/lib/parties/historyQuery";
import { getOfficeCountry, getOfficeLabel } from "@/lib/utils/politics";
import { formatGameMonth, type GameDateAnchor } from "@/lib/utils/gameDate";
import { formatStableUtc } from "@/lib/time/localTime";
import { EmptyState } from "@/components/ui";
import { Modal } from "@/components/ui";
import { SectionHeader } from "./ProfileMeters";

type CareerT = ReturnType<typeof useTranslations>;

type CareerEvent = NonNullable<Character["careerHistory"]>[number];
type TabId = "elected" | "executive" | "party" | "other";
type OfficeTabId = "elected" | "executive" | "other";

interface CareerHistoryProps {
  /** Narrowed to the only fields this client component reads — avoids
   *  passing ObjectId fields (`_id`, `userId`, `factionId`) through the
   *  RSC boundary, which Next.js rejects as non-plain. */
  character: Pick<Character, "careerHistory" | "currentOffice" | "countryId">;
  /** Map of "countryId:sequentialId" → display name, resolved from the DB */
  partyNames?: Record<string, string>;
  /** Game-time anchor used to render event dates as in-game month/year. */
  gameDateAnchor?: GameDateAnchor;
  /** Pre-built tenures for the Party tab. Empty/undefined hides the tab. */
  partyHistory?: PartyTenure[];
}

const CABINET_OFFICE_TYPES = new Set([
  "usCabinet",
  "ukCabinet",
  "parliamentaryCabinet",
  "deCabinet",
]);
const HEAD_OF_STATE_APPOINTED_TYPES = new Set([
  "primeMinister",
  "chancellor",
  "vicePresident",
  // IE Taoiseach: head of government appointed by Dáil confidence vote
  // (parallel to UK primeMinister). Uachtarán is directly elected and
  // stays in the "elected" tab.
  "taoiseach",
]);

function categorizeEvent(event: CareerEvent): OfficeTabId {
  if (event.type === "relocated") return "other";
  if (event.type === "elected" || event.type === "lost_election") return "elected";

  // appointed / resigned / removed: route by office.
  const officeType = event.office?.type;
  if (officeType && CABINET_OFFICE_TYPES.has(officeType)) return "executive";
  if (officeType && HEAD_OF_STATE_APPOINTED_TYPES.has(officeType)) return "executive";
  if (event.type === "appointed") return "executive";
  return "elected";
}

function resolvePartyName(
  party: string | undefined,
  partyCountryId: string | undefined,
  partyNames: Record<string, string>,
  fallbackCountryIds: (string | undefined)[]
): string | undefined {
  if (!party) return undefined;
  if (partyCountryId) {
    const hit = partyNames[`${partyCountryId}:${party}`];
    if (hit) return hit;
  }
  for (const fallback of fallbackCountryIds) {
    if (!fallback) continue;
    const hit = partyNames[`${fallback}:${party}`];
    if (hit) return hit;
  }
  return party;
}

function EventDot({ type }: { type: string }) {
  const color =
    type === "elected"
      ? "bg-success"
      : type === "lost_election"
        ? "bg-error"
        : type === "relocated"
          ? "bg-primary/60"
          : "bg-muted";
  return (
    <div
      className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${color}`}
    />
  );
}

function EventItem({
  event,
  partyNames,
  countryId,
  gameDateAnchor,
  t,
}: {
  event: CareerEvent;
  partyNames: Record<string, string>;
  countryId: CountryId | undefined;
  gameDateAnchor?: GameDateAnchor;
  t: CareerT;
}) {
  const isRelocation = event.type === "relocated";
  const officeText = event.office
    ? getOfficeLabel(event.office, countryId)
    : (event.officeLabel ?? "");

  let text: string;
  if (isRelocation) {
    const fromState = event.fromState ?? "?";
    const toState = event.toState ?? "?";
    text =
      event.fromCountry && event.toCountry && event.fromCountry !== event.toCountry
        ? t("eventRelocatedCountries", {
            fromCountry: event.fromCountry,
            toCountry: event.toCountry,
            fromState,
            toState,
          })
        : t("eventRelocated", { fromState, toState });
  } else if (event.type === "elected") {
    text = t("eventElected", { office: officeText });
  } else if (event.type === "lost_election") {
    text = t("eventLostElection", { office: officeText });
  } else if (event.type === "resigned") {
    text = t("eventResigned", { office: officeText });
  } else if (event.type === "removed") {
    text = t("eventRemoved", { office: officeText });
  } else {
    text = t("eventAppointed", { office: officeText });
  }

  const officeCountry = getOfficeCountry(event.office?.type);
  const partyLabel = resolvePartyName(event.party, event.partyCountryId, partyNames, [
    officeCountry,
    countryId,
  ]);

  // Real-world dates are concatenated/displayed as text here, so use the deterministic
  // UTC formatter rather than `toLocaleDateString` (which differs server vs client -> #418).
  const dateLabel = gameDateAnchor
    ? formatGameMonth(event.date, gameDateAnchor)
    : formatStableUtc(event.date, { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="relative pl-4 border-l-2 border-card-border/60 pb-1">
      <EventDot type={event.type} />
      <p className="text-xs text-muted mb-0.5">{dateLabel}</p>
      <p className="text-sm font-medium text-foreground leading-snug">{text}</p>
      {partyLabel && <p className="text-xs text-muted mt-0.5">{partyLabel}</p>}
    </div>
  );
}

function formatTenureDate(
  date: Date | null,
  gameDateAnchor: GameDateAnchor | undefined,
  t: CareerT
): string {
  if (!date) return t("present");
  return gameDateAnchor
    ? formatGameMonth(date, gameDateAnchor)
    : formatStableUtc(date, { year: "numeric", month: "short" });
}

function tenureStartText(
  tenure: PartyTenure,
  gameDateAnchor: GameDateAnchor | undefined,
  t: CareerT
): string {
  const date = formatTenureDate(tenure.startedAt, gameDateAnchor, t);
  switch (tenure.startKind) {
    case "founded":
      return t("tenureFounded", { date });
    case "renamed":
      return t("tenureRenamed", { date });
    case "became_independent":
      return date; // Independent rows just show the date
    case "switched_to":
    case "started":
    case "joined":
    default:
      return t("tenureJoined", { date });
  }
}

function tenureEndPhrase(
  tenure: PartyTenure,
  gameDateAnchor: GameDateAnchor | undefined,
  nextLabel: string | undefined,
  t: CareerT
): string {
  const endLabel = formatTenureDate(tenure.endedAt, gameDateAnchor, t);
  if (tenure.endKind === "present") return t("present");
  if (tenure.endKind === "left") return t("tenureLeft", { date: endLabel });
  if (tenure.endKind === "purged") return t("tenurePurged", { date: endLabel });
  if (tenure.endKind === "renamed") {
    return t("tenureRenamedTo", { party: nextLabel ?? t("nextPartyFallback"), date: endLabel });
  }
  // switched_to: from Independent → "Joined X"; from a party → "Switched to X".
  const party = nextLabel ?? t("nextPartyFallback");
  return tenure.partyId === null
    ? t("tenureJoinedNext", { party, date: endLabel })
    : t("tenureSwitched", { party, date: endLabel });
}

function resolveTenurePartyLabel(
  tenure: PartyTenure,
  partyNames: Record<string, string>,
  t: CareerT
): string {
  if (tenure.partyId === null) return t("independent");
  if (tenure.partyName) return tenure.partyName;
  if (tenure.partyCountryId) {
    const hit = partyNames[`${tenure.partyCountryId}:${tenure.partyId}`];
    if (hit) return hit;
  }
  return t("partyFallback", { id: tenure.partyId });
}

function PartyTenureItem({
  tenure,
  nextTenure,
  partyNames,
  gameDateAnchor,
  t,
}: {
  tenure: PartyTenure;
  nextTenure: PartyTenure | undefined;
  partyNames: Record<string, string>;
  gameDateAnchor?: GameDateAnchor;
  t: CareerT;
}) {
  const isIndependent = tenure.partyId === null;
  const dotClass = isIndependent ? "bg-muted" : "bg-success";
  const startText = tenureStartText(tenure, gameDateAnchor, t);
  // Pre-compute next-tenure label for the "Switched to ..." end phrase using
  // the same name-resolution chain (snapshot → partyNames lookup → fallback).
  const nextLabel = nextTenure
    ? nextTenure.partyId === null
      ? t("independent")
      : (nextTenure.partyName ??
        (nextTenure.partyCountryId
          ? partyNames[`${nextTenure.partyCountryId}:${nextTenure.partyId}`]
          : undefined) ??
        t("partyFallback", { id: nextTenure.partyId }))
    : undefined;
  const endText = tenureEndPhrase(tenure, gameDateAnchor, nextLabel, t);
  const isSynthetic = tenure.startSynthetic || tenure.endSynthetic;
  const partyLabel = resolveTenurePartyLabel(tenure, partyNames, t);

  return (
    <div className="relative pl-4 border-l-2 border-card-border/60 pb-1">
      <div
        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${dotClass}`}
      />
      <p className="text-sm font-medium text-foreground leading-snug">{partyLabel}</p>
      <p className="text-xs text-muted mt-0.5">
        {t("tenureRange", { start: startText, end: endText })}
        {isSynthetic && <span className="italic ml-1 text-muted/70">({t("historical")})</span>}
      </p>
    </div>
  );
}

const PREVIEW_COUNT = 3;

function TabStrip({
  tabs,
  active,
  onSelect,
  counts,
  t,
}: {
  tabs: TabId[];
  active: TabId;
  onSelect: (id: TabId) => void;
  counts: Record<TabId, number>;
  t: CareerT;
}) {
  const tabLabels: Record<TabId, string> = {
    elected: t("tabElected"),
    executive: t("tabExecutive"),
    party: t("tabParty"),
    other: t("tabOther"),
  };
  return (
    <div className="flex gap-2 mb-4 border-b border-card-border">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tab)}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
            active === tab
              ? "border-primary text-primary"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {tabLabels[tab]} <span className="text-muted/70">({counts[tab]})</span>
        </button>
      ))}
    </div>
  );
}

export function CareerHistory({
  character,
  partyNames = {},
  gameDateAnchor,
  partyHistory = [],
}: CareerHistoryProps) {
  const t = useTranslations("profile.career");
  const [modalOpen, setModalOpen] = useState(false);

  const { groups, available, totalCount } = useMemo(() => {
    const reversed = [...(character.careerHistory ?? [])].reverse();
    const buckets: Record<OfficeTabId, CareerEvent[]> = {
      elected: [],
      executive: [],
      other: [],
    };
    for (const event of reversed) {
      buckets[categorizeEvent(event)].push(event);
    }
    const orderedTabs: TabId[] = ["elected", "executive", "party", "other"];
    const visible = orderedTabs.filter((t) =>
      t === "party" ? partyHistory.length > 0 : buckets[t].length > 0
    );
    return {
      groups: buckets,
      available: visible,
      totalCount: reversed.length + partyHistory.length,
    };
  }, [character.careerHistory, partyHistory]);

  const incumbentTab: TabId | null = character.currentOffice
    ? CABINET_OFFICE_TYPES.has(character.currentOffice.type) ||
      HEAD_OF_STATE_APPOINTED_TYPES.has(character.currentOffice.type)
      ? "executive"
      : "elected"
    : null;

  const initialTab: TabId = available[0] ?? incumbentTab ?? "elected";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [modalTab, setModalTab] = useState<TabId>(initialTab);

  // Keep active tab valid if data changes (defensive).
  const safeActive: TabId = available.includes(activeTab) ? activeTab : initialTab;
  const safeModalActive: TabId = available.includes(modalTab) ? modalTab : initialTab;

  const counts: Record<TabId, number> = {
    elected: groups.elected.length,
    executive: groups.executive.length,
    party: partyHistory.length,
    other: groups.other.length,
  };

  const activeEvents = safeActive === "party" ? [] : (groups[safeActive as OfficeTabId] ?? []);
  const preview = activeEvents.slice(0, PREVIEW_COUNT);
  const showTabs = available.length > 1;
  const showIncumbent =
    character.currentOffice && safeActive !== "party" && (!showTabs || incumbentTab === safeActive);
  const showModalIncumbent =
    character.currentOffice &&
    safeModalActive !== "party" &&
    (!showTabs || incumbentTab === safeModalActive);

  const activeListLength = safeActive === "party" ? partyHistory.length : activeEvents.length;
  const hasMore = activeListLength > PREVIEW_COUNT;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <SectionHeader>{t("title")}</SectionHeader>

      {showTabs && (
        <TabStrip
          tabs={available}
          active={safeActive}
          onSelect={setActiveTab}
          counts={counts}
          t={t}
        />
      )}

      <div className="space-y-4">
        {showIncumbent && character.currentOffice && (
          <div className="relative pl-4 border-l-2 border-primary">
            <div className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
            <p className="text-sm font-bold text-foreground">
              {getOfficeLabel(character.currentOffice, character.countryId)}
            </p>
            <p className="text-xs text-primary font-medium">{t("incumbent")}</p>
          </div>
        )}

        {safeActive === "party"
          ? partyHistory
              .slice(0, PREVIEW_COUNT)
              .map((tenure, i) => (
                <PartyTenureItem
                  key={i}
                  tenure={tenure}
                  nextTenure={partyHistory[i + 1]}
                  partyNames={partyNames}
                  gameDateAnchor={gameDateAnchor}
                  t={t}
                />
              ))
          : preview.length > 0
            ? preview.map((event, i) => (
                <EventItem
                  key={i}
                  event={event}
                  partyNames={partyNames}
                  countryId={character.countryId}
                  gameDateAnchor={gameDateAnchor}
                  t={t}
                />
              ))
            : !showIncumbent && (
                <EmptyState
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  actionLabel={t("findElection")}
                  actionHref="/elections"
                />
              )}

        {hasMore && (
          <button
            type="button"
            onClick={() => {
              setModalTab(safeActive);
              setModalOpen(true);
            }}
            className="w-full text-xs text-primary hover:text-primary/80 font-medium py-1 transition-colors"
          >
            {t("viewAll", { count: totalCount })}
          </button>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={t("title")}
        onClose={() => setModalOpen(false)}
        maxWidthClass="max-w-2xl"
      >
        {showTabs && (
          <TabStrip
            tabs={available}
            active={safeModalActive}
            onSelect={setModalTab}
            counts={counts}
            t={t}
          />
        )}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 scrollbar-hide">
          {showModalIncumbent && character.currentOffice && (
            <div className="relative pl-4 border-l-2 border-primary">
              <div className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
              <p className="text-sm font-bold text-foreground">
                {getOfficeLabel(character.currentOffice, character.countryId)}
              </p>
              <p className="text-xs text-primary font-medium">{t("incumbent")}</p>
            </div>
          )}
          {safeModalActive === "party"
            ? partyHistory.map((tenure, i) => (
                <PartyTenureItem
                  key={i}
                  tenure={tenure}
                  nextTenure={partyHistory[i + 1]}
                  partyNames={partyNames}
                  gameDateAnchor={gameDateAnchor}
                  t={t}
                />
              ))
            : (groups[safeModalActive as OfficeTabId] ?? []).map((event, i) => (
                <EventItem
                  key={i}
                  event={event}
                  partyNames={partyNames}
                  countryId={character.countryId}
                  gameDateAnchor={gameDateAnchor}
                  t={t}
                />
              ))}
        </div>
      </Modal>
    </div>
  );
}
