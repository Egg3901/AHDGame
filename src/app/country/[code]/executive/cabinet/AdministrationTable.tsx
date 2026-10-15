"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { CabinetVoteRow } from "@/app/whitehouse/cabinet/components/CabinetVoteRow";
import { CabinetNominateModal } from "@/app/whitehouse/cabinet/components/CabinetNominateModal";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { Position, PositionMember, PresidentialCabinetState } from "./usePresidentialCabinet";

/** An office above the cabinet (President, Vice President) shown in the same table. */
export interface LeadOfficeRow {
  key: string;
  office: string;
  /** Small line under the office name ("Elected by the Electoral College"). */
  note?: string;
  holder: {
    name: string;
    href?: string;
    avatarUrl?: string | null;
    partyId?: string;
    partyName?: string;
    partyColor?: string;
  } | null;
  status: { label: string; tone: StatusTone };
  /** Extra line under the status ("since January, Week 3, 1994"). */
  statusNote?: string;
  actions?: ReactNode;
}

type StatusTone = "success" | "warning" | "info" | "default";

const EXECUTIVE_OFFICE = "Executive Office";
const GROUP_ORDER: string[] = [
  EXECUTIVE_OFFICE,
  "Security & Foreign",
  "Economy",
  "Society",
  "Domestic",
  "Nations",
];

function getOrdinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const value = n % 100;
  return `${n}${suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]}`;
}

/**
 * The administration as one grouped table: the elected executive and its
 * White House staff on top, then every cabinet seat under its policy bucket.
 * One row per office with holder, party, status and the President's controls,
 * so a vacancy, a pending Senate vote or an acting caretaker reads at a glance
 * instead of across a wall of cards.
 */
export function AdministrationTable({
  cabinet,
  leadRows = [],
  title,
  description,
  headerAction,
}: {
  cabinet: PresidentialCabinetState;
  leadRows?: LeadOfficeRow[];
  title: string;
  description?: ReactNode;
  headerAction?: ReactNode;
}) {
  const { data, countryId } = cabinet;
  const code = countryId.toLowerCase();
  const positions = data?.positions ?? [];

  // A roster with no real grouping (every seat "Centre") reads as one block.
  const distinctGroups = new Set(positions.map((position) => position.group ?? "Centre"));
  const grouped = distinctGroups.size > 1;
  const groupLabel = (group: CabinetGroup | undefined) =>
    !grouped ? "Cabinet" : (group ?? "Centre") === "Centre" ? EXECUTIVE_OFFICE : group!;

  const sections = new Map<string, Position[]>();
  if (leadRows.length > 0) sections.set(EXECUTIVE_OFFICE, []);
  for (const position of [...positions].sort((a, b) => a.order - b.order)) {
    const label = groupLabel(position.group);
    sections.set(label, [...(sections.get(label) ?? []), position]);
  }
  const orderedSections = [...sections.entries()].sort(
    ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)
  );

  const filled = positions.filter((position) => position.member).length;
  const pendingVotes = cabinet.activeNominations.length;

  function actingTurnsLeft(member: PositionMember): number | null {
    if (!member.acting || member.actingExpiresOnTurn == null) return null;
    const turn = data?.currentTurn;
    if (turn == null) return null;
    return Math.max(0, member.actingExpiresOnTurn - turn);
  }

  function seatStatus(position: Position): { label: string; tone: StatusTone; note?: ReactNode } {
    const member = position.member;
    if (member?.acting) {
      const left = actingTurnsLeft(member);
      return {
        label: "Acting",
        tone: "warning",
        note: left !== null ? `${left} turns remaining` : undefined,
      };
    }
    if (member) {
      return position.appointedWithoutConfirmation
        ? { label: "Appointed", tone: "default" }
        : { label: "Confirmed", tone: "default" };
    }
    if (position.nomination?.status === "active") {
      if (position.appointedWithoutConfirmation) {
        return { label: "Starts next turn", tone: "info" };
      }
      const n = position.nomination;
      return {
        label: "Senate vote",
        tone: "info",
        note: `${n.votesFor} for, ${n.votesAgainst} against`,
      };
    }
    return { label: "Vacant", tone: "default" };
  }

  function seatActions(position: Position): ReactNode {
    if (!data?.isPresident) return null;
    const directSeat = position.appointedWithoutConfirmation === true;
    const nominateLabel = directSeat ? "Appoint" : "Nominate";
    const actingAllowed = data.actingEnabled && !directSeat;
    const buttons: ReactNode[] = [];
    if (position.member) {
      buttons.push(
        <RowButton
          key="fire"
          tone="error"
          disabled={cabinet.submitting}
          onClick={() => cabinet.handleFire(position.id)}
        >
          {cabinet.submitting ? "..." : "Fire"}
        </RowButton>
      );
    }
    // An acting holder does not block confirmation: nominating sends the seat
    // to the Senate and confirming replaces the caretaker, so the President is
    // not pushed toward firing first (ticket #1273).
    if (!position.member || position.member.acting) {
      buttons.unshift(
        <RowButton key="nominate" onClick={() => cabinet.openNominateModal(position.id)}>
          {position.nomination && !position.member ? "Replace nomination" : nominateLabel}
        </RowButton>
      );
      if (actingAllowed && !position.member) {
        buttons.push(
          <RowButton
            key="acting"
            disabled={position.actingChargeSpent === true}
            onClick={() => cabinet.openActingModal(position.id)}
          >
            Appoint acting
          </RowButton>
        );
      }
    }
    return buttons;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {description ?? (
              <>
                {filled} of {positions.length} cabinet seats filled
                {pendingVotes > 0 &&
                  ` · ${pendingVotes} awaiting Senate vote${pendingVotes === 1 ? "" : "s"}`}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.isPresident && (
            <RowButton tone="primary" onClick={() => cabinet.openNominateModal()}>
              Fill a seat
            </RowButton>
          )}
          {headerAction}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-card-border bg-card-muted text-left text-[11px] font-medium text-muted">
              <th scope="col" className="w-[34%] px-4 py-2 font-medium">
                Office
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Officeholder
              </th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                Party
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {cabinet.loading && !data ? (
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm italic text-muted">
                  Loading the administration...
                </td>
              </tr>
            </tbody>
          ) : (
            orderedSections.map(([label, seats], sectionIndex) => (
              <tbody key={label}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={5}
                    className={`bg-card-muted/50 px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted/80 ${
                      sectionIndex > 0 ? "border-t border-card-border" : ""
                    }`}
                  >
                    {label}
                  </th>
                </tr>
                {label === EXECUTIVE_OFFICE &&
                  leadRows.map((row) => (
                    <OfficeRow
                      key={row.key}
                      office={<span className="font-semibold text-foreground">{row.office}</span>}
                      note={row.note}
                      holder={row.holder}
                      countryId={countryId}
                      status={row.status}
                      statusNote={row.statusNote}
                      actions={row.actions}
                    />
                  ))}
                {seats.map((position) => {
                  const status = seatStatus(position);
                  const member = position.member;
                  const nominee =
                    !member && position.nomination?.status === "active"
                      ? position.nomination
                      : null;
                  const chargeNote =
                    data?.isPresident &&
                    data.actingEnabled &&
                    !member &&
                    !position.appointedWithoutConfirmation &&
                    position.actingChargeSpent ? (
                      <span className="block text-[10px] leading-snug text-muted">
                        Acting appointment used. It can only be filled by confirmation now.
                      </span>
                    ) : null;
                  return (
                    <OfficeRow
                      key={position.id}
                      office={
                        <Link
                          href={`/country/${code}/executive/cabinet/${position.id}/office`}
                          className="font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {position.name}
                        </Link>
                      }
                      note={
                        position.outsideSuccession
                          ? "Serves at the President's pleasure"
                          : `${getOrdinal(position.order)} in line`
                      }
                      holder={
                        member
                          ? {
                              name: member.characterName,
                              href: member.characterId
                                ? `/character/${member.sequentialId ?? member.characterId}`
                                : undefined,
                              avatarUrl: member.avatarUrl,
                              partyId: member.party,
                              partyName: member.partyName,
                              partyColor: member.partyColor,
                              partyLogoUrl: member.partyLogoUrl,
                            }
                          : null
                      }
                      nominee={
                        nominee
                          ? {
                              name: nominee.nomineeCharacterName,
                              partyId: nominee.nomineeParty,
                              partyName: nominee.nomineePartyName,
                              partyColor: nominee.nomineePartyColor,
                            }
                          : null
                      }
                      countryId={countryId}
                      status={status}
                      statusNote={
                        <>
                          {status.note}
                          {chargeNote}
                        </>
                      }
                      actions={seatActions(position)}
                    />
                  );
                })}
              </tbody>
            ))
          )}
        </table>
      </div>

      {data?.isSenator && cabinet.activeNominations.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-info/30 bg-card">
          <div className="border-b border-card-border bg-info/5 px-4 py-2 text-xs font-semibold text-foreground">
            Your Senate votes
            <span className="ml-2 font-normal text-muted">
              24-hour simple-majority confirmation
            </span>
          </div>
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <tbody>
              {cabinet.activeNominations.map((position) => (
                <CabinetVoteRow
                  key={position.nomination!.id}
                  positionName={position.name}
                  nomination={position.nomination!}
                  isSenator={data.isSenator}
                  onVote={cabinet.handleVote}
                  votingId={cabinet.votingId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <>
          <CabinetNominateModal
            open={cabinet.nominateModal}
            positions={data.positions}
            characters={cabinet.characters}
            npps={cabinet.npps}
            mode={cabinet.nomineeMode}
            onModeChange={cabinet.setNomineeMode}
            selectedPositionId={cabinet.selectedPositionId}
            selectedCharId={cabinet.selectedCharId}
            selectedNppId={cabinet.selectedNppId}
            onNppChange={cabinet.setSelectedNppId}
            message={cabinet.nominateError}
            submitting={cabinet.submitting}
            onPositionChange={cabinet.setSelectedPositionId}
            onCharChange={cabinet.setSelectedCharId}
            // Confirmation replaces an acting holder at once, so acting-held
            // seats stay nominatable. The acting picker below must NOT set this:
            // installing an acting secretary requires a vacant seat.
            includeActingHeld
            description={
              data.positions.find((p) => p.id === cabinet.selectedPositionId)
                ?.appointedWithoutConfirmation
                ? "This seat needs no Senate vote. Your appointee takes office at the next turn."
                : undefined
            }
            onSubmit={cabinet.handleNominate}
            onCancel={cabinet.closeNominateModal}
          />

          <CabinetNominateModal
            open={cabinet.actingModal}
            positions={data.positions.filter((p) => !p.appointedWithoutConfirmation)}
            characters={cabinet.characters}
            selectedPositionId={cabinet.selectedPositionId}
            selectedCharId={cabinet.selectedCharId}
            message={cabinet.nominateError}
            submitting={cabinet.submitting}
            onPositionChange={cabinet.setSelectedPositionId}
            onCharChange={cabinet.setSelectedCharId}
            onSubmit={cabinet.handleAppointActing}
            title="Appoint an acting secretary"
            description={`An acting secretary takes the seat at once, with no Senate vote. They have the same departmental powers as a confirmed secretary. The appointment ends after ${data.actingTenureTurns ?? 24} turns, and you get only one per office per term.`}
            submitLabel="Appoint"
            nomineeLabel="Appointee"
            pendingNominationLabel=" (confirmation pending)"
            onCancel={cabinet.closeActingModal}
          />
        </>
      )}
    </section>
  );
}

function rank(label: string): number {
  const index = GROUP_ORDER.indexOf(label);
  return index === -1 ? GROUP_ORDER.length : index;
}

interface RowHolder {
  name: string;
  href?: string;
  avatarUrl?: string | null;
  partyId?: string;
  partyName?: string;
  partyColor?: string;
  partyLogoUrl?: string | null;
}

function OfficeRow({
  office,
  note,
  holder,
  nominee,
  countryId,
  status,
  statusNote,
  actions,
}: {
  office: ReactNode;
  note?: string;
  holder: RowHolder | null;
  nominee?: RowHolder | null;
  countryId: PresidentialCabinetState["countryId"];
  status: { label: string; tone: StatusTone };
  statusNote?: ReactNode;
  actions?: ReactNode;
}) {
  const party = holder ?? nominee ?? null;
  return (
    <tr className="border-t border-card-border/50 align-middle transition-colors hover:bg-card-muted/40">
      <td className="px-4 py-2.5">
        <div className="leading-snug">{office}</div>
        {note && <div className="mt-0.5 text-[11px] text-muted">{note}</div>}
      </td>
      <td className="px-3 py-2.5">
        {holder ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar
              url={holder.avatarUrl ?? undefined}
              name={holder.name}
              size="h-7 w-7"
              className="shrink-0 rounded-md"
            />
            {holder.href ? (
              <Link
                href={holder.href}
                className="truncate font-medium text-foreground transition-colors hover:text-primary"
              >
                {holder.name}
              </Link>
            ) : (
              <span className="truncate font-medium">{holder.name}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-card-border text-[10px] text-muted">
              -
            </span>
            {nominee ? (
              <span className="truncate text-muted">
                <span className="text-[11px]">Nominee </span>
                <span className="font-medium text-foreground/80">{nominee.name}</span>
              </span>
            ) : (
              <span className="italic text-muted">Vacant</span>
            )}
          </div>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 md:table-cell">
        {party?.partyName && party.partyColor ? (
          <PartyChip
            partyName={party.partyName}
            partyColor={party.partyColor}
            partyId={party.partyId}
            logoUrl={party.partyLogoUrl}
            countryId={countryId}
          />
        ) : (
          <span className="text-muted/50">-</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {status.label === "Vacant" ? (
          <span className="text-xs text-muted">Vacant</span>
        ) : (
          <Badge color={status.tone} variant="tag">
            {status.label}
          </Badge>
        )}
        {statusNote && <div className="mt-1 text-[10px] leading-snug text-muted">{statusNote}</div>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
      </td>
    </tr>
  );
}

function RowButton({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "error" | "primary";
}) {
  const toneClass =
    tone === "error"
      ? "border-error/30 text-error hover:bg-error/10"
      : tone === "primary"
        ? "border-primary/40 text-primary hover:bg-primary/10"
        : "border-card-border text-foreground hover:bg-card-elevated";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}
