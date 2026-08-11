"use client";

import { Suspense, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

import { LegislatureSkeleton } from "./LegislatureSkeleton";

const LegislatureFallback = (_props: { name?: string }) => <LegislatureSkeleton />;

const USCongressPage = dynamic(
  () => import("@/app/congress/CongressClient").then((m) => ({ default: m.USCongressPage })),
  { ssr: false }
);
const UKParliamentPage = dynamic(
  () => import("./UKParliamentPage").then((m) => ({ default: m.UKParliamentPage })),
  { ssr: false }
);
const DEBundestagPage = dynamic(
  () => import("./DEBundestagPage").then((m) => ({ default: m.DEBundestagPage })),
  { ssr: false }
);
const JPDietPage = dynamic(() => import("./JPDietPage").then((m) => ({ default: m.JPDietPage })), {
  ssr: false,
});
const IEOireachtasPage = dynamic(
  () => import("./IEOireachtasPage").then((m) => ({ default: m.IEOireachtasPage })),
  { ssr: false }
);
const CNNpcPage = dynamic(() => import("./CNNpcPage").then((m) => ({ default: m.CNNpcPage })), {
  ssr: false,
});
const RUSupremeSovietPage = dynamic(
  () => import("./RUSupremeSovietPage").then((m) => ({ default: m.RUSupremeSovietPage })),
  { ssr: false }
);
const DevolvedParliamentPage = dynamic(
  () => import("./DevolvedParliamentPage").then((m) => ({ default: m.DevolvedParliamentPage })),
  { ssr: false }
);
const DDVolkskammerPage = dynamic(
  () => import("./DDVolkskammerPage").then((m) => ({ default: m.DDVolkskammerPage })),
  { ssr: false }
);
const NGAssemblyPage = dynamic(
  () => import("./NGAssemblyPage").then((m) => ({ default: m.NGAssemblyPage })),
  { ssr: false }
);

/** Registry of legislature page components keyed by country ID. */
const LEGISLATURE_COMPONENTS: Partial<Record<CountryId, ComponentType<{ countryId: CountryId }>>> =
  {
    US: USCongressPage,
    UK: UKParliamentPage,
    DE: DEBundestagPage,
    JP: JPDietPage,
    IE: IEOireachtasPage,
    CN: CNNpcPage,
    RU: RUSupremeSovietPage,
    DD: DDVolkskammerPage,
    NG: NGAssemblyPage,
    SCO: DevolvedParliamentPage,
    WAL: DevolvedParliamentPage,
  };

interface Props {
  countryId: CountryId;
}

export default function LegislatureClient({ countryId }: Props) {
  const config = COUNTRY_CONFIGS[countryId];
  const PageComponent = LEGISLATURE_COMPONENTS[countryId];

  if (PageComponent) {
    return (
      <Suspense fallback={<LegislatureFallback name={config.legislature.name} />}>
        <PageComponent countryId={countryId} />
      </Suspense>
    );
  }

  // Countries without a dedicated legislature component
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <p data-coach="nav-legislature" className="text-2xl font-bold text-foreground">
          {config.legislature.name}
        </p>
        <p className="mt-2 text-muted">{config.name} legislature coming soon.</p>
      </div>
    </div>
  );
}
