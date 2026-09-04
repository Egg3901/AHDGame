"use client";

import { useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendCharacterPicker, type PickerResult } from "./BlendCharacterPicker";
import { BlendScopeInline } from "@/components/blend/BlendScope";
import { StatePresencePanel } from "../components/StatePresencePanel";
import type { CampaignStatePresence } from "@/lib/elections/dto/campaignStatePresence";
import type { CampaignBlendVM } from "./campaignBlendViewModel";

export interface BlendSidebarProps {
  vm: CampaignBlendVM;
  /** Candidate id, excluded from every picker. */
  candidateId: string;
  /** Manager and ticket controls are nominee-only. */
  canManageTicket: boolean;
  /** Rally, tour and strength are open to the surrogate too. */
  canAct: boolean;
  busy: string | null;
  onFireRally: () => void;
  onToggleTour: () => void;
  onContributeStrength: () => void;
  onNameRunningMate: (r: PickerResult) => void;
  onAppointManager: (r: PickerResult) => void;
  onRemoveManager: (characterId: string, name: string) => void;
  /** Where the candidate is campaigning, and the controls to move. */
  presence?: CampaignStatePresence | null;
  /** Refetch after a move: the panel's data is built server-side. */
  onPresenceChanged: () => void;
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

function Block({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div style={first ? undefined : { paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
      {children}
    </div>
  );
}

/** The Blend right rail: your standing, and everything you can do about it. */
export function BlendSidebar({
  vm,
  candidateId,
  canManageTicket,
  canAct,
  busy,
  onFireRally,
  onToggleTour,
  onContributeStrength,
  onNameRunningMate,
  onAppointManager,
  onRemoveManager,
  presence,
  onPresenceChanged,
}: BlendSidebarProps) {
  const [pickingMate, setPickingMate] = useState(false);

  return (
    <aside
      style={{
        borderLeft: `1px solid ${BLEND.hairline}`,
        background: BLEND.rail,
        padding: "20px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {vm.support ? (
        <Block first>
          <Eyebrow>Current support</Eyebrow>
          <div
            style={{
              marginTop: 3,
              fontFamily: FONT.serif,
              fontStyle: "italic",
              fontSize: 12.5,
              color: BLEND.mutedDim,
            }}
          >
            {vm.railSubtitle}
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 9 }}>
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 36,
                fontWeight: 500,
                letterSpacing: "-0.03em",
              }}
            >
              {vm.support.supportText}
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: 12, color: "#60a5fa" }}>
              {vm.support.dripText} pending
            </span>
          </div>

          <div
            style={{
              marginTop: 10,
              height: 6,
              background: BLEND.trackAlt,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: `${vm.support.fillPct.toFixed(1)}%`,
                background: "linear-gradient(90deg, #7f1d1d, #dc2626)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -3,
                bottom: -3,
                left: "50%",
                width: 1,
                background: BLEND.mutedDim,
              }}
            />
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              justifyContent: "space-between",
              fontFamily: FONT.mono,
              fontSize: 9.5,
              color: BLEND.mutedDimmer,
            }}
          >
            <span>0</span>
            <span>50 NEUTRAL</span>
            <span>100</span>
          </div>

          {canAct ? (
            <>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={!vm.support.canRally || busy === "rally"}
                  onClick={onFireRally}
                  style={{
                    flex: 1,
                    border: 0,
                    background: vm.support.canRally ? BLEND.accent : BLEND.hairlineStrong,
                    padding: 9,
                    fontFamily: FONT.mono,
                    fontSize: 10.5,
                    letterSpacing: ".08em",
                    fontWeight: 700,
                    color: vm.support.canRally ? "#fff" : BLEND.muted,
                    cursor: vm.support.canRally ? "pointer" : "not-allowed",
                  }}
                >
                  RALLY · {vm.support.rallyActionCost}
                </button>
                <button
                  type="button"
                  disabled={busy === "tour"}
                  onClick={onToggleTour}
                  style={{
                    flex: 1,
                    border: `1px solid ${BLEND.hairlineStrong}`,
                    background: "transparent",
                    padding: 10,
                    fontFamily: FONT.mono,
                    fontSize: 11.5,
                    letterSpacing: ".08em",
                    fontWeight: 700,
                    cursor: "pointer",
                    color: vm.support.tourActive ? BLEND.negative : BLEND.positive,
                  }}
                >
                  {vm.support.tourActive ? "STOP TOUR" : "START TOUR"}
                </button>
              </div>
              {vm.support.rallyBlockedReason ? (
                <div
                  style={{
                    marginTop: 7,
                    fontFamily: FONT.serif,
                    fontStyle: "italic",
                    fontSize: 12.5,
                    color: BLEND.mutedDim,
                  }}
                >
                  {vm.support.rallyBlockedReason}
                </div>
              ) : null}
            </>
          ) : null}
        </Block>
      ) : null}

      {/* Where you are, high in the rail with the other things you can do
          about your standing, rather than a long scroll below the fold. */}
      {presence ? (
        <Block first={!vm.support}>
          <Eyebrow>Where you are campaigning</Eyebrow>
          <div style={{ marginTop: 10 }}>
            <BlendScopeInline>
              <StatePresencePanel presence={presence} onChanged={onPresenceChanged} />
            </BlendScopeInline>
          </div>
        </Block>
      ) : null}

      {vm.strength ? (
        <Block first={!vm.support && !presence}>
          <Eyebrow>Campaign strength</Eyebrow>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 32,
                fontWeight: 500,
                color: BLEND.accent,
                letterSpacing: "-0.03em",
              }}
            >
              {vm.strength.strength}
            </span>
            <span style={{ fontFamily: FONT.serif, fontSize: 14, color: BLEND.muted }}>
              +{vm.strength.boostPct}% votes
            </span>
          </div>

          {canAct ? (
            <>
              <p
                style={{
                  margin: "10px 0 14px",
                  fontFamily: FONT.serif,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: BLEND.muted,
                }}
              >
                {vm.strength.strengthAdded > 0 ? (
                  <>
                    Contribute {vm.strength.strengthAdded.toFixed(1)} strength for{" "}
                    {vm.strength.costText} and reach{" "}
                    <span style={{ color: BLEND.accent }}>+{vm.strength.newBoostPct}%</span>.
                  </>
                ) : (
                  "You need national influence to contribute campaign strength."
                )}
              </p>
              <button
                type="button"
                disabled={!vm.strength.canContribute || busy === "strength"}
                onClick={onContributeStrength}
                style={{
                  width: "100%",
                  border: `1px solid rgba(220,38,38,.4)`,
                  background: "transparent",
                  padding: 9,
                  fontFamily: FONT.mono,
                  fontSize: 10.5,
                  letterSpacing: ".08em",
                  fontWeight: 700,
                  color: vm.strength.canContribute ? BLEND.accent : BLEND.muted,
                  cursor: vm.strength.canContribute ? "pointer" : "not-allowed",
                }}
              >
                CONTRIBUTE STRENGTH
              </button>
            </>
          ) : null}
        </Block>
      ) : null}

      <Block>
        <Eyebrow>Ticket</Eyebrow>
        <div
          style={{
            marginTop: 9,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600 }}>
            {vm.ticket.runningMateName ?? "No running mate named"}
          </span>
          {canManageTicket ? (
            <button
              type="button"
              onClick={() => setPickingMate((v) => !v)}
              style={{
                border: 0,
                background: "transparent",
                padding: 0,
                fontFamily: FONT.mono,
                fontSize: 10,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: BLEND.muted,
                cursor: "pointer",
              }}
            >
              {pickingMate ? "Cancel" : "Change"}
            </button>
          ) : null}
        </div>
        <div
          style={{
            marginTop: 2,
            fontFamily: FONT.serif,
            fontStyle: "italic",
            fontSize: 13,
            color: BLEND.mutedDim,
          }}
        >
          Running mate
        </div>
        {pickingMate && canManageTicket ? (
          <BlendCharacterPicker
            placeholder="Search a character to name…"
            excludeIds={[candidateId, ...vm.managers.list.map((m) => m.characterId)]}
            disabled={busy === "runningMate"}
            onPick={(r) => {
              setPickingMate(false);
              onNameRunningMate(r);
            }}
          />
        ) : null}

        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Eyebrow>Managers</Eyebrow>
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 10,
              color: BLEND.mutedDim,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {vm.managers.countText}
          </span>
        </div>
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: FONT.serif,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: BLEND.mutedDim,
          }}
        >
          A manager can take campaign actions alongside the candidate.
        </p>

        {vm.managers.list.length === 0 ? (
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: FONT.serif,
              fontStyle: "italic",
              fontSize: 13,
              color: BLEND.mutedDim,
            }}
          >
            No managers appointed yet.
          </p>
        ) : (
          <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {vm.managers.list.map((m) => (
              <span
                key={m.characterId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid rgba(220,38,38,.3)",
                  background: "rgba(220,38,38,.05)",
                  padding: "5px 9px",
                }}
              >
                <span style={{ fontFamily: FONT.serif, fontSize: 13, fontWeight: 600 }}>
                  {m.name}
                </span>
                {canManageTicket ? (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name} as manager`}
                    disabled={busy === `manager:${m.characterId}`}
                    onClick={() => onRemoveManager(m.characterId, m.name)}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      font: "inherit",
                      fontSize: 13,
                      lineHeight: 1,
                      color: BLEND.muted,
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}

        {vm.managers.atCap && canManageTicket ? (
          <p
            style={{
              margin: "9px 0 0",
              fontFamily: FONT.mono,
              fontSize: 10,
              lineHeight: 1.5,
              color: BLEND.mutedDim,
            }}
          >
            Manager slots full. Remove one to appoint someone else.
          </p>
        ) : null}

        {vm.managers.canAppoint && canManageTicket ? (
          <BlendCharacterPicker
            placeholder="Search a character to appoint…"
            excludeIds={[candidateId, ...vm.managers.list.map((m) => m.characterId)]}
            disabled={busy?.startsWith("manager") ?? false}
            onPick={onAppointManager}
          />
        ) : null}
      </Block>
    </aside>
  );
}
