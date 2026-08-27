"use client";

import { useState } from "react";
import {
  DOCTRINE_CATS,
  DECADES,
  ERASHORT,
  GRP,
  keyOf,
  findNode,
  nodeStatus,
  adoptedCount,
  categoryTotal,
  isAdoptedByName,
  missingPrerequisites,
  pills,
  type NodeStatus,
  type DoctrineState,
} from "@/lib/military/doctrineTree";
import { SectionCard, Badge, Meter } from "../dossier";
import { useDoctrineState } from "./useDoctrineState";
import { ActingLockNote, useActingLock } from "../ActingLock";

const STATUS_TONE: Record<NodeStatus, "success" | "gov" | "muted"> = {
  adopted: "success",
  available: "gov",
  locked: "muted",
  future: "muted",
};

const STATUS_DOT: Record<NodeStatus, string> = {
  adopted: "var(--success, #4ea87a)",
  available: "var(--gov)",
  locked: "#4a4a58",
  future: "#3a3a48",
};

/**
 * National doctrine tech-tree authoring surface for the Secretary of Defense
 * Office (Doctrine tab). Cabinet-styled; client-state mockup via useDoctrineState.
 */
export function DoctrineTab({
  currentEra,
  doctrine,
  countryCode,
  positionId,
  onAdopt,
}: {
  currentEra: number;
  doctrine: DoctrineState;
  countryCode: string;
  positionId: string;
  onAdopt: () => void;
}) {
  const { state, adopt } = useDoctrineState(doctrine, { countryCode, positionId, onAdopt });
  const [selCatId, setSelCatId] = useState<string>(DOCTRINE_CATS[0].id);
  const [selKey, setSelKey] = useState<string | null>(null);
  // `adopt` already extracts the server's refusal reason; discarding it would leave
  // an Adopt button that silently does nothing when points/prereqs/era say no.
  const [adoptError, setAdoptError] = useState<string | null>(null);

  const cat = DOCTRINE_CATS.find((c) => c.id === selCatId) ?? DOCTRINE_CATS[0];
  const sel = selKey ? findNode(selKey) : null;
  const activePills = pills(state.adopted);
  const pillGroups = Object.keys(GRP)
    .map((k) => ({
      key: k,
      label: GRP[k].label,
      color: GRP[k].color,
      items: activePills.filter((p) => p.color === GRP[k].color),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {/* header: points + era */}
      <SectionCard
        title="National Doctrine"
        sub={`Adopt era-gated doctrines to shape the force. Current era: ${ERASHORT[currentEra] ?? "—"}`}
        right={
          <div className="text-right">
            <div className="tabular text-3xl font-black leading-none text-gov-soft">
              {state.points}
            </div>
            <div className="dossier-label text-muted">Doctrine Points</div>
          </div>
        }
      >
        <p className="-mt-1 mb-3 text-[11px] leading-relaxed text-muted">
          Your country starts with 12 doctrine points and gains 1 more at the start of each game
          year. Adoption spends that pool; there is no refund.
        </p>
        {/* category nav */}
        <div className="flex flex-wrap gap-2">
          {DOCTRINE_CATS.map((c) => {
            const active = c.id === selCatId;
            const adopted = adoptedCount(state.adopted, c.id);
            const total = categoryTotal(c.id);
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelCatId(c.id);
                  setSelKey(null);
                }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                  active
                    ? "border-[color-mix(in_srgb,var(--gov)_55%,transparent)] bg-[color-mix(in_srgb,var(--gov)_12%,transparent)] text-foreground"
                    : "border-card-border bg-card-elevated text-muted hover:text-foreground"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: c.color }}
                />
                <span className="truncate">{c.name}</span>
                <span className="tabular shrink-0 text-[10px] text-muted">
                  {adopted}/{total}
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* matrix: paths × decade nodes for the selected category */}
        <div className="min-w-0 flex-1">
          <SectionCard title={cat.name} sub="Select a doctrine to review and adopt.">
            {/* ONE scroll container for the whole matrix, not one per path. Beyond
                removing three redundant scrollbars, this keeps the decade columns
                aligned across paths — independently scrolled rows could put 1900s
                next to 1930s and misread as a prerequisite chain. */}
            <div className="overflow-x-auto pb-1">
              <div className="w-max space-y-4">
                {cat.paths.map((path) => (
                  <div key={path.id}>
                    {/* Pinned so the path stays identifiable once scrolled right. */}
                    <div
                      className="dossier-label sticky left-0 mb-1.5 w-fit"
                      style={{ color: path.color }}
                    >
                      {path.name}
                    </div>
                    <div className="flex gap-1.5">
                      {path.nodes.map((node) => {
                        const key = keyOf(path.id, node.d);
                        const st = nodeStatus(state.adopted, path, node, currentEra);
                        const selected = selKey === key;
                        return (
                          <button
                            key={key}
                            onClick={() => setSelKey(key)}
                            title={`${node.name} · ${DECADES[node.d]}`}
                            className={`flex min-w-[92px] shrink-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left ${
                              selected ? "border-gov-soft" : "border-card-border"
                            } ${st === "future" || st === "locked" ? "opacity-55" : ""}`}
                            style={{ background: "var(--card-elevated, #1a1a24)" }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: STATUS_DOT[st] }}
                              />
                              <span className="tabular text-[9px] text-muted">
                                {DECADES[node.d]}
                              </span>
                            </div>
                            <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground">
                              {node.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        {/* detail + active effects */}
        <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
          {adoptError && (
            <p role="alert" className="text-[11px] text-error">
              {adoptError}
            </p>
          )}
          {sel ? (
            <DetailCard
              selKey={selKey!}
              currentEra={currentEra}
              points={state.points}
              adopted={state.adopted}
              onAdopt={() => {
                void adopt(selKey!).then((r) =>
                  setAdoptError(r.ok ? null : (r.reason ?? "That doctrine could not be adopted."))
                );
              }}
            />
          ) : (
            <SectionCard title="Doctrine detail">
              <p className="text-[12px] text-muted">
                Select a doctrine node to review its effects, prerequisites, and cost.
              </p>
            </SectionCard>
          )}

          <SectionCard
            title="Active doctrine effects"
            sub="Force-wide modifiers from adopted doctrines"
          >
            {pillGroups.length === 0 ? (
              <p className="text-[12px] text-muted">No active doctrine effects.</p>
            ) : (
              <div className="space-y-3">
                {pillGroups.map((g) => (
                  <div key={g.key}>
                    <div className="dossier-label mb-1" style={{ color: g.color }}>
                      {g.label}
                    </div>
                    <div className="flex flex-col gap-1">
                      {g.items.map((i) => (
                        <div
                          key={i.label + i.src}
                          className="flex items-start gap-1.5 text-[11px] text-foreground/80"
                        >
                          <span style={{ color: g.color }}>▸</span>
                          <span>{i.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function DetailCard({
  selKey,
  currentEra,
  points,
  adopted,
  onAdopt,
}: {
  selKey: string;
  currentEra: number;
  points: number;
  adopted: Record<string, number>;
  onAdopt: () => void;
}) {
  // Before the early return below: a hook cannot sit behind a conditional.
  const actingLockReason = useActingLock("doctrine");

  const f = findNode(selKey);
  if (!f) return null;
  const st = nodeStatus(adopted, f.path, f.node, currentEra);
  const effects = f.node.eff.split(" · ");
  const reqs = (f.node.req ?? []).map((r) => ({
    label: r,
    ok: isAdoptedByName(adopted, r),
  }));
  const missing = missingPrerequisites(adopted, f.path, f.node);
  const canAdopt = st === "available" && points >= f.node.cost && !actingLockReason;

  const statusTone = STATUS_TONE[st];
  const statusLabel =
    st === "adopted"
      ? "Adopted"
      : st === "available"
        ? "Available"
        : st === "future"
          ? `Requires ${ERASHORT[f.node.d]} era`
          : "Locked";

  return (
    <SectionCard
      title={f.node.name}
      sub={`${f.cat.name} · ${f.path.name} · ${DECADES[f.node.d]}`}
      right={<Badge tone={statusTone}>{statusLabel}</Badge>}
    >
      <div className="space-y-3">
        {f.node.desc && <p className="text-[12px] text-foreground/80">{f.node.desc}</p>}

        <div>
          <div className="dossier-label mb-1 text-muted">Effects</div>
          <div className="flex flex-col gap-1">
            {effects.map((e) => (
              <div key={e} className="flex items-start gap-1.5 text-[12px] text-foreground/85">
                <span className="text-gov-soft">▸</span>
                <span>{e}</span>
              </div>
            ))}
          </div>
        </div>

        {reqs.length > 0 && (
          <div>
            <div className="dossier-label mb-1 text-muted">Prerequisites</div>
            <div className="flex flex-col gap-1">
              {reqs.map((r) => (
                <div
                  key={r.label}
                  className={`flex items-center gap-1.5 text-[12px] ${r.ok ? "text-success" : "text-error"}`}
                >
                  <span>{r.ok ? "✓" : "✕"}</span>
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {f.node.x && f.node.x.length > 0 && (
          <div className="flex flex-col gap-1">
            {f.node.x.map((x) => (
              <div key={x} className="text-[11px] text-error/90">
                Conflicts with {x}
              </div>
            ))}
          </div>
        )}

        {f.node.unlocks && f.node.unlocks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {f.node.unlocks.map((u) => (
              <Badge key={u} tone="info">
                Unlocks {u}
              </Badge>
            ))}
          </div>
        )}

        {st === "adopted" ? (
          <div className="rounded-lg border border-success/40 bg-success/10 py-2 text-center text-[12px] font-semibold text-success">
            ✓ Doctrine adopted
          </div>
        ) : (
          <button
            onClick={onAdopt}
            disabled={!canAdopt}
            className={`w-full rounded-lg py-2.5 text-[12px] font-bold ${
              canAdopt
                ? "bg-[var(--gov)] text-[#1a1200] hover:brightness-110"
                : "cursor-not-allowed border border-card-border bg-card-elevated text-muted"
            }`}
          >
            {canAdopt
              ? `Adopt doctrine · ${f.node.cost} pt${f.node.cost === 1 ? "" : "s"}`
              : st === "future"
                ? `Requires ${ERASHORT[f.node.d]} era`
                : st === "locked"
                  ? "Prerequisites not met"
                  : "Insufficient doctrine points"}
          </button>
        )}
        <ActingLockNote reason={actingLockReason} />

        {/* Name what is actually blocking the node. The button stays on one line,
            so the prerequisite list goes underneath it. */}
        {st === "locked" && missing.length > 0 && (
          <div className="text-center text-[11px] text-muted">Requires: {missing.join(", ")}</div>
        )}

        {/* cost/points context bar */}
        <div className="flex items-center gap-2">
          <span className="dossier-label text-muted">Cost</span>
          <Meter
            value={f.node.cost}
            max={Math.max(f.node.cost, points, 1)}
            color="var(--gov)"
            height={6}
          />
          <span className="tabular text-[11px] text-muted">
            {f.node.cost} / {points}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
