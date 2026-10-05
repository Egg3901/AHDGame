"use client";

import { useWorldFlags } from "@/hooks/useWorldFlags";
import { ResetMetricsPage } from "../metrics/ResetMetricsPage";
import PoliticalMetricsClient from "./PoliticalMetricsClient";

const RESET_COUNTRIES = new Set(["US", "UK", "JP"] as const);
type ResetCountry = "US" | "UK" | "JP";

export function PoliticalMetricsGate({ code }: { code: string }) {
  const countryId = code.toUpperCase();
  const resetCountry = RESET_COUNTRIES.has(countryId as ResetCountry)
    ? (countryId as ResetCountry)
    : null;
  const { loaded, failed, resetSystemVersions, resetV2Countries } = useWorldFlags();

  if (!resetCountry) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <PoliticalMetricsClient code={code.toLowerCase()} />
      </div>
    );
  }

  if (!loaded) {
    return <p role="status">Loading world settings...</p>;
  }

  const selectedV2 = resetSystemVersions.metrics === "v2";
  const verifiedV2 = selectedV2 && resetV2Countries.includes(resetCountry);
  if (failed || (selectedV2 && !verifiedV2)) {
    return (
      <p
        role="alert"
        className="mx-auto mt-8 max-w-3xl rounded-lg border border-error/40 bg-error/10 p-4 text-error"
      >
        The metrics version for this country could not be verified. Legacy metrics were not loaded.
      </p>
    );
  }

  if (verifiedV2) {
    return <ResetMetricsPage country={resetCountry} />;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PoliticalMetricsClient code={code.toLowerCase()} />
    </div>
  );
}

export default PoliticalMetricsGate;
