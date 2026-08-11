import { getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import CountryMapClient from "./CountryMapClient";

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const gameState = await getGameState();
  const name = getCountryDisplayName(countryId, gameState?.preset);

  return {
    title: `${name} Map | A House Divided`,
    description: `Interactive electoral map of ${name}`,
  };
}

export default async function CountryMapPage({ params }: Props) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  return <CountryMapClient countryId={countryId} />;
}
