import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import SupremeCourtClient from "./SupremeCourtClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) return { title: "Supreme Court Not Found | A House Divided" };
  return {
    title: `Supreme Court | ${config.name} | A House Divided`,
    description: `${config.name} Supreme Court composition, nominations, and docket history.`,
  };
}

export default async function SupremeCourtPage({ params }: PageProps) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();
  return <SupremeCourtClient countryId={countryId} />;
}
