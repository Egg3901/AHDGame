"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function ClientLinkStatus({
  device,
  username,
}: {
  device: "mobile" | "desktop";
  username: string;
}) {
  const [status, setStatus] = useState<"linking" | "linked" | "failed">("linking");
  const [attempt, setAttempt] = useState(0);
  const t = useTranslations("auth.clientLink");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void fetch("/api/client/link-session", { method: "POST", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || (await response.json()).linked !== true) throw new Error("Link failed");
        if (active) setStatus("linked");
      })
      .catch(() => {
        if (active) setStatus("failed");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <section
      role="status"
      aria-live="polite"
      className={`w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm ${status === "linked" ? "border-success/30" : "border-border"}`}
    >
      {status === "linked" && (
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-2xl text-success"
          aria-hidden="true"
        >
          ✓
        </div>
      )}
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        {t(`${status}Title`, { device })}
      </h1>
      <p className="mt-3 text-muted">{t(`${status}Description`, { device, username })}</p>
      {status === "failed" && (
        <button
          type="button"
          className="mt-6 rounded-xl bg-primary px-5 py-2.5 font-medium text-primary-foreground"
          onClick={() => {
            setStatus("linking");
            setAttempt((value) => value + 1);
          }}
        >
          {t("retry")}
        </button>
      )}
    </section>
  );
}
