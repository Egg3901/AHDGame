"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { DemographicsManager } from "@/components/DemographicsManager";
import { Layer1PositionsToggle } from "@/components/positionEditor/Layer1PositionsToggle";
import { SubNavLayout } from "./SubNavLayout";

const NPPManagement = dynamic(
  () =>
    import("@/components/admin/politics/NPPManagement").then((m) => ({ default: m.NPPManagement })),
  { ssr: false }
);
const PoliticianPagesTab = dynamic(
  () =>
    import("@/components/admin/content/PoliticianPagesTab").then((m) => ({
      default: m.PoliticianPagesTab,
    })),
  { ssr: false }
);
const CrisesManager = dynamic(
  () =>
    import("@/components/admin/crises/CrisesManager").then((m) => ({
      default: m.CrisesManager,
    })),
  { ssr: false }
);
const GermanQuestionManager = dynamic(
  () =>
    import("@/components/admin/settlement/GermanQuestionManager").then((m) => ({
      default: m.GermanQuestionManager,
    })),
  { ssr: false }
);
const CountryManagement = dynamic(() => import("@/components/admin/countries/CountryManagement"), {
  ssr: false,
});
const ConflictsManager = dynamic(
  () =>
    import("@/components/admin/conflicts/ConflictsManager").then((m) => ({
      default: m.ConflictsManager,
    })),
  { ssr: false }
);
const RandomEventsManager = dynamic(
  () =>
    import("@/components/admin/events/RandomEventsManager").then((m) => ({
      default: m.RandomEventsManager,
    })),
  { ssr: false }
);

export type WorldSubTab =
  | "demographics"
  | "npps"
  | "politicians"
  | "crises"
  | "german-question"
  | "events"
  | "countries"
  | "conflicts";

interface AdminWorldTabProps {
  activeSub: WorldSubTab;
  onSubChange: (sub: WorldSubTab) => void;
}

export function AdminWorldTab({ activeSub, onSubChange }: AdminWorldTabProps) {
  return (
    <SubNavLayout tab="world" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        {activeSub === "demographics" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-serif text-lg text-foreground">Position Editor</h3>
                  <p className="mt-0.5 max-w-xl text-sm text-muted">
                    Author Layer-1 demographic positions, turnout, and archetype composition by
                    state, then apply them as global seed defaults. The toggle below gates whether a
                    reseed derives leans from this model.
                  </p>
                  <div className="mt-3">
                    <Layer1PositionsToggle />
                  </div>
                </div>
                <Link
                  href="/admin/position-editor"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  Open Position Editor →
                </Link>
              </div>
            </div>
            <DemographicsManager />
          </div>
        )}
        {activeSub === "npps" && <NPPManagement />}
        {activeSub === "politicians" && <PoliticianPagesTab />}
        {activeSub === "crises" && <CrisesManager />}
        {activeSub === "german-question" && <GermanQuestionManager />}
        {activeSub === "events" && <RandomEventsManager />}
        {activeSub === "countries" && <CountryManagement />}
        {activeSub === "conflicts" && <ConflictsManager />}
      </div>
    </SubNavLayout>
  );
}
