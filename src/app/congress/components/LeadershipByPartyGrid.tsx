"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { formatPartyState } from "./CongressShared";

export type LeaderDisplay = {
  role: string;
  label: string;
  chamber: "house" | "senate";
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId?: number | null;
  characterName: string;
  party: string | null;
  partyName: string;
  partyColor: string;
  state?: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  isVacant: boolean;
};

function LeaderRow({
  leader,
  showAssign,
  onAssign,
  onClear,
}: {
  leader: LeaderDisplay;
  showAssign: boolean;
  onAssign: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-card-border/30 py-2 last:border-0">
      <Avatar
        url={leader.avatarUrl}
        name={leader.characterName}
        size="h-10 w-10"
        borderKey={leader.borderKey}
        tintColor={leader.tintColor}
      />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{leader.label}</span>
        {leader.isVacant ? (
          <span className="ml-2 text-xs italic text-muted/60">Vacant</span>
        ) : (
          <span className="ml-2 text-xs" style={{ color: leader.partyColor }}>
            <Link
              href={`/character/${leader.sequentialId ?? leader.characterId}`}
              className="hover:underline"
            >
              {leader.characterName}
            </Link>
            <span className="text-muted">
              {" "}
              {formatPartyState(leader.party, leader.state, leader.partyName)}
            </span>
          </span>
        )}
      </div>
      {showAssign && (
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={onAssign}
            className="rounded border border-card-border bg-card px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Assign
          </button>
          {!leader.isVacant && (
            <button
              type="button"
              onClick={onClear}
              className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type PartyPanelProps = {
  title: "Majority" | "Minority";
  subtitle: string;
  seats: number;
  detail?: string | null;
  leaders: LeaderDisplay[];
  leadersAdmin: boolean;
  onAssign: (role: string) => void;
  onClear: (role: string) => void;
};

function PartyPanel({
  title,
  subtitle,
  seats,
  detail,
  leaders,
  leadersAdmin,
  onAssign,
  onClear,
}: PartyPanelProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="border-b border-card-border bg-card/80 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {subtitle} - {seats} seats
        </p>
        {detail ? <p className="mt-1 text-xs text-muted/80">{detail}</p> : null}
      </div>
      <div className="space-y-0 p-4">
        {leaders.map((leader) => (
          <LeaderRow
            key={leader.role}
            leader={leader}
            showAssign={leadersAdmin}
            onAssign={() => onAssign(leader.role)}
            onClear={() => onClear(leader.role)}
          />
        ))}
      </div>
    </div>
  );
}

export function HouseLeadershipByPartyGrid({
  chamberLeaders,
  data,
  leadersAdmin,
  onAssign,
  onClear,
}: {
  chamberLeaders: LeaderDisplay[];
  data: {
    houseComposition?: Array<{ party: string; partyName: string; seats: number }>;
    majorityParty?: string | null;
    majoritySeats?: number;
    majorityBloc?: { displayName: string; partySlugs: string[] } | null;
    minorityBloc?: { displayName: string; partySlugs: string[] } | null;
    currentSpeaker?: { party: string } | null;
  } | null;
  leadersAdmin: boolean;
  onAssign: (role: string) => void;
  onClear: (role: string) => void;
}) {
  if (!data?.houseComposition || data.houseComposition.length === 0) return null;

  const majorityParty = data.majorityParty ?? "";
  const majorityPartyEntry =
    data.houseComposition.find((entry) => entry.party === majorityParty) ?? null;
  const totalSeats = data.houseComposition.reduce((sum, entry) => sum + entry.seats, 0);
  const oppositionSeats = Math.max(0, totalSeats - (data.majoritySeats ?? 0));
  const majorityPartyName = majorityPartyEntry?.partyName || majorityParty || "-";
  const majoritySubtitle = `Majority party: ${majorityPartyName}`;
  const majorityDetail =
    data.majorityBloc && majorityParty && data.majorityBloc.displayName !== majorityPartyName
      ? `Majority coalition: ${data.majorityBloc.displayName}. Speaker is open to any seated representative.`
      : null;
  const minorityDetail = data.minorityBloc
    ? `Largest opposition bloc: ${data.minorityBloc.displayName}.`
    : null;

  // Group Speaker by bloc membership so coalition-partner Speakers are still shown on the aligned side.
  const majorityBlocParties = new Set(data.majorityBloc?.partySlugs ?? [majorityParty]);
  const minorityBlocParties = new Set(data.minorityBloc?.partySlugs ?? []);
  const speakerParty = data.currentSpeaker?.party ?? "";
  const speakerInMajority = majorityBlocParties.has(speakerParty);
  const speakerInMinority = !speakerInMajority && minorityBlocParties.has(speakerParty);

  const majorityLeaders = [
    ...chamberLeaders.filter((l) => l.role === "speaker_of_the_house" && speakerInMajority),
    ...chamberLeaders.filter((l) => l.role === "majority_leader_house"),
    ...chamberLeaders.filter((l) => l.role === "majority_whip_house"),
  ];

  const minorityLeaders = [
    ...chamberLeaders.filter((l) => l.role === "speaker_of_the_house" && speakerInMinority),
    ...chamberLeaders.filter((l) => l.role === "minority_leader_house"),
    ...chamberLeaders.filter((l) => l.role === "minority_whip_house"),
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PartyPanel
        title="Majority"
        subtitle={majoritySubtitle}
        seats={majorityPartyEntry?.seats ?? 0}
        detail={majorityDetail}
        leaders={majorityLeaders}
        leadersAdmin={leadersAdmin}
        onAssign={onAssign}
        onClear={onClear}
      />
      <PartyPanel
        title="Minority"
        subtitle="Non-majority parties"
        seats={oppositionSeats}
        detail={minorityDetail}
        leaders={minorityLeaders}
        leadersAdmin={leadersAdmin}
        onAssign={onAssign}
        onClear={onClear}
      />
    </div>
  );
}

export function SenateLeadershipByPartyGrid({
  chamberLeaders,
  senateData,
  leadersAdmin,
  onAssign,
  onClear,
}: {
  chamberLeaders: LeaderDisplay[];
  senateData: {
    senateComposition?: Array<{ party: string; partyName: string; seats: number }>;
    majorityBloc?: { displayName: string; seats: number } | null;
    minorityBloc?: { displayName: string; seats: number } | null;
  } | null;
  leadersAdmin: boolean;
  onAssign: (role: string) => void;
  onClear: (role: string) => void;
}) {
  if (!senateData?.senateComposition || senateData.senateComposition.length === 0) return null;

  const majorityParty = senateData.senateComposition[0] ?? null;
  const totalSeats = senateData.senateComposition.reduce((sum, entry) => sum + entry.seats, 0);
  const oppositionSeats = Math.max(0, totalSeats - (senateData.majorityBloc?.seats ?? 0));
  const majorityDetail =
    senateData.majorityBloc &&
    majorityParty &&
    senateData.majorityBloc.displayName !== majorityParty.partyName
      ? `Majority coalition: ${senateData.majorityBloc.displayName}. Pro Tempore, Majority Leader and Majority Whip are held by ${majorityParty.partyName} alone.`
      : null;
  const minorityDetail = senateData.minorityBloc
    ? `Largest opposition bloc: ${senateData.minorityBloc.displayName}.`
    : null;

  const majorityLeaders = chamberLeaders.filter(
    (l) =>
      l.role === "president_pro_tempore" ||
      l.role === "majority_leader_senate" ||
      l.role === "majority_whip_senate"
  );

  const minorityLeaders = chamberLeaders.filter(
    (l) => l.role === "minority_leader_senate" || l.role === "minority_whip_senate"
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PartyPanel
        title="Majority"
        subtitle={`Majority party: ${majorityParty?.partyName ?? "-"}`}
        seats={majorityParty?.seats ?? 0}
        detail={majorityDetail}
        leaders={majorityLeaders}
        leadersAdmin={leadersAdmin}
        onAssign={onAssign}
        onClear={onClear}
      />
      <PartyPanel
        title="Minority"
        subtitle="Non-majority parties"
        seats={oppositionSeats}
        detail={minorityDetail}
        leaders={minorityLeaders}
        leadersAdmin={leadersAdmin}
        onAssign={onAssign}
        onClear={onClear}
      />
    </div>
  );
}
