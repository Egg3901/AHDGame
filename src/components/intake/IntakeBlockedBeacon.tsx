"use client";

import { useEffect } from "react";
import { sendIntakeBeaconOnce } from "@/lib/analytics/intakeBeacon";

/** Counts each time a closed intake panel is shown instead of a form. */
export function IntakeBlockedBeacon({
  surface,
  reason,
}: {
  surface: "register" | "create_character";
  reason: string;
}) {
  useEffect(() => {
    sendIntakeBeaconOnce(`blocked:${surface}:${reason}`, "intake_blocked", { surface, reason });
  }, [surface, reason]);
  return null;
}
