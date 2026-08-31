import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import IntelligenceClient from "./IntelligenceClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) return { title: "Intelligence Not Found | A House Divided" };
  return {
    title: `Intelligence | ${config.name} | A House Divided`,
    description: `${config.name} intelligence service: networks, coverage and operations.`,
  };
}

/**
 * A separate ROUTE, following `cabinet/`, not a tab.
 *
 * `ExecutiveTabsClient` is a `?tab=` in-page switcher over a fixed key union;
 * `cabinet/`, `vice-president/` and `supreme-court/` all sit outside that strip.
 * Adding a tab here instead would mean a new key, an inline panel, and an entry
 * in that component's openable guard.
 */
export default async function IntelligencePage({ params }: PageProps) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();
  return <IntelligenceClient countryId={countryId} />;
}
