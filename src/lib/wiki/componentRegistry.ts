/**
 * Registry for custom wiki markdown components.
 * Add new components here to keep MarkdownContent decoupled and scalable.
 *
 * Widgets may accept an optional `data` prop — the trimmed body of the code
 * fence. Parameterless widgets ignore it; parameterised widgets (e.g.
 * commodity-distribution) parse it to pick which commodity to render.
 */
import type { ComponentType } from "react";
import { TurnProcessingFlowchart } from "@/components/wiki/TurnProcessingFlowchart";
import { FavorabilityDecayDiagram } from "@/components/wiki/FavorabilityDecayDiagram";
import { SenateClassesDiagram } from "@/components/wiki/SenateClassesDiagram";
import { ClearingPostureDiagram } from "@/components/wiki/ClearingPostureDiagram";
import { CapitalLoopDiagram } from "@/components/wiki/CapitalLoopDiagram";
import { CongressSnapshot } from "@/components/wiki/widgets/CongressSnapshot";
import { CommodityDistribution } from "@/components/wiki/widgets/CommodityDistribution";
import { CountryHistory } from "@/components/wiki/widgets/CountryHistory";
import { VoteShareCalculator } from "@/components/wiki/calculators/VoteShareCalculator";
import { SectorSeedMap } from "@/components/wiki/widgets/SectorSeedMap";
import { StartingStateDashboard } from "@/components/wiki/widgets/StartingStateDashboard";
import { CabinetGuide } from "@/components/wiki/widgets/CabinetGuide";
import { WikiGuideScreenshot } from "@/components/wiki/WikiGuideScreenshot";

export interface WikiWidgetProps {
  data?: string;
}

export const WIKI_COMPONENT_REGISTRY: Record<string, ComponentType<WikiWidgetProps>> = {
  "flowchart-turn": TurnProcessingFlowchart,
  "favorability-decay": FavorabilityDecayDiagram,
  "senate-classes": SenateClassesDiagram,
  "clearing-posture": ClearingPostureDiagram,
  "capital-loop": CapitalLoopDiagram,
  "congress-snapshot": CongressSnapshot,
  "commodity-distribution": CommodityDistribution,
  "country-history": CountryHistory,
  "vote-share-calculator": VoteShareCalculator,
  "sector-seed-map": SectorSeedMap,
  "starting-state-dashboard": StartingStateDashboard,
  "cabinet-guide": CabinetGuide,
  "guide-screenshot": WikiGuideScreenshot,
};

export function getWikiComponent(lang: string): ComponentType<WikiWidgetProps> | null {
  return WIKI_COMPONENT_REGISTRY[lang] ?? null;
}
