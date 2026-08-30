"use client";

import type { Dispatch } from "react";
import type {
  MilitaryCommand,
  MilitaryState,
  CommandPosture,
  CommanderRef,
  ThreatLevel,
} from "@/lib/military/types";
import type { MilitaryAction } from "@/lib/military/reducer";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { COMMAND_TYPES, POSTURES } from "@/lib/military/config";
import { getRegion } from "@/lib/military/regions";
import type { ConflictAssignment } from "@/lib/military/assignments";
import {
  forceLoad,
  overBy,
  effectiveness,
  effIntent,
  overCapacityPenalties,
  commandsOfRegion,
  hasSameTypeOverlap,
  unitLoad,
} from "@/lib/military/calc";
import { SectionCard, Badge, Meter } from "../../dossier";
import { PostureEffects, TypeBonuses } from "@/components/CommandEffects";

const INTENT_TEXT = { success: "text-success", warn: "text-warning", error: "text-error" } as const;
const INTENT_METER = {
  success: "var(--success)",
  warn: "var(--warning)",
  error: "var(--error)",
} as const;
const THREAT_TONE = {
  Severe: "down",
  High: "warning",
  Rising: "warning",
  Medium: "info",
  Low: "up",
} as const;

function Label({ children }: { children: React.ReactNode }) {
  return <div className="dossier-label mb-1.5 text-muted">{children}</div>;
}

export function CommandDetailPanel({
  command: c,
  state,
  unitsById,
  pool,
  commanders,
  commandersById,
  regionThreats,
  assignments,
  conflicts = [],
  countryCode,
  onSetPosting,
  onSetInCharge,
  dispatch,
  canWrite,
  onAssignRegions,
}: {
  command: MilitaryCommand;
  state: MilitaryState;
  unitsById: Record<string, MilitaryUnit>;
  pool: MilitaryUnit[];
  commanders: CommanderRef[];
  commandersById: Record<string, CommanderRef>;
  regionThreats: Record<string, ThreatLevel>;
  assignments: ConflictAssignment[];
  /** The live conflicts a general can be posted to. Empty until one breaks out. */
  conflicts?: { id: string; name: string }[];
  countryCode: string;
  onSetPosting: (generalCharacterId: string, theaterId: string | null) => void;
  onSetInCharge: (generalCharacterId: string) => void;
  dispatch: Dispatch<MilitaryAction>;
  canWrite: boolean;
  onAssignRegions: () => void;
}) {
  // A posting's conflict resolves to its live name; a stale id falls back to itself.
  const theaterName = (id: string) => conflicts.find((cf) => cf.id === id)?.name ?? id;
  /** This general's Conflict posting, if any. */
  const postingOf = (generalCharacterId: string) =>
    assignments.find((a) => a.generalCharacterId === generalCharacterId) ?? null;

  const load = forceLoad(c, unitsById);
  const over = overBy(c, unitsById) > 0;
  const loadPct = c.cap > 0 ? (load / c.cap) * 100 : 0;
  const eff = effectiveness(c, unitsById);
  const effTone = effIntent(eff);
  const inCommand = new Set(c.commanderIds);
  const addOptions = commanders.filter((cm) => !inCommand.has(cm.id));

  const overview: { label: string; value: string; cls?: string }[] = [
    { label: "Posture", value: c.posture },
    { label: "Supply", value: c.supply, cls: c.supply === "Emergency" ? "text-error" : undefined },
    { label: "Readiness", value: c.readiness },
    { label: "Political", value: c.political },
    { label: "Specialty", value: c.spec },
    { label: "Branch focus", value: c.branchFocus },
    { label: "Effectiveness", value: `${eff}%`, cls: INTENT_TEXT[effTone] },
    { label: "Capacity", value: `${load}/${c.cap}`, cls: over ? "text-warning" : undefined },
  ];

  return (
    <SectionCard
      title={c.name}
      sub={COMMAND_TYPES[c.type].label}
      right={<Badge tone="gov">{COMMAND_TYPES[c.type].short}</Badge>}
    >
      <p className="mb-2 text-[12px] italic leading-relaxed text-muted">{c.role}</p>
      <TypeBonuses type={c.type} className="mb-3" />

      {/* overview */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {overview.map((o) => (
          <div key={o.label}>
            <div className="dossier-label text-muted">{o.label}</div>
            <div className={`text-[13px] font-semibold ${o.cls ?? "text-foreground"}`}>
              {o.value}
            </div>
          </div>
        ))}
      </div>

      {/* posture: the trade-offs read for everyone; only a defense seat can change it */}
      <div className="mb-4">
        {/* A reader has no select to name the posture, so the label does. */}
        <Label>{canWrite ? "Posture" : `Posture · ${c.posture}`}</Label>
        {canWrite && (
          <select
            aria-label="Command posture"
            value={c.posture}
            onChange={(e) =>
              dispatch({
                type: "SET_POSTURE",
                commandId: c.id,
                posture: e.target.value as CommandPosture,
              })
            }
            className="mb-1.5 w-full rounded-lg border border-card-border bg-card px-3 py-2 text-[13px] text-foreground"
          >
            {POSTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <PostureEffects posture={c.posture} />
      </div>

      {/* commanders */}
      <div className="mb-4">
        <Label>
          Commanders · {c.commanderIds.length}
          {c.commanderIds.length === 0 && (
            <span className="ml-2 text-error">none · −10% efficiency</span>
          )}
          {c.commanderIds.length > 0 && !c.commandingGeneralId && (
            <span className="ml-2 text-warning">no commanding general</span>
          )}
        </Label>
        <div className="flex flex-col gap-2">
          {c.commanderIds.map((id) => {
            const cm = commandersById[id];
            if (!cm) return null;
            return (
              <div key={id} className="rounded-lg border border-card-border bg-card p-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                    {cm.name}
                  </span>
                  {c.commandingGeneralId === id ? (
                    <>
                      <Badge tone="gov">CG</Badge>
                      {/* Postings are made on the CG's own page, not here. Linking it
                          from the name closes the loop the callout above describes —
                          a CG reading this panel is one click from their work. */}
                      <a
                        href={`/country/${countryCode}/general/commands`}
                        className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted underline decoration-dotted underline-offset-2 hover:text-gov-soft"
                        title={`${cm.name}'s command page — post generals to conflicts`}
                      >
                        Command page →
                      </a>
                    </>
                  ) : (
                    canWrite &&
                    // A general may lead only one command — the CG's page resolves
                    // their command by first match. The reducer refuses this, so
                    // offering the button anyway would render a control that
                    // silently does nothing.
                    (state.commands.some((o) => o.id !== c.id && o.commandingGeneralId === id) ? (
                      <span
                        className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted"
                        title="A general can lead only one command"
                      >
                        Leads another
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_COMMANDING_GENERAL",
                            commandId: c.id,
                            commanderId: id,
                          })
                        }
                        aria-label={`Make ${cm.name} commanding general`}
                        title="Make commanding general"
                        className="shrink-0 rounded-md border border-card-border px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-foreground"
                      >
                        MAKE CG
                      </button>
                    ))
                  )}
                  <span className="dossier-label text-muted">fit</span>
                  <span className={`tabular text-base font-bold ${INTENT_TEXT[effIntent(cm.fit)]}`}>
                    {cm.fit}
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({ type: "REMOVE_COMMANDER", commandId: c.id, commanderId: id })
                      }
                      aria-label={`Remove ${cm.name}`}
                      className="px-1 text-muted hover:text-foreground"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone="muted">
                    {cm.spec} · Lvl {cm.level}
                  </Badge>
                  {postingOf(id) && (
                    <Badge tone={postingOf(id)!.inCharge ? "gov" : "info"}>
                      {postingOf(id)!.inCharge ? "◉ TC · " : ""}
                      {theaterName(postingOf(id)!.theaterId)}
                    </Badge>
                  )}
                </div>
                {canWrite && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Post ${cm.name} to a conflict`}
                      value={postingOf(id)?.theaterId ?? ""}
                      onChange={(e) => onSetPosting(id, e.target.value || null)}
                      className="min-w-0 flex-1 rounded-lg border border-card-border bg-card px-2 py-1.5 text-[12px] text-foreground"
                    >
                      <option value="">Not posted to a conflict</option>
                      {conflicts.map((cf) => (
                        <option key={cf.id} value={cf.id}>
                          {cf.name}
                        </option>
                      ))}
                    </select>
                    {postingOf(id) && !postingOf(id)!.inCharge && (
                      <button
                        type="button"
                        onClick={() => onSetInCharge(id)}
                        aria-label={`Put ${cm.name} in charge of ${theaterName(postingOf(id)!.theaterId)}`}
                        title="Theater Commander — the only officer who may declare offensives at this conflict, including instead of you"
                        className="shrink-0 rounded-md border border-card-border px-2 py-1 text-[10px] font-semibold text-muted hover:text-foreground"
                      >
                        MAKE TC
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canWrite && addOptions.length > 0 && (
          <select
            value=""
            onChange={(e) =>
              e.target.value &&
              dispatch({ type: "ADD_COMMANDER", commandId: c.id, commanderId: e.target.value })
            }
            aria-label="Add commander"
            className="mt-2 w-full rounded-lg border border-dashed border-card-border bg-card px-3 py-2 text-[12px] text-muted"
          >
            <option value="">＋ Add commander…</option>
            {addOptions.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name} · {co.spec} Lvl {co.level}
              </option>
            ))}
          </select>
        )}
        {canWrite && commanders.length === 0 && (
          <p className="mt-2 text-[11px] text-muted">
            No commissioned generals in this country yet — characters commission a general from
            their profile.
          </p>
        )}
      </div>

      {/* assigned regions */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="dossier-label text-muted">Assigned regions · {c.regionIds.length}</span>
          {canWrite && (
            <button
              type="button"
              onClick={onAssignRegions}
              className="rounded-md border border-card-border px-2.5 py-1 text-[10px] font-semibold text-muted hover:text-foreground"
            >
              ASSIGN
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {c.regionIds.map((rid) => {
            const r = getRegion(rid);
            if (!r) return null;
            const regionCmds = commandsOfRegion(state, rid);
            const overlap = hasSameTypeOverlap(regionCmds);
            return (
              <div
                key={rid}
                className="flex items-center gap-2 rounded-md border border-card-border bg-card px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {r.name}
                </span>
                <span className="dossier-label hidden shrink-0 text-muted sm:inline">
                  {r.macro}
                </span>
                <Badge tone={THREAT_TONE[regionThreats[rid] ?? "Low"]}>
                  {regionThreats[rid] ?? "Low"}
                </Badge>
                {overlap && <Badge tone="warning">Overlap</Badge>}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: "REMOVE_REGION", commandId: c.id, regionId: rid })
                    }
                    aria-label={`Remove ${r.name}`}
                    className="px-1 text-muted hover:text-foreground"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          {c.regionIds.length === 0 && (
            <div className="rounded-md border border-dashed border-card-border px-2.5 py-2 text-center text-[11px] text-muted">
              Global scope · no map regions
            </div>
          )}
        </div>
      </div>

      {/* assigned forces */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="dossier-label text-muted">Assigned forces</span>
          <span
            className={`tabular text-[11px] font-semibold ${over ? "text-warning" : "text-muted"}`}
          >
            load {load}/{c.cap}
          </span>
        </div>
        <div className="mb-2">
          <Meter
            value={loadPct}
            color={over ? "var(--warning)" : INTENT_METER[effTone]}
            height={6}
          />
        </div>
        <div className="flex flex-col gap-1">
          {c.unitIds.map((uid) => {
            const u = unitsById[uid];
            if (!u) return null;
            return (
              <div key={uid} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-foreground">{u.name}</span>
                <span className="dossier-label shrink-0 text-muted">load {unitLoad(u)}</span>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: "UNASSIGN_UNIT", commandId: c.id, unitId: uid })
                    }
                    aria-label={`Remove ${u.name}`}
                    className="px-1 text-muted hover:text-foreground"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          {c.unitIds.length === 0 && (
            <div className="text-[11px] text-muted">No units assigned</div>
          )}
        </div>
        {canWrite && pool.length > 0 && (
          <select
            value=""
            onChange={(e) =>
              e.target.value &&
              dispatch({ type: "ASSIGN_UNIT", commandId: c.id, unitId: e.target.value })
            }
            aria-label="Assign unit"
            className="mt-2 w-full rounded-lg border border-card-border bg-card px-3 py-2 text-[12px] text-foreground"
          >
            <option value="">＋ Assign unit…</option>
            {pool.map((u) => (
              <option key={String(u._id)} value={String(u._id)}>
                {u.name} · load {unitLoad(u)}
              </option>
            ))}
          </select>
        )}
        {over && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
            <div className="dossier-label mb-1 text-warning">⚠ Over-capacity penalties</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-warning">
              {overCapacityPenalties(c, unitsById).map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
