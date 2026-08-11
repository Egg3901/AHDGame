"use client";

export interface PsSpendButtonsProps {
  /**
   * Which PS pools the viewer may spend from. Each `true` pool renders its own
   * labeled button. `null` (eligibility not yet loaded / fetch failed) or both
   * `false` (no eligible pool) → a single unlabeled button; the server resolves
   * the canonical pool.
   */
  scopes: { state: boolean; national: boolean } | null;
  /** Accent color for the primary (filled) button. */
  color: string;
  busy: boolean;
  /** Idle label, e.g. "Build Org" / "Contest". */
  label: string;
  /** Busy label, e.g. "Building…" / "Contesting…". */
  busyLabel: string;
  /** Disabled state for the single (unlabeled) button. */
  singleDisabled: boolean;
  /** Disabled state for the State PS button. */
  stateDisabled: boolean;
  /** Disabled state for the Nat'l PS button. */
  nationalDisabled: boolean;
  /** Optional tooltips. */
  singleTitle?: string;
  stateTitle?: string;
  nationalTitle?: string;
  /** Optional animation class applied to the filled button(s). */
  buttonAnim?: string;
  onSpend: (pool?: "state" | "national") => void;
}

/**
 * Shared PS-pool spend buttons for Build Org / Contest. Renders one labeled
 * button per PS pool the viewer is eligible for: a national-tier officer always
 * gets the `· Nat'l PS` button; a state-tier officer gets `· State PS`; a
 * dual-role officer gets both. When the viewer is eligible for neither pool (or
 * eligibility is not yet known), a single unlabeled button is shown and the
 * server resolves the canonical pool.
 *
 * Styling: the State button (or the sole eligible button) is filled with
 * `color`; a Nat'l button shown alongside the State button is an outline.
 */
export function PsSpendButtons({
  scopes,
  color,
  busy,
  label,
  busyLabel,
  singleDisabled,
  stateDisabled,
  nationalDisabled,
  singleTitle,
  stateTitle,
  nationalTitle,
  buttonAnim = "",
  onSpend,
}: PsSpendButtonsProps) {
  const showState = !!scopes?.state;
  const showNational = !!scopes?.national;

  const filledClass = `rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity ${buttonAnim}`;
  const filledStyle = { backgroundColor: color, "--ps-bloom-color": color } as React.CSSProperties;
  const outlineClass =
    "rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity";
  const outlineStyle = { border: `1px solid ${color}`, color } as React.CSSProperties;

  if (showState || showNational) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {showState && (
          <button
            type="button"
            onClick={() => onSpend("state")}
            disabled={busy || stateDisabled}
            title={stateTitle}
            className={filledClass}
            style={filledStyle}
          >
            {busy ? busyLabel : `${label} · State PS`}
          </button>
        )}
        {showNational && (
          <button
            type="button"
            onClick={() => onSpend("national")}
            disabled={busy || nationalDisabled}
            title={nationalTitle}
            className={showState ? outlineClass : filledClass}
            style={showState ? outlineStyle : filledStyle}
          >
            {busy ? busyLabel : `${label} · Nat'l PS`}
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSpend()}
      disabled={busy || singleDisabled}
      title={singleTitle}
      className={filledClass}
      style={filledStyle}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
