import { notFound } from "next/navigation";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { fetchPoliticians } from "./fetchPoliticians";
import PoliticiansClient from "./PoliticiansClient";

// Revalidate every 2 minutes, matching the API cache header.
export const revalidate = 120;

interface Props {
  params: Promise<{ code: string }>;
}

export default async function PoliticiansPage({ params }: Props) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;

  if (!COUNTRY_CONFIGS[countryId]) notFound();

  const { politicians, playerCount, nppCount } = await fetchPoliticians(countryId);
  const countryName = getCountryConfig(countryId).name;

  return (
    <>
      <section
        className="border-b border-card-border/60 bg-card/20"
        aria-label="About this directory"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-8 pb-4">
          <p className="text-sm text-muted leading-relaxed max-w-3xl">
            This directory lists player characters and non-player politicians (NPPs) active in{" "}
            {countryName}. Use filters to narrow by office, party, or name. Profiles link to live
            game data—favorability, funds, and current office update as the simulation runs.
          </p>
        </div>
      </section>
      <PoliticiansClient
        initialPoliticians={politicians}
        initialStats={{ playerCount, nppCount }}
      />
    </>
  );
}
