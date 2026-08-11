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
    title: `Electoral Map | ${countryName} | A House Divided`,
    description: `View the electoral map and regional approval ratings for ${countryName} in the political simulation.`,
  };
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
