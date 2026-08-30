import type { CommandPosture } from "@/lib/military/types";
import { POSTURE_FX } from "@/lib/military/config";

/** The stated trade-offs of a command posture. Config lists each as a signed
 *  line ("+ deployment speed", "− higher supply cost"); the sign sets the tone. */
export function PostureEffects({
  posture,
  className = "",
}: {
  posture: CommandPosture;
  className?: string;
}) {
  const fx = POSTURE_FX[posture] ?? [];
  if (fx.length === 0) return null;
  return (
    <ul
      aria-label={`${posture} trade-offs`}
      className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] ${className}`}
    >
      {fx.map((line) => (
        <li key={line} className={line.startsWith("−") ? "text-warning" : "text-success"}>
          {line}
        </li>
      ))}
    </ul>
  );
}
