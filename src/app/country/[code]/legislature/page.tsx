import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getLiveLowerChamberSeats } from "@/lib/turn/lowerChamberSeats";
import { bgAssemblyName } from "@/lib/countries/bg/rules/assemblyTransition";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import LegislatureClient from "./LegislatureClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

async function bgLegislaturePresentation(): Promise<{ name: string; seats: number }> {
  const db = await getDb();
  const [preset, country, seats] = await Promise.all([
    getGameStatePreset(db),
    db
      .collection<{ _id: string; bgOrdinaryAssemblySinceTurn?: number }>("countryGameStates")
      .findOne({ _id: "BG" }, { projection: { bgOrdinaryAssemblySinceTurn: 1 } }),
    getLiveLowerChamberSeats(db, "BG"),
  ]);
  return { name: bgAssemblyName(preset, country?.bgOrdinaryAssemblySinceTurn), seats };
}

async function ruLegislaturePresentation(): Promise<{
  name: string;
  seats: number;
  generic: boolean;
}> {
  const db = await getDb();
  const [preset, country] = await Promise.all([
    getGameStatePreset(db),
    db
      .collection<{
        _id: string;
        ruSovietSuccessionSinceTurn?: number;
        ruProvisionalCongressSeats?: number;
        ruPresidencySinceTurn?: number;
        ruCongressDissolvedSinceTurn?: number;
        ruFederalAssemblySinceTurn?: number;
      }>("countryGameStates")
      .findOne({ _id: "RU" }),
  ]);
  const config = getCountryConfigForRuntime("RU", preset, country);
  const generic = preset === "1991-default";
  const seats = generic
    ? await getLiveLowerChamberSeats(db, "RU")
    : config.legislature.lowerChamber.seats;
  return { name: config.legislature.name, seats, generic };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) return { title: "Legislature Not Found | A House Divided" };
  if (id === "BG") {
    const { name, seats } = await bgLegislaturePresentation();
    return {
      title: `${name} | A House Divided`,
      description: `Bulgaria ${name}, ${seats} deputies`,
    };
  }
  if (id === "RU") {
    const { name, seats } = await ruLegislaturePresentation();
    return {
      title: `${name} | A House Divided`,
      description: `Russia ${name}, ${seats} lower-chamber seats`,
    };
  }
  return {
    title: `${config.legislature.name} | A House Divided`,
    description: `${config.name} ${config.legislature.name} — ${config.legislature.lowerChamber.seats} ${config.regionLabelPlural}`,
  };
}

export default async function LegislaturePage({ params }: PageProps) {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[id]) notFound();
  const bgName = id === "BG" ? (await bgLegislaturePresentation()).name : undefined;
  const ru = id === "RU" ? await ruLegislaturePresentation() : undefined;
  const hungarianElectoralDecisions =
    id === "HU" && (await getGameStatePreset(await getDb())) === "1991-default";
  return (
    <LegislatureClient
      countryId={id}
      legislatureName={ru?.name ?? bgName}
      generic={ru?.generic}
      hungarianElectoralDecisions={hungarianElectoralDecisions}
      romanianElectoralDecision={
        id === "RO" && (await getGameStatePreset(await getDb())) === "1991-default"
      }
    />
  );
}
