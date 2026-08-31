import type { CommandPosture, CommandType } from "@/lib/military/types";
import { COMMAND_TYPES, POSTURE_FX } from "@/lib/military/config";

/** Stated effects as config lists them: one signed line each ("+ deployment
 *  speed", "− higher supply cost"). The sign sets the tone. Shared by every
 *  surface that names a command's posture or type, so the cabinet builder and
 *  the commanding general's read-only page say the same thing. */
export function EffectLines({
  lines,
  label,
  className = "",
}: {
  lines: string[];
  label: string;
  className?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <ul aria-label={label} className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] ${className}`}>
      {lines.map((line) => (
        <li key={line} className={line.startsWith("−") ? "text-warning" : "text-success"}>
          {line}
        </li>
      ))}
    </ul>
  );
}

/** The trade-offs of a command posture. A posture config does not know renders nothing. */
export function PostureEffects({
  posture,
  className,
}: {
  posture: CommandPosture;
  className?: string;
}) {
  return (
    <EffectLines
      lines={POSTURE_FX[posture] ?? []}
      label={`${posture} trade-offs`}
      className={className}
    />
  );
}

/** The bonuses of a command type. A type config does not know renders nothing. */
export function TypeBonuses({ type, className }: { type: CommandType; className?: string }) {
  const def = COMMAND_TYPES[type];
  if (!def) return null;
  return <EffectLines lines={def.bonuses} label={`${def.label} bonuses`} className={className} />;
}
