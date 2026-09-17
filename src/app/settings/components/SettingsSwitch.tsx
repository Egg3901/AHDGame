"use client";

/** Thumb travel for the 48×28 track with an 18px knob and 4px end insets. */
export const SETTINGS_SWITCH_THUMB_OFF = "left-1 translate-x-0";
export const SETTINGS_SWITCH_THUMB_ON = "left-1 translate-x-[22px]";

/**
 * Settings control-panel switch. The thumb must keep an explicit `left-*`
 * anchor. Translate-only absolute positioning used the static position and
 * parked the knob outside the track (ticket #998).
 */
export function SettingsSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`relative h-7 w-12 rounded-full border transition-colors duration-200 ease-out ${
          checked ? "border-primary bg-primary" : "border-card-border bg-card-elevated"
        }`}
      >
        <span
          data-testid="settings-switch-thumb"
          className={`pointer-events-none absolute top-1 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
            checked ? SETTINGS_SWITCH_THUMB_ON : SETTINGS_SWITCH_THUMB_OFF
          }`}
        />
      </span>
    </button>
  );
}
