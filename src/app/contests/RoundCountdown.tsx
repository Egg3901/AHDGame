"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface RoundCountdownProps {
  startedAt: string;
  endsAt: string;
  round: number;
  /** Server clock at render, so the first client render matches the HTML. */
  serverNow: number;
}

const MINUTE = 60_000;

/** Time left in the weekly round, with how much of the week has gone. Ticks every 30 seconds. */
export function RoundCountdown({ startedAt, endsAt, round, serverNow }: RoundCountdownProps) {
  const t = useTranslations("contests");
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const start = new Date(startedAt).getTime();
  const end = new Date(endsAt).getTime();
  const left = Math.max(0, end - now);
  const days = Math.floor(left / (24 * 60 * MINUTE));
  const hours = Math.floor((left % (24 * 60 * MINUTE)) / (60 * MINUTE));
  const minutes = Math.floor((left % (60 * MINUTE)) / MINUTE);
  const elapsed = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{t("countdown", { round })}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {left > 0 ? t("timeLeft", { days, hours, minutes }) : t("settling")}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(elapsed * 100)}
        aria-label={t("countdown", { round })}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${elapsed * 100}%` }} />
      </div>
    </div>
  );
}
