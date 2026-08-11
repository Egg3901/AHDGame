"use client";

import type { MetricCategoryId } from "@/lib/db/types";
import { TIER_COLORS, TIER_LABELS, TIER_ORDER } from "@/components/landing/countryTiers";
import { BLOC_COLORS, BLOC_LABELS, BLOC_ORDER } from "../worldBlocs";

/** Category display info */
const CATEGORY_INFO: Record<MetricCategoryId, { name: string; icon: string }> = {
  economic: { name: "Economic", icon: "💰" },
  education: { name: "Education", icon: "🎓" },
  healthcare: { name: "Healthcare", icon: "❤️" },
  infrastructure: { name: "Infrastructure", icon: "🏗️" },
  publicSafety: { name: "Public Safety", icon: "🛡️" },
  environment: { name: "Environment", icon: "🌿" },
  social: { name: "Social", icon: "👥" },
  governance: { name: "Governance", icon: "🏛️" },
  population: { name: "Population", icon: "📊" },
  mediaInformation: { name: "Media", icon: "📰" },
};

/** Short display names for metrics */
const METRIC_NAMES: Record<string, string> = {
  unemploymentRate: "Unemployment",
  medianIncome: "Median Income",
  gdpGrowth: "GDP Growth",
  povertyRate: "Poverty Rate",
  costOfLiving: "Cost of Living",
  smallBusinessFormation: "Small Biz Formation",
  highSchoolGradRate: "HS Graduation",
  testPerformance: "Test Performance",
  educationSpending: "Education Spending",
  literacyRate: "Literacy Rate",
  workforceSkill: "Workforce Skill",
  uninsuredRate: "Uninsured Rate",
  affordabilityIndex: "Affordability",
  physicianRate: "Physicians/Capita",
  lifeExpectancy: "Life Expectancy",
  preventableMortality: "Preventable Mortality",
  publicHealthPreparedness: "Health Preparedness",
  roadCondition: "Road Condition",
  broadbandAccess: "Broadband Access",
  publicTransit: "Public Transit",
  waterQuality: "Water Quality",
  powerGridReliability: "Power Grid",
  infrastructureInvestmentGap: "Infra Gap",
  crimeRate: "Crime Rate",
  violentCrimeRate: "Violent Crime",
  policePerCapita: "Police/Capita",
  incarcerationRate: "Incarceration",
  recidivismRate: "Recidivism",
  publicSafetyConfidence: "Safety Confidence",
  airQuality: "Air Quality",
  renewableEnergy: "Renewables",
  carbonEmissions: "Carbon Emissions",
  recyclingRate: "Recycling",
  climateResilience: "Climate Resilience",
  protectedLand: "Protected Land",
  socialMobility: "Social Mobility",
  incomeInequality: "Inequality",
  homelessnessRate: "Homelessness",
  foodInsecurity: "Food Insecurity",
  civicParticipation: "Civic Participation",
  socialCohesion: "Social Cohesion",
  governmentTransparency: "Transparency",
  budgetBalance: "Budget Balance",
  corruptionIndex: "Corruption",
  voterTurnout: "Voter Turnout",
  publicTrust: "Public Trust",
  populationGrowth: "Pop. Growth",
  urbanizationRate: "Urbanization",
  medianAge: "Median Age",
  migrationRate: "Migration Rate",
  mediaPolarization: "Polarization",
  disinformationRisk: "Disinfo Risk",
  pressFreedom: "Press Freedom",
  socialMediaSentiment: "Social Sentiment",
  newsTrust: "News Trust",
};

export type MetricFilter =
  | { type: "none" }
  | { type: "overall" }
  | { type: "category"; categoryId: MetricCategoryId }
  | { type: "metric"; categoryId: MetricCategoryId; metricId: string }
  | { type: "party" }
  | { type: "corps" }
  /** East / West / Non-Aligned. The default view — see `worldBlocs.ts`. */
  | { type: "blocs" };

interface GlobeMetricPanelProps {
  filter: MetricFilter;
  onFilterChange: (filter: MetricFilter) => void;
  availableCategories: MetricCategoryId[];
  availableMetrics: Record<string, string[]>;
  /**
   * Whether this world has blocs at all. Offered unconditionally, the tab
   * painted a 2019 map in TIER colours under a West/East/Non-Aligned legend —
   * a legend describing something that is not on the screen.
   */
  blocsAvailable: boolean;
}

export default function GlobeMetricPanel({
  filter,
  onFilterChange,
  availableCategories,
  availableMetrics,
  blocsAvailable,
}: GlobeMetricPanelProps) {
  const selectedCategory =
    filter.type === "category"
      ? filter.categoryId
      : filter.type === "metric"
        ? filter.categoryId
        : null;

  return (
    <div className="absolute bottom-4 left-4 right-4 z-10 pointer-events-none flex justify-center">
      <div className="pointer-events-auto max-w-3xl w-full bg-card/95 backdrop-blur-md rounded-xl border border-card-border shadow-lg overflow-hidden">
        {/* Top row: quick filters */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-card-border overflow-x-auto scrollbar-none">
          {blocsAvailable && (
            <FilterChip
              label="Blocs"
              active={filter.type === "blocs"}
              onClick={() => onFilterChange({ type: "blocs" })}
            />
          )}
          <FilterChip
            label="Tiers"
            active={filter.type === "none"}
            onClick={() => onFilterChange({ type: "none" })}
          />
          <FilterChip
            label="Overall"
            active={filter.type === "overall"}
            onClick={() => onFilterChange({ type: "overall" })}
          />
          <div className="w-px h-5 bg-card-border mx-1 shrink-0" />
          {availableCategories.map((cat) => {
            const info = CATEGORY_INFO[cat];
            return (
              <FilterChip
                key={cat}
                label={info?.name ?? cat}
                active={selectedCategory === cat}
                onClick={() => onFilterChange({ type: "category", categoryId: cat })}
              />
            );
          })}
          <div className="w-px h-5 bg-card-border mx-1 shrink-0" />
          <FilterChip
            label="Party"
            active={filter.type === "party"}
            onClick={() => onFilterChange({ type: "party" })}
          />
          <FilterChip
            label="Corps"
            active={filter.type === "corps"}
            onClick={() => onFilterChange({ type: "corps" })}
          />
        </div>

        {/* Legend for the two structural modes — the metric heatmaps carry their
            own meaning in the tooltip and don't need a key. */}
        {(filter.type === "blocs" || filter.type === "none") && (
          <div className="flex items-center gap-3 px-3 py-2 overflow-x-auto scrollbar-none">
            {(filter.type === "blocs"
              ? BLOC_ORDER.map((bloc) => ({
                  key: bloc,
                  label: BLOC_LABELS[bloc],
                  color: BLOC_COLORS[bloc],
                }))
              : TIER_ORDER.map((tier) => ({
                  key: tier,
                  label: TIER_LABELS[tier],
                  color: TIER_COLORS[tier],
                }))
            ).map((entry) => (
              <span key={entry.key} className="flex items-center gap-1.5 shrink-0">
                <span
                  className="w-2.5 h-2.5 rounded-sm border border-card-border"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-[10px] text-muted whitespace-nowrap">{entry.label}</span>
              </span>
            ))}
            {filter.type === "blocs" && (
              <span className="flex items-center gap-1.5 shrink-0">
                <span
                  className="w-2.5 h-2.5 rounded-sm border border-card-border"
                  style={{ backgroundColor: TIER_COLORS.background }}
                />
                <span className="text-[10px] text-muted whitespace-nowrap">
                  {TIER_LABELS.background}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Bottom row: metrics within selected category */}
        {selectedCategory && availableMetrics[selectedCategory] && (
          <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto scrollbar-none">
            <FilterChip
              label={`All ${CATEGORY_INFO[selectedCategory]?.name ?? selectedCategory}`}
              active={filter.type === "category"}
              onClick={() => onFilterChange({ type: "category", categoryId: selectedCategory })}
              small
            />
            <div className="w-px h-4 bg-card-border mx-0.5 shrink-0" />
            {availableMetrics[selectedCategory].map((metricId) => (
              <FilterChip
                key={metricId}
                label={METRIC_NAMES[metricId] ?? metricId}
                active={
                  filter.type === "metric" &&
                  filter.categoryId === selectedCategory &&
                  filter.metricId === metricId
                }
                onClick={() =>
                  onFilterChange({ type: "metric", categoryId: selectedCategory, metricId })
                }
                small
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  small,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-md font-medium transition-all whitespace-nowrap ${
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      } ${
        active
          ? "bg-primary/20 text-primary border border-primary/30"
          : "text-muted hover:text-foreground hover:bg-card-elevated border border-transparent"
      }`}
    >
      {label}
    </button>
  );
}
