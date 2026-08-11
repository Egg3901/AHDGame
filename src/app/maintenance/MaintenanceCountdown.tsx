"use client";

import { useState, useEffect } from "react";

function getTimeLeft(target: string) {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return { hours, minutes, seconds };
}

type TimeLeft = ReturnType<typeof getTimeLeft>;

export function MaintenanceCountdown({ expectedEnd }: { expectedEnd: string }) {
  // `undefined` = not yet mounted. We must NOT compute the live countdown during
  // render or in the initial useState value: getTimeLeft() reads Date.now(),
  // which differs between the server (SSR) pass and client hydration, so the
  // seconds digit mismatches and React throws a hydration text-content error
  // (minified #418). The server render and the first client render both show the
  // stable "--" placeholder; every state update happens inside an async timer
  // callback (never synchronously in the effect body, per react-hooks/
  // set-state-in-effect), and a 0ms kick fills the real value in imperceptibly.
  const [timeLeft, setTimeLeft] = useState<TimeLeft | undefined>(undefined);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const tl = getTimeLeft(expectedEnd);
      setTimeLeft(tl);
      if (tl) timer = setTimeout(tick, 1000); // keep ticking only while counting down
    };
    timer = setTimeout(tick, 0); // 0ms kick → real value appears right after mount
    return () => clearTimeout(timer);
  }, [expectedEnd]);

  // Mounted (a tick has run) and past the expected end: the window is over.
  if (timeLeft === null) {
    return (
      <div className="mb-2 rounded-xl border border-success/30 bg-success/10 p-4">
        <p className="text-sm font-medium text-success">
          Maintenance should be complete — try refreshing the page.
        </p>
      </div>
    );
  }

  const segments = [
    { label: "Hours", value: timeLeft?.hours },
    { label: "Minutes", value: timeLeft?.minutes },
    { label: "Seconds", value: timeLeft?.seconds },
  ];

  return (
    <div className="mb-2">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
        Estimated Time Remaining
      </p>
      <div className="flex items-center justify-center gap-3">
        {segments.map(({ label, value }, i) => (
          <div key={label} className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <span className="rounded-lg border border-card-border bg-card px-4 py-2 font-mono text-2xl font-bold tabular-nums shadow-card sm:text-3xl">
                {value === undefined ? "--" : String(value).padStart(2, "0")}
              </span>
              <span className="mt-1.5 text-[10px] uppercase tracking-wider text-muted">
                {label}
              </span>
            </div>
            {i < segments.length - 1 && (
              <span className="mb-5 text-xl font-bold text-muted/40">:</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
