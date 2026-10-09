"use client";

import { Suspense, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

import { LegislatureSkeleton } from "./LegislatureSkeleton";
import FederationDecisionPanel from "./FederationDecisionPanel";
import RussianConstitutionalDecisionPanel from "./RussianConstitutionalDecisionPanel";
import BulgarianConstitutionalDecisionPanel from "./BulgarianConstitutionalDecisionPanel";
import RomanianElectoralDecisionPanel from "./RomanianElectoralDecisionPanel";
import HungarianElectoralDecisionPanel from "./HungarianElectoralDecisionPanel";

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
  legislatureName?: string;
  generic?: boolean;
  hungarianElectoralDecisions?: boolean;
  romanianElectoralDecision?: boolean;
  bulgarianConstitutionalDecision?: boolean;
}

export default function LegislatureClient({
  countryId,
  legislatureName,
  generic,
  hungarianElectoralDecisions,
  romanianElectoralDecision,
  bulgarianConstitutionalDecision,
}: Props) {
  const t = useTranslations("worldConflicts.russianLegislature");
  const config = COUNTRY_CONFIGS[countryId];
  const displayedName = legislatureName ?? config.legislature.name;
  const PageComponent = LEGISLATURE_COMPONENTS[countryId];

  if (PageComponent && !generic) {
    return (
      <Suspense fallback={<LegislatureFallback name={displayedName} />}>
        <PageComponent countryId={countryId} />
      </Suspense>
    );
  }

  if (countryId === "RU" && generic) {
    return (
      <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <header className="space-y-3 rounded-xl border border-card-border bg-card p-5 sm:p-6">
            <p className="text-sm font-medium text-muted">{t("eyebrow")}</p>
            <h1 className="text-2xl font-bold">{displayedName}</h1>
            <p className="text-sm leading-relaxed text-muted">{t("overview")}</p>
            <p className="text-sm leading-relaxed text-muted">{t("eligibility")}</p>
          </header>
          <RussianConstitutionalDecisionPanel />
          <FederationDecisionPanel countryId={countryId} legislatureName={displayedName} embedded />
        </div>
      </main>
    );
  }

  if (countryId === "CS" || countryId === "YU") {
    return <FederationDecisionPanel countryId={countryId} legislatureName={displayedName} />;
  }

  if (countryId === "BG" && bulgarianConstitutionalDecision)
    return <BulgarianConstitutionalDecisionPanel />;

  if (countryId === "RO" && romanianElectoralDecision) return <RomanianElectoralDecisionPanel />;

  // Countries without a dedicated legislature component
  if (countryId === "HU" && hungarianElectoralDecisions)
    return (
      <div className="space-y-6">
        <HungarianElectoralDecisionPanel />
        <HungarianElectoralDecisionPanel kind="system2011" />
      </div>
    );
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <p data-coach="nav-legislature" className="text-2xl font-bold text-foreground">
          {displayedName}
        </p>
        <p className="mt-2 text-muted">{config.name} legislature coming soon.</p>
      </div>
    </div>
  );
}
