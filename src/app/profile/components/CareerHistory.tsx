"use client";

import { useMemo, useState } from "react";
import type { Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyTenure } from "@/lib/parties/historyQuery";
import { getOfficeCountry, getOfficeLabel } from "@/lib/utils/politics";
import { formatGameMonth, type GameDateAnchor } from "@/lib/utils/gameDate";
import { formatStableUtc } from "@/lib/time/localTime";
import { EmptyState } from "@/components/ui";
import { Modal } from "@/components/ui";
import { SectionHeader } from "./ProfileMeters";

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
}: {
  event: CareerEvent;
  partyNames: Record<string, string>;
  countryId: CountryId | undefined;
  gameDateAnchor?: GameDateAnchor;
}) {
  const isRelocation = event.type === "relocated";
  const verb =
    event.type === "elected"
      ? "Elected to "
      : event.type === "lost_election"
        ? "Lost race for "
        : event.type === "resigned"
          ? "Resigned from "
          : event.type === "removed"
            ? "Removed from "
            : isRelocation
              ? event.fromCountry && event.toCountry && event.fromCountry !== event.toCountry
                ? `Relocated (${event.fromCountry} → ${event.toCountry}) `
                : "Relocated "
              : "Appointed to ";
  const body = isRelocation
    ? `${event.fromState ?? "?"} → ${event.toState ?? "?"}`
    : event.office
      ? getOfficeLabel(event.office, countryId)
      : event.officeLabel;

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
      <p className="text-sm font-medium text-foreground leading-snug">
        {verb}
        {body}
      </p>
      {partyLabel && <p className="text-xs text-muted mt-0.5">{partyLabel}</p>}
    </div>
  );
}

function formatTenureDate(date: Date | null, gameDateAnchor: GameDateAnchor | undefined): string {
  if (!date) return "Present";
  return gameDateAnchor
    ? formatGameMonth(date, gameDateAnchor)
    : formatStableUtc(date, { year: "numeric", month: "short" });
}

function tenureStartVerb(kind: PartyTenure["startKind"]): string {
  switch (kind) {
    case "founded":
      return "Founded";
    case "became_independent":
      return ""; // Independent rows just show the date
    case "switched_to":
    case "started":
    case "joined":
    default:
      return "Joined";
  }
}

function tenureEndPhrase(
  tenure: PartyTenure,
  gameDateAnchor: GameDateAnchor | undefined,
  nextLabel: string | undefined
): string {
  const endLabel = formatTenureDate(tenure.endedAt, gameDateAnchor);
  if (tenure.endKind === "present") return "Present";
  if (tenure.endKind === "left") return `Left ${endLabel}`;
  if (tenure.endKind === "purged") return `Purged ${endLabel}`;
  // switched_to: from Independent → "Joined X"; from a party → "Switched to X".
  const verb = tenure.partyId === null ? "Joined" : "Switched to";
  return `${verb} ${nextLabel ?? "next party"} ${endLabel}`;
}

function resolveTenurePartyLabel(tenure: PartyTenure, partyNames: Record<string, string>): string {
  if (tenure.partyId === null) return "Independent";
  if (tenure.partyName) return tenure.partyName;
  if (tenure.partyCountryId) {
    const hit = partyNames[`${tenure.partyCountryId}:${tenure.partyId}`];
    if (hit) return hit;
  }
  return `Party ${tenure.partyId}`;
}

function PartyTenureItem({
  tenure,
  nextTenure,
  partyNames,
  gameDateAnchor,
}: {
  tenure: PartyTenure;
  nextTenure: PartyTenure | undefined;
  partyNames: Record<string, string>;
  gameDateAnchor?: GameDateAnchor;
}) {
  const isIndependent = tenure.partyId === null;
  const dotClass = isIndependent ? "bg-muted" : "bg-success";
  const startVerb = tenureStartVerb(tenure.startKind);
  const startLabel = formatTenureDate(tenure.startedAt, gameDateAnchor);
  const startText = startVerb ? `${startVerb} ${startLabel}` : startLabel;
  // Pre-compute next-tenure label for the "Switched to ..." end phrase using
  // the same name-resolution chain (snapshot → partyNames lookup → fallback).
  const nextLabel = nextTenure
    ? nextTenure.partyId === null
      ? "Independent"
      : (nextTenure.partyName ??
        (nextTenure.partyCountryId
          ? partyNames[`${nextTenure.partyCountryId}:${nextTenure.partyId}`]
          : undefined) ??
        `Party ${nextTenure.partyId}`)
    : undefined;
  const endText = tenureEndPhrase(tenure, gameDateAnchor, nextLabel);
  const isSynthetic = tenure.startSynthetic || tenure.endSynthetic;
  const partyLabel = resolveTenurePartyLabel(tenure, partyNames);

  return (
    <div className="relative pl-4 border-l-2 border-card-border/60 pb-1">
      <div
        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${dotClass}`}
      />
      <p className="text-sm font-medium text-foreground leading-snug">{partyLabel}</p>
      <p className="text-xs text-muted mt-0.5">
        {startText} — {endText}
        {isSynthetic && <span className="italic ml-1 text-muted/70">(historical)</span>}
      </p>
    </div>
  );
}

const TAB_LABELS: Record<TabId, string> = {
  elected: "Elected",
  executive: "Executive",
  party: "Party",
  other: "Other",
};

const PREVIEW_COUNT = 3;

function TabStrip({
  tabs,
  active,
  onSelect,
  counts,
}: {
  tabs: TabId[];
  active: TabId;
  onSelect: (id: TabId) => void;
  counts: Record<TabId, number>;
}) {
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
          {TAB_LABELS[tab]} <span className="text-muted/70">({counts[tab]})</span>
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
      <SectionHeader>Career History</SectionHeader>

      {showTabs && (
        <TabStrip tabs={available} active={safeActive} onSelect={setActiveTab} counts={counts} />
      )}

      <div className="space-y-4">
        {showIncumbent && character.currentOffice && (
          <div className="relative pl-4 border-l-2 border-primary">
            <div className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
            <p className="text-sm font-bold text-foreground">
              {getOfficeLabel(character.currentOffice, character.countryId)}
            </p>
            <p className="text-xs text-primary font-medium">Incumbent</p>
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
                />
              ))
            : !showIncumbent && (
                <EmptyState
                  title="Career Start"
                  description="No history yet."
                  actionLabel="Find Election"
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
            View all {totalCount} events
          </button>
        )}
      </div>

      <Modal
        open={modalOpen}
        title="Career History"
        onClose={() => setModalOpen(false)}
        maxWidthClass="max-w-2xl"
      >
        {showTabs && (
          <TabStrip
            tabs={available}
            active={safeModalActive}
            onSelect={setModalTab}
            counts={counts}
          />
        )}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 scrollbar-hide">
          {showModalIncumbent && character.currentOffice && (
            <div className="relative pl-4 border-l-2 border-primary">
              <div className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" />
              <p className="text-sm font-bold text-foreground">
                {getOfficeLabel(character.currentOffice, character.countryId)}
              </p>
              <p className="text-xs text-primary font-medium">Incumbent</p>
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
                />
              ))
            : (groups[safeModalActive as OfficeTabId] ?? []).map((event, i) => (
                <EventItem
                  key={i}
                  event={event}
                  partyNames={partyNames}
                  countryId={character.countryId}
                  gameDateAnchor={gameDateAnchor}
                />
              ))}
        </div>
      </Modal>
    </div>
  );
}
