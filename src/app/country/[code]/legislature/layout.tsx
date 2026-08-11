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
  const legislatureName = config?.legislature?.name ?? "Legislature";
  return {
    title: `${legislatureName} | ${countryName} | A House Divided`,
    description: `View the composition and members of ${countryName}'s ${legislatureName} in the political simulation. Track bills, leadership, and seat distribution.`,
  };
}

export default function LegislatureLayout({ children }: { children: React.ReactNode }) {
  return children;
}
