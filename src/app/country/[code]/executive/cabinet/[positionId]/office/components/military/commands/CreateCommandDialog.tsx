"use client";

import { useState } from "react";
import type {
  CommandType,
  CommandPosture,
  SupplyPriority,
  MilitaryState,
  CommanderRef,
} from "@/lib/military/types";
import { COMMAND_TYPES, POSTURES, REGION_CAP } from "@/lib/military/config";
import { STRATEGIC_REGIONS } from "@/lib/military/regions";
import { validateDraft, type CommandDraft } from "@/lib/military/commands";
import { draftEffectiveness, effIntent } from "@/lib/military/calc";
import { Badge } from "../../dossier";
import { PostureEffects, TypeBonuses } from "./EffectLines";

const TYPE_KEYS: CommandType[] = ["HOMELAND_DEFENSE", "REGIONAL", "LOGISTICS"];
const SUPPLIES: SupplyPriority[] = ["Normal", "High", "Emergency"];
const INTENT_TEXT = { success: "text-success", warn: "text-warning", error: "text-error" } as const;

function emptyDraft(): CommandDraft {
  return {
    name: "",
    type: "REGIONAL",
    regionIds: [],
    commanderIds: [],
    commandingGeneralId: null,
    posture: "Deterrence",
    supply: "Normal",
  };
}

/** Cabinet create-command dialog. Confirms with a validated draft; the parent
 *  dispatches CREATE_COMMAND. */
export function CreateCommandDialog({
  state,
  commanders,
  onCreate,
  onClose,
}: {
  state: MilitaryState;
  commanders: CommanderRef[];
  onCreate: (draft: CommandDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CommandDraft>(emptyDraft);
  const set = (patch: Partial<CommandDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleRegion = (rid: string) =>
    setDraft((d) => {
      const has = d.regionIds.includes(rid);
      if (!has && d.regionIds.length >= REGION_CAP) return d;
      return {
        ...d,
        regionIds: has ? d.regionIds.filter((x) => x !== rid) : [...d.regionIds, rid],
      };
    });
  const toggleCommander = (id: string) =>
    setDraft((d) => {
      const has = d.commanderIds.includes(id);
      return {
        ...d,
        commanderIds: has ? d.commanderIds.filter((x) => x !== id) : [...d.commanderIds, id],
      };
    });

  // validateDraft returns advisory warnings (they inform, they don't block); a command
  // only needs a name to be created.
  const warnings = validateDraft(draft, state);
  const canConfirm = draft.name.trim().length > 0;
  const preview = draftEffectiveness(draft);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Create command"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100dvh-4rem)] w-full max-w-lg flex-col rounded-xl border border-card-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-card-border p-5">
          <h3 className="text-base font-semibold text-foreground">New theater command</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-card-border px-2 text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div>
            <div className="dossier-label mb-1.5 text-muted">Command name</div>
            <input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Southern Command"
              className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px] text-foreground"
            />
          </div>

          <div>
            <div className="dossier-label mb-1.5 text-muted">Type</div>
            <div className="flex flex-wrap gap-2">
              {TYPE_KEYS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set({ type: t })}
                  aria-pressed={draft.type === t}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
                    draft.type === t
                      ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft"
                      : "border-card-border text-muted hover:text-foreground"
                  }`}
                >
                  {COMMAND_TYPES[t].label}
                </button>
              ))}
            </div>
            <TypeBonuses type={draft.type} className="mt-1.5" />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <div className="dossier-label mb-1.5 text-muted">Posture</div>
              <select
                aria-label="Posture"
                value={draft.posture}
                onChange={(e) => set({ posture: e.target.value as CommandPosture })}
                className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px] text-foreground"
              >
                {POSTURES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <PostureEffects posture={draft.posture} className="mt-1.5" />
            </div>
            <div className="flex-1">
              <div className="dossier-label mb-1.5 text-muted">Supply priority</div>
              <select
                value={draft.supply}
                onChange={(e) => set({ supply: e.target.value as SupplyPriority })}
                className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px] text-foreground"
              >
                {SUPPLIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="dossier-label mb-1.5 text-muted">
              Regions · {draft.regionIds.length}/{REGION_CAP}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STRATEGIC_REGIONS.map((r) => {
                const active = draft.regionIds.includes(r.id);
                const disabled = !active && draft.regionIds.length >= REGION_CAP;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleRegion(r.id)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      active
                        ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft"
                        : "border-card-border text-muted hover:text-foreground"
                    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="dossier-label mb-1.5 text-muted">
              Commanders · {draft.commanderIds.length}
            </div>
            {commanders.length === 0 ? (
              <p className="text-[11px] text-muted">
                No commissioned generals in this country yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {commanders.map((cm) => {
                  const active = draft.commanderIds.includes(cm.id);
                  return (
                    <button
                      key={cm.id}
                      type="button"
                      onClick={() => toggleCommander(cm.id)}
                      title={`${cm.spec} · Lvl ${cm.level} · fit ${cm.fit}`}
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        active
                          ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft"
                          : "border-card-border text-muted hover:text-foreground"
                      }`}
                    >
                      {cm.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {warnings.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-[11px] text-warning">
              {warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-card-border p-5">
          <Badge tone="muted">
            Projected effectiveness{" "}
            <span className={INTENT_TEXT[effIntent(preview)]}>{preview}%</span>
          </Badge>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-card-border px-3 py-2 text-[12px] font-semibold text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => onCreate(draft)}
              className="rounded-lg bg-[var(--gov)] px-4 py-2 text-[12px] font-bold text-[#1a1200] disabled:opacity-40"
            >
              Create command
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
