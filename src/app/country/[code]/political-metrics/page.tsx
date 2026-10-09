import { notFound } from "next/navigation";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import { PoliticalMetricsGate } from "./PoliticalMetricsGate";
import { RESET_V2_COUNTRIES } from "@/lib/resetVersions/rules";

/** Version-aware national metrics dashboard. */
export default async function PoliticalMetricsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const countryId = code.toUpperCase();
  if (
    !(POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(countryId) &&
    !(RESET_V2_COUNTRIES as readonly string[]).includes(countryId)
  ) {
    notFound();
  }
  return <PoliticalMetricsGate code={code.toLowerCase()} />;
}
