import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import LegislatureClient from "./LegislatureClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) return { title: "Legislature Not Found | A House Divided" };
  return {
    title: `${config.legislature.name} | A House Divided`,
    description: `${config.name} ${config.legislature.name} — ${config.legislature.lowerChamber.seats} ${config.regionLabelPlural}`,
  };
}

export default async function LegislaturePage({ params }: PageProps) {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[id]) notFound();
  return <LegislatureClient countryId={id} />;
}
