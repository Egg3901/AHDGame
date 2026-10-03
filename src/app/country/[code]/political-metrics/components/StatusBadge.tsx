import { scoreTone } from "./tones";

/** Objective-performance badge: status label colored by score band. */
export function StatusBadge({
  score,
  label,
  className,
}: {
  score: number;
  label: string;
  className?: string;
}) {
  const tone = scoreTone(score);
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-body-xs font-bold tracking-wide ${tone.border} ${tone.text} ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
