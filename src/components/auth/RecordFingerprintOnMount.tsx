"use client";

import { useEffect } from "react";
import { generateFingerprintData } from "@/lib/utils/fingerprint";

/**
 * Fires once on mount: computes the ThumbmarkJS fingerprint + components and
 * POSTs them to the advisory /api/auth/record-fingerprint endpoint. Mounted on
 * the OAuth result pages (only when the auth succeeded) to close the gap where
 * OAuth registrations cannot carry components through the size-limited OAuth
 * cookie. `keepalive` lets the request finish even though the result page
 * redirects away after its short countdown.
 */
export default function RecordFingerprintOnMount() {
  useEffect(() => {
    let cancelled = false;
    generateFingerprintData()
      .then(({ hash, components }) => {
        if (cancelled) return;
        return fetch("/api/auth/record-fingerprint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: hash, fingerprintComponents: components }),
          keepalive: true,
        });
      })
      .catch(() => {
        // Advisory only — failure falls back to next-login capture.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
