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
    title: `Political Parties | ${countryName} | A House Divided`,
    description: `Browse political parties and coalitions in ${countryName}'s political simulation. View ideology positions, membership, and party strength.`,
  };
}

export default function PartiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
