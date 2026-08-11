import { useState, useEffect } from "react";

/**
 * Hook that triggers a re-render every minute for countdown updates.
 */
export function useCountdownTimer(intervalMs: number = 60000): void {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
}
