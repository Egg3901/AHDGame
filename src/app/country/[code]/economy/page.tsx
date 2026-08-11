import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { EconomyOutlookClient } from "./EconomyOutlookClient";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) {
    return { title: "Economic Outlook | A House Divided" };
  }
  return publicPageMetadata({
    title: `Economic Outlook | ${config.name} | A House Divided`,
    description: `GDP, growth, inflation, prime rate, credit standing, and the national sector mix for ${config.name} in A House Divided, updated as the hourly simulation advances.`,
    pathname: `/country/${code}/economy`,
  });
}

export default function EconomicOutlookPage() {
  return <EconomyOutlookClient />;
}
