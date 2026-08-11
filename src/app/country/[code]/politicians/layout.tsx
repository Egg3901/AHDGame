import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface Props {
  params: Promise<{ code: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const config = COUNTRY_CONFIGS[code.toUpperCase() as CountryId];
  const countryName = config?.name ?? "Unknown Country";
  return {
    title: `Politicians | ${countryName} | A House Divided`,
    description: `Browse all politicians in ${countryName}'s political simulation. View party affiliations, elected officials, and favorability ratings.`,
  };
}

export default function PoliticiansLayout({ children }: { children: React.ReactNode }) {
  return children;
}
