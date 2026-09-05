"use client";

import { useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendScopeInline } from "@/components/blend/BlendScope";
import { PrimaryCampaignControls } from "@/components/elections/primary/PrimaryCampaignControls";
import { StatePickerModal } from "@/components/elections/primary/StatePickerModal";
import {
  DemographicPickerModal,
  type DemographicPick,
} from "@/components/elections/primary/DemographicPickerModal";
import { stateOrgLevelCost } from "@/lib/electionEngine/constants";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import type { PrimaryStateActionKind } from "@/lib/db/types";
import type {
  AttackOption,
  LiveAttackRow,
  StateOperationsView,
} from "@/lib/elections/dto/stateOperations";

export interface StateOperationsSectionProps {
  view: StateOperationsView;
  /** Which attack is in flight, as `${targetCandidateId}:${kind}`. */
  busy: string | null;
  onAttack: (
    targetCandidateId: string,
    kind: PrimaryStateActionKind,
    stateId: string,
    group?: { categoryKey: string; bucket: string }
  ) => void;
  /** Refetch after anything here lands: the hub is built server-side. */
  onChanged: () => void;
  variant?: "desktop" | "mobile";
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 9.5,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: BLEND.mutedDimmer,
      }}
    >
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "6px 0 0",
        fontFamily: FONT.serif,
        fontSize: 13.5,
        lineHeight: 1.5,
        color: BLEND.muted,
      }}
    >
      {children}
    </p>
  );
}

/** A running attack, in the same words whichever direction it points. */
function attackLine(row: LiveAttackRow, currentTurn: number): string {
  const left = Math.max(0, row.expiresTurn - currentTurn);
  const turns = `${left} ${left === 1 ? "turn" : "turns"} left`;
  return row.actorName
    ? `${row.actorName} in ${row.stateName}, ${turns}`
    : `${row.stateName}, ${turns}`;
}

/**
 * Every state-level move a presidential primary candidate can make, in one
 * place: where they are camped, what they are building, where they can canvass,
 * and what they are doing to the rest of the field.
 *
 * Scattering these was the complaint that produced this section. Prices and
 * effects all come from `view`, never from a literal here, so the panel cannot
 * quote a figure the server does not charge.
 */
export function StateOperationsSection({
  view,
  busy,
  onAttack,
  onChanged,
  variant = "desktop",
}: StateOperationsSectionProps) {
  const mobile = variant === "mobile";
  const { camp, presence, canvass } = view.positives;
  const [openOpponent, setOpenOpponent] = useState<string | null>(null);
  const [attackTarget, setAttackTarget] = useState<{
    candidateId: string;
    attack: AttackOption;
  } | null>(null);
  // Set once the state is chosen for an attack that also names a group, so the
  // second chooser knows where it is acting.
  const [pendingState, setPendingState] = useState<string | null>(null);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [presenceMessage, setPresenceMessage] = useState("");

  const levelByState = new Map(presence.map((p) => [p.stateId, p.level]));

  // Priced from the same function the build route charges with, per state, so
  // the escalating ladder cannot be misquoted as a flat toll, and converted with
  // the one rate the view carries so it agrees with the row above.
  const presenceCost = (stateId: string) =>
    stateOrgLevelCost(levelByState.get(stateId) ?? 0) * view.campaignFxRate;

  const buildPresence = async (stateId: string) => {
    setPresenceBusy(true);
    setPresenceMessage("");
    try {
      trackAction("political-operations.state-org-build", { stateId });
      const res = await fetch("/api/political-operations/state-org/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPresenceMessage(`✓ ${data.message ?? "Presence built."}`);
        setPresenceOpen(false);
        onChanged();
      } else {
        setPresenceMessage(`✗ ${data.error ?? "That did not work."}`);
      }
    } catch {
      setPresenceMessage("✗ Network error");
    } finally {
      setPresenceBusy(false);
    }
  };

  // Actions come out of the candidate; the money comes out of the campaign.
  // `camp.playerFunds` is the candidate's own balance and pays for the surge,
  // not for these.
  const canAfford = (attack: AttackOption) =>
    camp.playerActions >= attack.costActions && view.campaignFunds >= attack.costFunds;
  const reasonFor = (attack: AttackOption) =>
    camp.playerActions < attack.costActions
      ? `Needs ${attack.costActions} actions.`
      : view.campaignFunds < attack.costFunds
        ? `Needs ${money(attack.costFunds)} in the war chest.`
        : null;

  /** Fire, or ask for the group first when the attack names one. */
  const chooseState = (stateId: string) => {
    if (!attackTarget) return;
    if (attackTarget.attack.needsBucket) {
      setPendingState(stateId);
      return;
    }
    onAttack(attackTarget.candidateId, attackTarget.attack.kind, stateId, undefined);
    setAttackTarget(null);
  };

  const chooseGroup = (group: DemographicPick) => {
    if (!attackTarget || !pendingState) return;
    onAttack(attackTarget.candidateId, attackTarget.attack.kind, pendingState, {
      categoryKey: group.categoryKey,
      bucket: group.bucket,
    });
    setAttackTarget(null);
    setPendingState(null);
  };

  return (
    <section
      style={{
        padding: mobile ? "18px 16px" : "24px 26px",
        borderBottom: mobile ? undefined : `1px solid ${BLEND.hairlineStrong}`,
      }}
    >
      <h2
        style={{
          margin: mobile ? "0 0 4px" : "0 0 4px",
          fontFamily: FONT.serif,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        State operations
      </h2>
      <p
        style={{
          margin: "0 0 18px",
          fontFamily: FONT.serif,
          fontSize: 14.5,
          lineHeight: 1.55,
          color: BLEND.muted,
        }}
      >
        Where you are, what you are building, and who you are fighting.
      </p>

      {/* Camping and the one-off home-state surge. */}
      <BlendScopeInline>
        <PrimaryCampaignControls electionId={view.electionId} {...camp} onChanged={onChanged} />
      </BlendScopeInline>

      {/* ── Campaign presence ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${BLEND.hairline}` }}>
        <Eyebrow>Campaign presence</Eyebrow>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 20, color: BLEND.ink }}>
              {presence.length} {presence.length === 1 ? "state" : "states"}
            </div>
            <Note>
              {presence.length === 0
                ? "No organisation anywhere yet. Presence lifts your vote share in the state you build it in, every turn, for the rest of the race."
                : `Strongest: ${presence[0].name} at level ${presence[0].level}. The next level there costs ${money(presence[0].nextCost)}.`}
            </Note>
          </div>
          <button
            type="button"
            onClick={() => setPresenceOpen(true)}
            style={{
              border: `1px solid ${BLEND.chipBorder}`,
              background: "transparent",
              padding: "7px 13px",
              fontFamily: FONT.mono,
              fontSize: 10.5,
              letterSpacing: ".08em",
              fontWeight: 700,
              textTransform: "uppercase",
              color: BLEND.ink,
              cursor: "pointer",
            }}
          >
            Build presence
          </button>
        </div>
        {presenceMessage ? (
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT.mono,
              fontSize: 11,
              color: presenceMessage.startsWith("✓") ? BLEND.positive : BLEND.negative,
            }}
          >
            {presenceMessage}
          </div>
        ) : null}
      </div>

      {/* ── Canvassing ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${BLEND.hairline}` }}>
        <Eyebrow>Canvassing</Eyebrow>
        <Note>
          {canvass.available
            ? `Open in ${camp.currentCampaignState}. Pick a demographic at the canvassing desk further down this page to lift their turnout there.`
            : (canvass.reason ?? "Camp in a state to canvass there.")}
        </Note>
      </div>

      {/* ── The field ─────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${BLEND.hairline}` }}>
        <Eyebrow>The field</Eyebrow>
        <Note>Open a rival to act against them in a state.</Note>
        {view.opponents.length === 0 ? (
          <Note>You are running unopposed.</Note>
        ) : (
          view.opponents.map((o) => {
            const open = openOpponent === o.candidateId;
            const pendingKind = (kind: string) => busy === `${o.candidateId}:${kind}`;
            return (
              <div key={o.candidateId}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenOpponent(open ? null : o.candidateId)}
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "11px 0",
                    border: 0,
                    borderBottom: `1px solid ${BLEND.hairline}`,
                    background: "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <i
                      aria-hidden
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 2,
                        background: o.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: FONT.serif,
                        fontSize: 15.5,
                        fontWeight: 600,
                        color: BLEND.ink,
                      }}
                    >
                      {o.name}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 11.5,
                      color: BLEND.mutedDim,
                      flexShrink: 0,
                    }}
                  >
                    {o.delegates.toLocaleString("en-US")} del
                  </span>
                </button>

                {open ? (
                  <div style={{ padding: "12px 0 16px" }}>
                    {/* Buttons wrap rather than sitting in a fixed grid, so
                        three of them stack cleanly on a narrow phone. */}
                    {view.attacks.map((attack) => {
                      const affordable = canAfford(attack);
                      const pending = pendingKind(attack.kind);
                      const reason = reasonFor(attack);
                      return (
                        <div key={attack.kind} style={{ marginBottom: 14 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            <button
                              type="button"
                              disabled={!affordable || pending}
                              onClick={() =>
                                setAttackTarget({ candidateId: o.candidateId, attack })
                              }
                              style={{
                                border: `1px solid ${affordable ? BLEND.negative : BLEND.hairlineStrong}`,
                                background: "transparent",
                                padding: "7px 13px",
                                fontFamily: FONT.mono,
                                fontSize: 10.5,
                                letterSpacing: ".08em",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                color: affordable ? BLEND.negative : BLEND.mutedDim,
                                cursor: affordable && !pending ? "pointer" : "not-allowed",
                              }}
                            >
                              {pending ? "Working" : attack.label}
                            </button>
                            {reason ? (
                              <span
                                style={{
                                  alignSelf: "center",
                                  fontFamily: FONT.mono,
                                  fontSize: 10.5,
                                  color: BLEND.mutedDim,
                                }}
                              >
                                {reason}
                              </span>
                            ) : null}
                          </div>
                          <Note>{attack.description}</Note>
                        </div>
                      );
                    })}
                    {o.liveAgainstThem.length > 0 ? (
                      <div style={{ marginTop: 10 }}>
                        <Eyebrow>Live against them</Eyebrow>
                        {o.liveAgainstThem.map((row) => (
                          <div
                            key={`${row.kind}:${row.stateId}`}
                            style={{
                              marginTop: 5,
                              fontFamily: FONT.mono,
                              fontSize: 11,
                              color: BLEND.muted,
                            }}
                          >
                            {attackLine(row, view.currentTurn)}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* ── Against you ───────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${BLEND.hairline}` }}>
        <Eyebrow>Against you</Eyebrow>
        {view.liveAgainstYou.length === 0 ? (
          <Note>Nothing running against you.</Note>
        ) : (
          view.liveAgainstYou.map((row) => (
            <div
              key={`${row.actorName}:${row.kind}:${row.stateId}`}
              style={{
                marginTop: 6,
                fontFamily: FONT.mono,
                fontSize: 11.5,
                color: BLEND.negative,
              }}
            >
              {attackLine(row, view.currentTurn)}
            </div>
          ))
        )}
        {view.shieldPct > 0 ? (
          <Note>
            Rapid Response is blunting {Math.round(view.shieldPct * 100)}% of incoming ads and vote
            suppression. It does not cover turnout suppression, which acts on the electorate rather
            than on you.
          </Note>
        ) : null}
      </div>

      {presenceOpen ? (
        <StatePickerModal
          title="Pick a state to build presence in"
          states={camp.states}
          currentStateId={null}
          playerActions={camp.playerActions}
          busy={presenceBusy}
          footnote="Paid from the campaign, not from you. Each level in a state costs more than the last."
          trailingFor={(s) => {
            const level = levelByState.get(s.id) ?? 0;
            return `L${level} · ${money(presenceCost(s.id))}`;
          }}
          unaffordable={() => false}
          onPick={buildPresence}
          onClose={() => setPresenceOpen(false)}
        />
      ) : null}

      {attackTarget && !pendingState ? (
        <StatePickerModal
          title="Pick a state to attack in"
          states={camp.states}
          currentStateId={null}
          playerActions={camp.playerActions}
          busy={busy !== null}
          footnote={attackTarget.attack.description}
          trailingFor={() => `${attackTarget.attack.costActions} actions`}
          unaffordable={() => !canAfford(attackTarget.attack)}
          onPick={chooseState}
          onClose={() => setAttackTarget(null)}
        />
      ) : null}

      {attackTarget && pendingState ? (
        <DemographicPickerModal
          title="Pick a group to target"
          countryId={view.countryId}
          footnote="Their turnout falls in that state for everyone, including you. Aim it at a group a rival depends on."
          busy={busy !== null}
          onPick={chooseGroup}
          onClose={() => {
            setAttackTarget(null);
            setPendingState(null);
          }}
        />
      ) : null}
    </section>
  );
}
