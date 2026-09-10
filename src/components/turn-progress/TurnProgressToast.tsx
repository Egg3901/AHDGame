"use client";

import { useCallback, useEffect, useReducer } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { refreshGameTurnStatus, useGameEvents, useGameTurnStatus } from "@/hooks/useGameEvents";
import { isLightweightLayoutPath } from "@/lib/constants/layoutPaths";
import {
  INITIAL_TURN_PROGRESS,
  reduceTurnProgress,
  type TurnProgressStatus,
} from "./turnProgressLifecycle";
import { TURN_PROGRESS_CARD_CLASS, TURN_PROGRESS_SLOT_CLASS } from "./turnProgressPresentation";

const EXCLUDED_PATHS = ["/", "/login", "/register", "/banned"];

function errorMessageFromEvent(event: Event): string | null {
  if (!("detail" in event)) return null;
  const detail = (event as CustomEvent<{ message?: string }>).detail;
  return typeof detail?.message === "string" ? detail.message : null;
}

export function TurnProgressToast() {
  const pathname = usePathname();
  const enabled = !EXCLUDED_PATHS.includes(pathname) && !isLightweightLayoutPath(pathname);
  const status = useGameTurnStatus(enabled) as TurnProgressStatus | null;
  const t = useTranslations("nav.singleplayer.progress");
  const [snap, dispatch] = useReducer(reduceTurnProgress, INITIAL_TURN_PROGRESS);

  useGameEvents(
    useCallback(() => {
      dispatch({ type: "complete" });
    }, []),
    ["turn_complete"],
    enabled
  );

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "reset" });
      return;
    }
    dispatch({ type: "status", status, nowMs: Date.now() });
  }, [enabled, status]);

  useEffect(() => {
    if (!enabled) return;
    const onComplete = () => dispatch({ type: "complete" });
    const onError = (event: Event) =>
      dispatch({ type: "error", message: errorMessageFromEvent(event) });
    const onCancel = () => dispatch({ type: "cancel" });
    const onOffline = () => dispatch({ type: "offline" });
    const onOnline = () => dispatch({ type: "online", nowMs: Date.now() });
    window.addEventListener("ahd:turn-complete", onComplete);
    window.addEventListener("ahd:turn-error", onError);
    window.addEventListener("ahd:turn-cancel", onCancel);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("ahd:turn-complete", onComplete);
      window.removeEventListener("ahd:turn-error", onError);
      window.removeEventListener("ahd:turn-cancel", onCancel);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);

  useEffect(() => {
    if (snap.view.kind === "hidden") return;
    const id = window.setInterval(() => {
      dispatch({ type: "tick", nowMs: Date.now() });
    }, 5_000);
    return () => window.clearInterval(id);
  }, [snap.view.kind]);

  if (!enabled || snap.view.kind === "hidden") return null;

  const view = snap.view;
  const title = view.targetTurn != null ? t("title", { turn: view.targetTurn }) : t("titleUnknown");
  const activity =
    view.activityId === "elections"
      ? t("activity.elections")
      : view.activityId === "economy"
        ? t("activity.economy")
        : view.activityId === "military"
          ? t("activity.military")
          : view.activityId === "policy"
            ? t("activity.policy")
            : view.activityId === "parties"
              ? t("activity.parties")
              : view.activityId === "people"
                ? t("activity.people")
                : view.activityId === "updating"
                  ? t("activity.updating", { label: view.activityLabel ?? "" })
                  : t("activity.preparing");
  const isAlert = view.kind !== "processing";
  const heading =
    view.kind === "stale"
      ? t("staleTitle")
      : view.kind === "offline"
        ? t("offlineTitle")
        : view.kind === "error"
          ? t("errorTitle")
          : title;
  const body =
    view.kind === "stale"
      ? t("staleBody")
      : view.kind === "offline"
        ? t("offlineBody")
        : view.kind === "error"
          ? view.errorMessage || t("errorTitle")
          : activity;

  return (
    <div className={TURN_PROGRESS_SLOT_CLASS} data-turn-progress-slot="">
      <aside
        className={TURN_PROGRESS_CARD_CLASS}
        role={isAlert ? "alert" : "status"}
        aria-live={isAlert ? "assertive" : "polite"}
        aria-atomic="true"
      >
        <div className="flex items-start gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
              {heading}
            </p>
            <p className="mt-0.5 truncate text-sm text-foreground">{body}</p>
          </div>
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-base leading-none text-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
            aria-label={t("dismiss")}
            onClick={() => dispatch({ type: "dismiss" })}
          >
            ×
          </button>
        </div>
        {view.kind === "processing" || view.progress != null ? (
          <div
            className="h-1 bg-foreground/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.progress ?? undefined}
            aria-label={title}
          >
            {view.progress != null ? (
              <div
                className="h-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${view.progress}%` }}
              />
            ) : (
              <div className="h-full w-1/4 bg-primary/30 motion-reduce:w-0" />
            )}
          </div>
        ) : null}
        {isAlert ? (
          <div className="flex justify-end px-3 pb-3">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
              onClick={() => {
                dispatch({ type: "retry", nowMs: Date.now() });
                void refreshGameTurnStatus();
              }}
            >
              {t("retry")}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
