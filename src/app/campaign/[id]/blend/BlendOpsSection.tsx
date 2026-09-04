"use client";

import { useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendCharacterPicker, type PickerResult } from "./BlendCharacterPicker";
import type { OpsRowVM, OpsBranchVM, OpsTreeVM } from "./campaignBlendViewModel";
import type { UpgradeCategory } from "@/lib/campaigns/upgradeCosts";

export interface BlendOpsSectionProps {
  rows: OpsRowVM[];
  /** Total invested line under the heading. */
  investedLine: string;
  /** Whether the viewer may buy anything at all. */
  canAct: boolean;
  /** Which lever's purchase is currently in flight, as "category" or "category:branch". */
  pending: string | null;
  onToggle: (category: UpgradeCategory) => void;
  onUnlock: (category: UpgradeCategory) => void;
  onUpgrade: (category: UpgradeCategory, branch: "a" | "b" | "c") => void;
  /** Change the opposition-research target. Omitted for viewers who may not. */
  onRetarget?: (targetId: string) => void;
  variant?: "desktop" | "mobile";
}

function actionButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    border: 0,
    borderRadius: 8,
    padding: 6,
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".08em",
    ...(enabled
      ? { background: BLEND.ink, color: "#14141c", cursor: "pointer" }
      : { background: BLEND.hairlineStrong, color: BLEND.muted, cursor: "not-allowed" }),
  };
}

function BranchCard({
  branch,
  color,
  canAct,
  pending,
  onUpgrade,
}: {
  branch: OpsBranchVM;
  color: string;
  canAct: boolean;
  pending: boolean;
  onUpgrade: () => void;
}) {
  const enabled = canAct && branch.actionable && branch.affordable && !pending;
  const label = pending ? "Working" : !branch.affordable ? "Can't Afford" : "Upgrade";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.inset,
        padding: 14,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}
      >
        <span style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600 }}>
          {branch.label}
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: 14, color }}>{branch.level}</span>
      </div>
      <p
        style={{
          margin: "4px 0 10px",
          fontFamily: FONT.serif,
          fontSize: 13,
          lineHeight: 1.5,
          color: BLEND.muted,
        }}
      >
        {branch.description}
      </p>
      <div style={{ marginBottom: 10, display: "flex", gap: 4 }}>
        {branch.segments.map((s, i) => (
          <i key={i} style={s} />
        ))}
      </div>

      {branch.statusText ? (
        <div
          style={{
            marginTop: "auto",
            fontFamily: FONT.mono,
            fontSize: 10.5,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: BLEND.mutedDim,
          }}
        >
          {branch.statusText}
        </div>
      ) : null}

      {branch.actionable && canAct ? (
        <div style={{ marginTop: "auto" }}>
          <div
            style={{
              marginBottom: 5,
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span style={{ fontFamily: FONT.serif, fontSize: 13, color: BLEND.muted }}>
              {branch.effect}
            </span>
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 11,
                color: BLEND.muted,
                whiteSpace: "nowrap",
              }}
            >
              {branch.costText}
            </span>
          </div>
          {branch.maintenanceText ? (
            <div
              style={{
                marginBottom: 6,
                fontFamily: FONT.mono,
                fontSize: 10,
                color: "rgba(234,179,8,.75)",
              }}
            >
              {branch.maintenanceText}
            </div>
          ) : null}
          <button
            type="button"
            disabled={!enabled}
            onClick={onUpgrade}
            style={actionButtonStyle(enabled)}
          >
            {label}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Tree({
  tree,
  color,
  canAct,
  category,
  pending,
  onUnlock,
  onUpgrade,
  onRetarget,
  variant,
}: {
  tree: OpsTreeVM;
  color: string;
  canAct: boolean;
  category: UpgradeCategory;
  pending: string | null;
  onUnlock: () => void;
  onUpgrade: (branch: "a" | "b" | "c") => void;
  onRetarget?: (targetId: string) => void;
  variant: "desktop" | "mobile";
}) {
  const [retargeting, setRetargeting] = useState(false);
  const unlockPending = pending === category;
  const unlockEnabled = canAct && tree.starterAffordable && !unlockPending;

  return (
    <div
      style={{
        padding: variant === "mobile" ? "12px 0 16px" : "4px 0 22px",
        borderBottom: "1px solid rgba(42,42,61,.6)",
      }}
    >
      <div
        style={{
          marginBottom: variant === "mobile" ? 12 : 14,
          padding: variant === "mobile" ? "11px 12px" : "12px 14px",
          borderLeft: `2px solid ${color}`,
          background: "rgba(255,255,255,.02)",
        }}
      >
        {tree.unlocked ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span style={{ fontFamily: FONT.serif, fontSize: 15, fontWeight: 600, color }}>
                Operation active
              </span>
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 10.5,
                  letterSpacing: ".1em",
                  color: BLEND.positive,
                }}
              >
                UNLOCKED
              </span>
            </div>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: FONT.serif,
                fontSize: 13.5,
                color: BLEND.muted,
              }}
            >
              {tree.starterEffect}
            </p>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span style={{ fontFamily: FONT.serif, fontSize: 15, fontWeight: 600, color }}>
                Unlock operation
              </span>
              <span style={{ fontFamily: FONT.mono, fontSize: 11, color: BLEND.muted }}>
                {tree.starterCostText}
              </span>
            </div>
            <p
              style={{
                margin: "4px 0 10px",
                fontFamily: FONT.serif,
                fontSize: 13.5,
                color: BLEND.muted,
              }}
            >
              {tree.starterEffect}
            </p>
            {canAct ? (
              <button
                type="button"
                disabled={!unlockEnabled}
                onClick={onUnlock}
                style={actionButtonStyle(unlockEnabled)}
              >
                {unlockPending
                  ? "Working"
                  : tree.starterAffordable
                    ? "Unlock"
                    : "Insufficient Resources"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {tree.requiresTarget && tree.targetName ? (
        <div
          style={{
            marginBottom: 14,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            border: `1px solid ${BLEND.hairlineStrong}`,
            background: BLEND.inset,
          }}
        >
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: BLEND.mutedDim,
            }}
          >
            Current target
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: FONT.serif, fontSize: 15, fontWeight: 600 }}>
              {tree.targetName}
            </span>
            {onRetarget ? (
              <button
                type="button"
                onClick={() => setRetargeting((v) => !v)}
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
                {retargeting ? "Cancel" : "Change"}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {tree.requiresTarget && onRetarget && retargeting ? (
        <div style={{ marginBottom: 14 }}>
          <BlendCharacterPicker
            placeholder="Search an opponent to research…"
            excludeIds={[]}
            onPick={(r: PickerResult) => {
              setRetargeting(false);
              onRetarget(r.id);
            }}
          />
        </div>
      ) : null}

      <div
        style={
          variant === "mobile"
            ? {
                display: "flex",
                flexDirection: "column",
                gap: 10,
                opacity: tree.unlocked ? 1 : 0.5,
              }
            : {
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 12,
                opacity: tree.unlocked ? 1 : 0.5,
              }
        }
      >
        {tree.branches.map((b) => (
          <BranchCard
            key={b.key}
            branch={b}
            color={color}
            canAct={canAct}
            pending={pending === `${category}:${b.key}`}
            onUpgrade={() => onUpgrade(b.key)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The Blend strategic-operations board. Rows expand in place rather than
 * opening the overlay modal the current build uses.
 */
export function BlendOpsSection({
  rows,
  investedLine,
  canAct,
  pending,
  onToggle,
  onUnlock,
  onUpgrade,
  onRetarget,
  variant = "desktop",
}: BlendOpsSectionProps) {
  const mobile = variant === "mobile";

  return (
    <section
      style={{
        padding: mobile ? "18px 16px" : "24px 26px",
        borderBottom: mobile ? undefined : `1px solid ${BLEND.hairlineStrong}`,
      }}
    >
      <h2
        style={{
          margin: mobile ? "0 0 12px" : "0 0 4px",
          fontFamily: FONT.serif,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        Strategic operations
      </h2>
      {!mobile ? (
        <p
          style={{
            margin: "0 0 18px",
            fontFamily: FONT.serif,
            fontSize: 14.5,
            lineHeight: 1.55,
            color: BLEND.muted,
          }}
        >
          {investedLine}
        </p>
      ) : null}

      {rows.map((row) => (
        <div key={row.key}>
          <button
            type="button"
            aria-expanded={row.expanded}
            onClick={() => onToggle(row.key)}
            style={
              mobile
                ? {
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 0",
                    border: 0,
                    borderBottom: "1px solid rgba(42,42,61,.6)",
                    background: "transparent",
                    cursor: "pointer",
                    font: "inherit",
                    color: BLEND.ink,
                  }
                : {
                    display: "grid",
                    gridTemplateColumns: "210px minmax(0, 1fr) 118px 56px 22px",
                    alignItems: "center",
                    gap: 18,
                    width: "100%",
                    padding: "14px 0",
                    border: 0,
                    borderBottom: `1px solid ${row.expanded ? "transparent" : "rgba(42,42,61,.6)"}`,
                    background: row.expanded ? "rgba(255,255,255,.02)" : "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    color: BLEND.ink,
                  }
            }
          >
            {mobile ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600 }}>
                    {row.label}
                  </span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: 14, color: row.color }}>
                      {row.level}
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: 14, color: BLEND.mutedDim }}>
                      {row.expanded ? "−" : "+"}
                    </span>
                  </span>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 3 }}>
                  {row.segments.map((s, i) => (
                    <i key={i} style={s} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: FONT.serif,
                      fontSize: 17,
                      fontWeight: 600,
                    }}
                  >
                    {row.label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontFamily: FONT.serif,
                      fontSize: 13,
                      color: BLEND.mutedDim,
                    }}
                  >
                    {row.description}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 3 }}>
                  {row.segments.map((s, i) => (
                    <i key={i} style={s} />
                  ))}
                </span>
                <span style={{ fontFamily: FONT.serif, fontSize: 13, color: BLEND.muted }}>
                  {row.effect}
                </span>
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: FONT.mono,
                    fontSize: 16,
                    color: row.color,
                  }}
                >
                  {row.level}
                </span>
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: FONT.mono,
                    fontSize: 15,
                    color: BLEND.mutedDim,
                  }}
                >
                  {row.expanded ? "−" : "+"}
                </span>
              </>
            )}
          </button>

          {row.expanded && row.tree ? (
            <Tree
              tree={row.tree}
              color={row.color}
              canAct={canAct}
              category={row.key}
              pending={pending}
              onUnlock={() => onUnlock(row.key)}
              onUpgrade={(b) => onUpgrade(row.key, b)}
              onRetarget={onRetarget}
              variant={variant}
            />
          ) : null}
        </div>
      ))}
    </section>
  );
}
