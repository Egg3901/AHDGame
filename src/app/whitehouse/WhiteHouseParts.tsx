import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { SectionLabel } from "@/components/ui";
import { type CountryId } from "@/lib/constants/countries";

interface ExecutiveData {
  id: string;
  characterId: string;
  sequentialId?: number;
  characterName: string;
  party?: string;
  partyName?: string;
  partyColor?: string;
  countryId?: CountryId;
  avatarUrl?: string;
  administrationStartDate?: string | null;
  /** Serving as acting president while the House has not chosen. */
  isActing?: boolean;
  /** In-game week + year the official was seated (e.g. "Week 23, 1991"). */
  administrationStartGameDate?: string | null;
  /** True when the seat is held by an NPP (non-player politician) rather than a Character. */
  isNPP?: boolean;
}

/**
 * Profile link for an executive holder: the NPP profile when NPP-backed,
 * otherwise the character profile (sequentialId preferred over raw id).
 */
export function holderHref(holder: {
  isNPP?: boolean;
  sequentialId?: number;
  characterId: string;
}): string {
  return holder.isNPP
    ? `/politicians/npp/${holder.sequentialId}`
    : `/character/${holder.sequentialId ?? holder.characterId}`;
}

/** Where the White House points players for presidential powers and running. */
export const PRESIDENCY_EXPLAINER_HREF = "/wiki/reference-offices";
export const RUNNING_GUIDE_HREF = "/guides/running-for-office";

/** Desk deadline copy: what is left, or what happens once it is gone. */
export function deskDeadlineLabel(remaining: { text: string; urgency: string }): string {
  if (remaining.urgency === "ended") {
    return "Deadline passed: becomes law without your signature when the turn processes";
  }
  return `Sign or veto within ${remaining.text}`;
}

export interface PendingBill {
  id: string;
  title: string;
  summary: string;
  sentToPresidentAt: string | null;
  presidentActionDeadline: string | null;
  presidentActionDeadlineOnTurn?: number | null;
}

interface VpNomination {
  id: string;
  nomineeCharacterId: string;
  nomineeCharacterName: string;
  nomineeParty?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  myVote: "for" | "against" | "abstain" | null;
}

export interface WhiteHouseResponse {
  president: ExecutiveData | null;
  vicePresident: ExecutiveData | null;
  /** Sitting president's current term (1-based), from executiveTermsServed. */
  presidentCurrentTerm: number | null;
  presidentOfficialId: string | null;
  vicePresidentOfficialId: string | null;
  isAdmin: boolean;
  isPresident: boolean;
  isVicePresident: boolean;
  isSenator: boolean;
  vpNomination: VpNomination | null;
}

export interface Character {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  currentOffice: Record<string, unknown> | null;
}

export function ExecutiveCard({
  title,
  data,
  officialId,
  onAppoint,
  isAdmin,
  onInitialize,
  needsInit,
  onResign,
  resignLoading,
  onNominateVp,
  vpNominationPending,
}: {
  title: string;
  data: ExecutiveData | null;
  officialId: string | null;
  onAppoint: () => void;
  isAdmin: boolean;
  onInitialize?: () => void;
  needsInit?: boolean;
  onResign?: () => void;
  resignLoading?: boolean;
  onNominateVp?: () => void;
  vpNominationPending?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden transition-colors shadow-sm hover:shadow-md">
      <div className="p-6">
        <SectionLabel as="h3">{title}</SectionLabel>
        {data ? (
          <div className="flex items-center gap-4">
            <Link href={holderHref(data)} className="shrink-0">
              <Avatar
                url={data.avatarUrl}
                name={data.characterName}
                size="h-16 w-16"
                className="rounded-xl text-2xl ring-2 ring-card-border"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={holderHref(data)}
                className="font-semibold text-foreground hover:text-primary transition-colors"
              >
                {data.characterName}
              </Link>
              <div className="mt-1">
                <PartyChip
                  partyName={data.partyName ?? data.party ?? "Independent"}
                  partyColor={data.partyColor ?? "#888888"}
                  partyId={data.party ?? "independent"}
                  countryId={data.countryId ?? "US"}
                />
                {data.administrationStartGameDate && (
                  <p className="text-xs text-muted mt-1">
                    Since {data.administrationStartGameDate}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {onResign && officialId && (
                <button
                  onClick={onResign}
                  disabled={resignLoading}
                  className="rounded-lg border border-error/40 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50 transition-colors"
                >
                  {resignLoading ? "Resigning…" : "Resign"}
                </button>
              )}
              {isAdmin && officialId && (
                <button
                  onClick={onAppoint}
                  className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-card-elevated hover:text-foreground transition-colors"
                >
                  Change
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-card-elevated flex items-center justify-center text-2xl text-muted ring-2 ring-dashed ring-card-border">
              —
            </div>
            <div className="flex-1">
              <p className="text-muted italic">Vacant</p>
              <p className="text-xs text-muted mt-0.5">
                {needsInit
                  ? "Initialize executive slots in Admin first"
                  : onNominateVp
                    ? vpNominationPending
                      ? "Nomination pending Senate confirmation"
                      : "President can nominate a replacement (25th Amendment)"
                    : "Admin can appoint a player character"}
              </p>
            </div>
            {isAdmin && needsInit && onInitialize && (
              <button
                onClick={onInitialize}
                className="rounded-lg bg-warning/15 text-warning border border-warning/40 px-3 py-1.5 text-xs font-medium hover:bg-warning/25 transition-colors"
              >
                Initialize
              </button>
            )}
            {isAdmin && officialId && !needsInit && (
              <button
                onClick={onAppoint}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
              >
                Appoint
              </button>
            )}
            {onNominateVp && !vpNominationPending && (
              <button
                onClick={onNominateVp}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
              >
                Nominate VP
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export type TabKey = "overview" | "address" | "orders" | "endorsements" | "foreign" | "admin";

const TAB_KEYS = ["overview", "address", "orders", "endorsements", "foreign", "admin"] as const;

/** Narrows an untrusted `?tab=` value. Anything else falls back to the overview. */
export function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}
