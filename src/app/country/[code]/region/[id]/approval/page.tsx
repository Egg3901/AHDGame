import { notFound } from "next/navigation";
import { canonicalRegionId, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { RegionApprovalClient } from "@/components/approval/RegionApprovalClient";

interface PageProps {
  params: Promise<{ code: string; id: string }>;
}

export default async function RegionApprovalPage({ params }: PageProps) {
  const { code, id: rawRegionParam } = await params;
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const countryId = code.toUpperCase() as CountryId;

  if (!COUNTRY_CONFIGS[countryId]) notFound();

  return <RegionApprovalClient countryId={countryId} stateId={id.toUpperCase()} />;
}
