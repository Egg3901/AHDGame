import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { NationalBudgetClient } from "./NationalBudgetClient";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) {
    return { title: "National Budget | A House Divided" };
  }
  return publicPageMetadata({
    title: `National Budget | ${config.name} | A House Divided`,
    description: `National revenue, spending, and fiscal indicators for ${config.name} in A House Divided, updated as the hourly simulation advances.`,
    pathname: `/country/${code}/budget`,
  });
}

export default function NationalBudgetPage() {
  return <NationalBudgetClient />;
}
