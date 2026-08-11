"use client";

import { useCallback, useEffect, useState } from "react";
import { readFeatureSeen, writeFeatureSeen } from "@/lib/ui/featureSeenStorage";

/**
 * Tracks whether the user has dismissed a one-time "New" feature badge.
 * Defaults to hidden until mounted to avoid a flash on SSR/hydration.
 */
export function useFeatureSeen(storageKey: string) {
  const [mounted, setMounted] = useState(false);
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
      setSeen(readFeatureSeen(storageKey));
    });
  }, [storageKey]);

  const markSeen = useCallback(() => {
    writeFeatureSeen(storageKey);
    setSeen(true);
  }, [storageKey]);

  return {
    mounted,
    isNew: mounted && !seen,
    markSeen,
  };
}
