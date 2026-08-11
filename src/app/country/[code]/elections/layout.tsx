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
    title: `Elections | ${countryName} | A House Divided`,
    description: `View all active and upcoming elections in ${countryName}'s political simulation. Track primary results, general elections, and legislative races.`,
  };
}

export default function ElectionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
