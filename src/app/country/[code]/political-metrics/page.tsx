import { notFound } from "next/navigation";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import PoliticalMetricsClient from "./PoliticalMetricsClient";

/** Political Metrics dashboard — available for the playable US/UK/RU/DD set only. */
export default async function PoliticalMetricsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const countryId = code.toUpperCase();
  if (!(POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(countryId)) {
    notFound();
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PoliticalMetricsClient code={code.toLowerCase()} />
    </div>
  );
}
