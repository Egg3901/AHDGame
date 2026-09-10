"use client";

import { useEffect } from "react";

export function DesktopLinkBridge() {
  useEffect(() => {
    void fetch("/api/client/link-session", { method: "POST" });
  }, []);
  return null;
}
