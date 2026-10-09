"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { LegislatureSeal } from "@/components/legislature/LegislatureSeal";
import { KickerLabel, StatusPill, TheCountRail } from "@/components/legislature/dispatch";
import { GameMonthTime } from "@/components/time/GameMonthTime";
import { LocalTime } from "@/components/time/LocalTime";
import { useGameClock } from "@/contexts/useGameClock";
import type { NominationPerson } from "@/lib/congress/nominationPeople";

export interface NominationDisplay {
  id: string;
  kind: "cabinet" | "scotus";
  positionName: string;
  seatNumber?: number;
  nomineeCharacterName: string;
  proposedByPresidentName?: string;
  /** Resolved portrait/profile/party; absent on responses from older deploys. */
  nominee?: NominationPerson;
  nominator?: NominationPerson;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  proposedAt?: string;
  myVote: "for" | "against" | "abstain" | null;
}

const VOTE_LABEL = { for: "Yea", against: "Nay", abstain: "Abstain" } as const;
const VOTE_CLASS = {
  for: "border-success/40 bg-success/15 text-success",
  against: "border-error/40 bg-error/15 text-error",
  abstain: "border-card-border bg-muted/15 text-muted",
} as const;

/**
 * Wraps `children` in a profile link when the person has one. `decorative`
 * marks a portrait link that duplicates a name link, keeping it out of the
 * a11y tree and tab order.
 */
function PersonLink({
  person,
  className,
  decorative,
  children,
}: {
  person: NominationPerson | undefined;
  className?: string;
  decorative?: boolean;
  children: ReactNode;
}) {
  if (!person?.href) return <span className={className}>{children}</span>;
  return (
    <Link
      href={person.href}
      className={`pointer-events-auto ${className ?? ""}`}
      {...(decorative ? { "aria-hidden": true, tabIndex: -1 } : {})}
    >
      {children}
    </Link>
  );
}

/**
 * Senate confirmation row, laid out like {@link BillCard} so bills and
 * nominations read as one list: nominee portrait (chamber seal badge), kicker,
 * name headline, nominator byline, and The Count rail with the closing time.
 * The whole card opens the nomination; portraits and names open profiles.
 */
export function NominationCard({ nom }: { nom: NominationDisplay }) {
  const clock = useGameClock();
  const href =
    nom.kind === "scotus"
      ? `/congress/scotus-nominations/${nom.id}`
      : `/congress/nominations/${nom.id}`;
  const nominee = nom.nominee;
  const nominator = nom.nominator;
  const nomineeName = nominee?.name ?? nom.nomineeCharacterName;
  const nominatorName = nominator?.name ?? nom.proposedByPresidentName ?? "President";
  const kicker = nom.kind === "scotus" ? "Supreme Court nomination" : "Cabinet nomination";
  const office =
    nom.kind === "scotus" && nom.seatNumber != null
      ? `Supreme Court Seat ${nom.seatNumber}`
      : nom.positionName;

  const remaining = clock.formatRemaining(nom.votingEndsAt);
  const closed = remaining.urgency === "ended";
  const votes = { for: nom.votesFor, against: nom.votesAgainst, abstain: nom.votesAbstain };
  const cast = votes.for + votes.against + votes.abstain;

  return (
    <div className="group relative grid grid-cols-1 gap-5 p-4 sm:grid-cols-[1fr_180px] sm:gap-8 sm:p-5">
      <Link
        href={href}
        aria-label={`${nomineeName}, nominated for ${office}`}
        className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />

      <div className="pointer-events-none relative flex min-w-0 gap-3 sm:gap-4">
        <div className="relative shrink-0 self-start">
          <PersonLink person={nominee} className="block" decorative>
            <Avatar url={nominee?.avatarUrl} name={nomineeName} size="h-11 w-11 sm:h-14 sm:w-14" />
          </PersonLink>
          <span className="absolute -bottom-1.5 -right-1.5 rounded-full ring-2 ring-card">
            <LegislatureSeal countryId="US" chamberKey="senate" chamberName="Senate" size={22} />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <KickerLabel>{kicker}</KickerLabel>
            <span className="h-[3px] w-[3px] rounded-full bg-muted" />
            <StatusPill status={closed ? "Voting Closed" : "active"} size="sm" />
          </div>
          <h3
            className="m-0 text-foreground transition-colors group-hover:text-primary"
            style={{ fontSize: 21, lineHeight: 1.15, fontWeight: 600 }}
          >
            <PersonLink person={nominee} className="hover:underline underline-offset-2">
              {nomineeName}
            </PersonLink>
          </h3>
          <p className="mt-1 text-sm text-muted">
            for <span className="font-medium text-foreground/90">{office}</span>
            {nominee?.partyName && (
              <>
                <span className="mx-1.5 text-card-border">·</span>
                <span
                  className="whitespace-nowrap"
                  style={{ color: nominee.partyColor ?? undefined }}
                >
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: nominee.partyColor ?? undefined }}
                  />
                  {nominee.partyName}
                </span>
              </>
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <PersonLink person={nominator} className="shrink-0" decorative>
              <Avatar url={nominator?.avatarUrl} name={nominatorName} size="h-6 w-6" />
            </PersonLink>
            <span>
              Nominated by{" "}
              <PersonLink
                person={nominator}
                className="font-semibold hover:underline underline-offset-2"
              >
                <span style={{ color: nominator?.partyColor ?? undefined }}>{nominatorName}</span>
              </PersonLink>
            </span>
            {nom.proposedAt && (
              <>
                <span className="text-card-border">·</span>
                <GameMonthTime value={nom.proposedAt} className="text-muted/70" />
              </>
            )}
            {nom.myVote && (
              <span
                className={`ml-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${VOTE_CLASS[nom.myVote]}`}
              >
                You voted {VOTE_LABEL[nom.myVote]}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none relative">
        <TheCountRail votes={votes} eligible={cast || 1} />
        {nom.votingEndsAt && (
          <p
            className={`mt-2 text-[11px] font-medium ${
              closed
                ? "text-muted"
                : remaining.urgency === "critical"
                  ? "text-error"
                  : "text-warning"
            }`}
          >
            {closed ? "Voting closed" : `Closes in ${remaining.text}`}
            <span className="block text-[10px] font-normal text-muted/70">
              <LocalTime value={nom.votingEndsAt} />
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
