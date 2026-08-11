import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { UnionsClient } from "./UnionsClient";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) {
    return { title: "Unions | A House Divided" };
  }
  return publicPageMetadata({
    title: `Unions | ${config.name} | A House Divided`,
    description: `Labour unions in ${config.name}: leadership, membership, treasuries, and wage demands for every organized industry in A House Divided.`,
    pathname: `/country/${code}/unions`,
  });
}

export default function CountryUnionsPage() {
  return <UnionsClient />;
}
