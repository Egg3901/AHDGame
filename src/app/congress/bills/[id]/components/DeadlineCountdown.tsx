import { useCountdown } from "@/hooks/useCountdown";

export function DeadlineCountdown({ deadline }: { deadline: string }) {
  const remaining = useCountdown(deadline);
  return (
    <span
      className={`text-xs tabular-nums font-mono ${remaining === "Expired" ? "text-red-400" : "text-purple-300"}`}
    >
      ⏱ {remaining}
    </span>
  );
}
