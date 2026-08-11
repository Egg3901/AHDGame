import { notFound, redirect } from "next/navigation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string; positionId: string }>;
}

export default async function CabinetOfficeRedirectPage({ params }: PageProps) {
  const { code, positionId } = await params;
  const countryId = code.toUpperCase() as CountryId;

  if (!COUNTRY_CONFIGS[countryId]) notFound();
  const position = getCabinetPositions(countryId).find((candidate) => candidate.id === positionId);
  if (!position) notFound();

  redirect(`/country/${code}/executive/cabinet/${positionId}/office`);
}
