import { leanTone } from "./tones";

/**
 * Political-association chip ("Strong Left" … "Strong Right"). Association
 * only — never a quality judgment, so it uses the blue↔red identity ramp,
 * not the score ramp.
 */
export function LeanChip({
  lean,
  label,
  className,
}: {
  lean: number;
  label: string;
  className?: string;
}) {
  const tone = leanTone(lean);
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-body-xs font-bold ${tone.border} ${tone.text} ${tone.bg} ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
