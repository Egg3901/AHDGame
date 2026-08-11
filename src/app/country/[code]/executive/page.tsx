import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import { getDb } from "@/lib/mongodb";
import WhiteHouseClient from "@/app/whitehouse/WhiteHouseClient";
import { ParliamentaryExecutiveHub } from "./ParliamentaryExecutiveHub";
import { OnePartyExecutiveHub } from "./OnePartyExecutiveHub";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) return { title: "Executive Not Found | A House Divided" };
  // Runtime governmentType so a post-Stage-4 conversion shows the new
  // title ("White House" appearing after a country converts to presidential).
  const db = await getDb();
  const runtime = await getCountryState(db, id);
  const title =
    runtime.governmentType === "presidential"
      ? "White House"
      : `${config.executiveTitle} & Government`;
  return {
    title: `${title} | A House Divided`,
    description: `${config.name} executive leadership and cabinet.`,
  };
}

/**
 * Executive hub dispatch keyed on the RUNTIME government type (countryState),
 * not the country id or the static config, so a regime conversion flips the
 * page on the next load — matching what generateMetadata above already
 * promises ("White House" appearing after a country converts to
 * presidential):
 * - parliamentaryMonarchy / parliamentaryRepublic → ParliamentaryExecutiveHub
 *   (per-country copy from getParliamentaryExecutiveSurface)
 * - onePartyState → OnePartyExecutiveHub (per-country copy from
 *   getOnePartyExecutiveSurface)
 * - presidential → the White House surface, country-scoped (the US also keeps
 *   its /whitehouse alias)
 */
export default async function ExecutivePage({ params }: PageProps) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) notFound();

  const db = await getDb();
  const runtime = await getCountryState(db, countryId);

  if (
    runtime.governmentType === "parliamentaryMonarchy" ||
    runtime.governmentType === "parliamentaryRepublic"
  ) {
    return <ParliamentaryExecutiveHub countryId={countryId} />;
  }

  if (runtime.governmentType === "onePartyState") {
    return <OnePartyExecutiveHub countryId={countryId} />;
  }

  // presidential — the only remaining government type.
  return <WhiteHouseClient countryId={countryId} />;
}
