"use client";

import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { NatMods } from "@/lib/military/doctrineTree";
import type { ConflictAssignment } from "@/lib/military/assignments";
import type { General } from "@/lib/military/generals";
import type { PendingDeclarationView, BattleReportView, ConflictView } from "./useCombatState";
import { ClassificationStrip } from "../_coldwar/ClassificationStrip";
import { MIL_COLOR, MIL_FONT } from "../military/theme";
import { useCombatState } from "./useCombatState";
import { OrderOfBattle } from "./components/OrderOfBattle";
import { UnitDossier } from "./components/UnitDossier";
import { DoctrineCommand } from "./components/DoctrineCommand";
import { TheaterWarRoom } from "./components/TheaterWarRoom";

const mono = MIL_FONT.mono;

const NAV = [
  { id: "oob", label: "Order of Battle" },
  { id: "dossier", label: "Unit Dossier" },
  { id: "doctrine", label: "Doctrine & Command" },
  { id: "theater", label: "Theater Map" },
  { id: "war", label: "War Room" },
];

export function CombatCommandClient({
  units,
  country,
  countryCode,
  positionId,
  canWrite,
  currentTurn,
  natMods,
  conflictAssignments,
  generalsById,
  positions,
  pendingDeclarations,
  reports,
  conflicts,
  cgHint = null,
}: {
  units: MilitaryUnit[];
  country: string;
  countryCode: string;
  positionId: string;
  canWrite: boolean;
  currentTurn: number;
  natMods: NatMods;
  conflictAssignments: ConflictAssignment[];
  generalsById: Record<string, General>;
  positions: Record<string, string>;
  pendingDeclarations: PendingDeclarationView[];
  reports: BattleReportView[];
  conflicts: ConflictView[];
  /**
   * Shown to a Commanding General who still has generals to post. Postings are made
   * on the CG's own page, never here — without this the page looks like the place to
   * do it and silently is not.
   */
  cgHint?: { unpostedGenerals: number; href: string } | null;
}) {
  const { state, dispatch } = useCombatState({
    units,
    country,
    countryCode,
    positionId,
    canWrite,
    currentTurn,
    natMods,
    conflictAssignments,
    generalsById,
    positions,
    pendingDeclarations,
    reports,
    conflicts,
  });

  return (
    <div
      style={{
        padding: 26,
        fontFamily: MIL_FONT.sans,
        color: MIL_COLOR.text,
        background: "radial-gradient(120% 80% at 50% 0%,#16131a,#0b0b11 60%)",
      }}
    >
      <div
        style={{
          maxWidth: 1340,
          margin: "0 auto",
          background: MIL_COLOR.panel,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 10,
          boxShadow: "0 18px 50px -14px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        <ClassificationStrip
          left="◆ EYES ONLY · JOINT STAFF — COMBAT COMMAND"
          right="NAT'L MILITARY COMMAND CENTER"
        />

        {cgHint && (
          <a
            href={cgHint.href}
            style={{
              display: "block",
              margin: "12px 22px 0",
              padding: "10px 12px",
              border: `1px solid ${MIL_COLOR.gold}55`,
              borderRadius: 8,
              background: `${MIL_COLOR.gold}12`,
              font: `600 11px ${mono}`,
              color: MIL_COLOR.gold,
              textDecoration: "none",
            }}
          >
            {cgHint.unpostedGenerals === 1
              ? "1 of your generals is not posted to a conflict."
              : `${cgHint.unpostedGenerals} of your generals are not posted to a conflict.`}{" "}
            Your generals are posted from your command page →
          </a>
        )}

        {!canWrite && (
          <div
            role="status"
            style={{
              margin: "12px 22px 0",
              padding: "10px 12px",
              border: `1px solid ${MIL_COLOR.amber}55`,
              borderRadius: 8,
              background: `${MIL_COLOR.amber}12`,
              font: `600 11px ${mono}`,
              color: MIL_COLOR.amber,
            }}
          >
            Read-only view. Only the defence minister can change unit orders or declare an
            offensive.
          </div>
        )}

        <div style={{ padding: "18px 22px 6px" }}>
          <p
            style={{
              margin: "0 0 5px",
              font: `600 10px ${mono}`,
              letterSpacing: ".22em",
              color: MIL_COLOR.gold,
            }}
          >
            PENTAGON · NATIONAL COMMAND AUTHORITY
          </p>
          <h1
            style={{
              margin: 0,
              fontFamily: MIL_FONT.serif,
              fontWeight: 700,
              fontSize: 32,
              lineHeight: 1,
              color: MIL_COLOR.textStrong,
            }}
          >
            Combat Command
          </h1>
        </div>

        {/* screen nav */}
        <div
          style={{
            display: "flex",
            gap: 2,
            flexWrap: "wrap",
            padding: "6px 22px 0",
            borderBottom: `1px solid ${MIL_COLOR.borderSoft}`,
          }}
        >
          {NAV.map((n) => {
            const active = state.screen === n.id;
            return (
              <button
                key={n.id}
                onClick={() => dispatch({ type: "SCREEN", screen: n.id })}
                style={{
                  border: "none",
                  background: "none",
                  borderBottom: `2px solid ${active ? MIL_COLOR.gold : "transparent"}`,
                  color: active ? "#fff" : MIL_COLOR.textMuted,
                  padding: "8px 12px 12px",
                  fontFamily: MIL_FONT.sans,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {n.label}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "18px 22px 24px" }}>
          {state.screen === "oob" && (
            <OrderOfBattle state={state} natMods={natMods} dispatch={dispatch} />
          )}
          {state.screen === "dossier" && (
            <UnitDossier state={state} natMods={natMods} dispatch={dispatch} />
          )}
          {state.screen === "doctrine" && <DoctrineCommand state={state} natMods={natMods} />}
          {(state.screen === "theater" || state.screen === "war") && (
            <TheaterWarRoom state={state} natMods={natMods} dispatch={dispatch} />
          )}
        </div>
      </div>
    </div>
  );
}
