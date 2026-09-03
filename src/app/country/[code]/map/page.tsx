import { type CountryId } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import { getDb } from "@/lib/mongodb";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";
import CountryMapClient from "./CountryMapClient";

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const gameState = await getGameState();
  const { name } = await resolveCountryIdentity(await getDb(), countryId, gameState?.preset);

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
