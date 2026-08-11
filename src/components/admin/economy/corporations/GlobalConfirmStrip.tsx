"use client";

import type { Dispatch } from "react";
import type { CorporationsAdminAction } from "../useCorporationsAdminState";

type GlobalConfirmType = "resetAll" | "resumeAll" | "spawnUnowned";

export function GlobalConfirmStrip({
  globalConfirm,
  actionLoading,
  onConfirm,
  dispatch,
}: {
  globalConfirm: GlobalConfirmType;
  actionLoading: string | null;
  onConfirm: (type: GlobalConfirmType) => void;
  dispatch: Dispatch<CorporationsAdminAction>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-warning/10 border border-warning/30 px-4 py-3 text-sm">
      <span className="text-warning font-medium">
        {globalConfirm === "resetAll"
          ? "Reset timers on all corporations?"
          : globalConfirm === "resumeAll"
            ? "Resume all suspended corporations?"
            : "Apply a one-time 20% revenue boost to ALL unowned sectors and seed any missing ones?"}
      </span>
      <button
        onClick={() => onConfirm(globalConfirm)}
        disabled={actionLoading === globalConfirm}
        className="px-3 py-1 rounded bg-warning text-warning-foreground text-xs font-medium hover:opacity-90"
      >
        Confirm
      </button>
      <button
        onClick={() => dispatch({ type: "SET_GLOBAL_CONFIRM", value: null })}
        className="text-xs text-muted hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
