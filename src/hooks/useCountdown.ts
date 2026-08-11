import { useState, useEffect } from "react";

/**
 * Counts down to a deadline and returns a human-readable string like "2h 15m 30s".
 * Returns "Expired" once the deadline has passed.
 */
export function useCountdown(deadline: string | null): string {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    if (!deadline) return;
    function tick() {
      const ms = new Date(deadline!).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining("Expired");
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setRemaining(`${h}h ${m}m ${s}s`);
    }
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [deadline]);

  return remaining;
}
