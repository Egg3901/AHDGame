"use client";

import { useState } from "react";
import { MilitaryFlagship } from "./military/MilitaryFlagship";
import { EstatesFlagship } from "./estates/EstatesFlagship";
import { EnergyFlagship } from "./energy/EnergyFlagship";
import { InfraFlagship } from "./infra/InfraFlagship";
import { MonetaryFlagship } from "./monetary/MonetaryFlagship";
import { FlagshipPlaceholder } from "./FlagshipPlaceholder";
import type {
  MilitaryUnitView,
  ForceSummaryView,
  EstateView,
  EstateSummaryView,
  PlantView,
  EnergySummaryView,
  ProjectView,
  InfraSummaryView,
  MonetaryView,
  ManpowerView,
  ArsenalView,
  DefenceContractView,
  DefenceSupplierView,
} from "../useCabinetOffice";
import type { CommanderRef } from "@/lib/military/types";

type ForceData = {
  units: MilitaryUnitView[];
  forceSummary: ForceSummaryView;
  commanders: CommanderRef[];
  manpower?: ManpowerView;
  arsenal?: ArsenalView;
  contracts?: DefenceContractView[];
  suppliers?: DefenceSupplierView[];
  lotPricePerLot?: number | null;
} | null;
type EstateData = {
  portfolioKey: string;
  estates: EstateView[];
  estateSummary: EstateSummaryView;
} | null;
type EnergyData = { plants: PlantView[]; energySummary: EnergySummaryView } | null;
type InfraData = { projects: ProjectView[]; infraSummary: InfraSummaryView } | null;
type MonetaryData = {
  monetary: MonetaryView;
  debtPrincipal: number;
  sovereignBondsOutstanding: number;
  sovereignBondProfile: Record<number, number> | null;
  currentTurn: number;
} | null;

/**
 * Selects the flagship body for a cabinet seat. Defense → Military; an energy seat
 * that is also an Estates seat → an `Estates | Generation` toggle; otherwise the
 * single applicable flagship, else the placeholder.
 */
export function FlagshipRouter({
  countryCode,
  countryId,
  positionId,
  canAct,
  currencySymbol,
  regions,
  targetCountries,
  onUpdate,
  liveYear = null,
  hasForce,
  force,
  estates,
  energy,
  infra,
  monetary,
  placeholderLabel = "Programs",
}: {
  countryCode: string;
  countryId: string;
  positionId: string;
  canAct: boolean;
  currencySymbol: string;
  regions: Array<{ id: string; name: string }>;
  targetCountries: Array<{ id: string; label: string }>;
  onUpdate: () => void;
  /** Live in-game year for era-gated military branches (null = modern catalog). */
  liveYear?: number | null;
  hasForce: boolean;
  force: ForceData;
  estates: EstateData;
  energy: EnergyData;
  infra: InfraData;
  monetary: MonetaryData;
  placeholderLabel?: string;
}) {
  const [dual, setDual] = useState<"estates" | "energy">("energy");

  if (hasForce && force) {
    return (
      <MilitaryFlagship
        countryCode={countryCode}
        countryId={countryId}
        positionId={positionId}
        units={force.units}
        forceSummary={force.forceSummary}
        commanders={force.commanders}
        manpower={force.manpower}
        arsenal={force.arsenal}
        contracts={force.contracts}
        suppliers={force.suppliers}
        lotPricePerLot={force.lotPricePerLot}
        canAct={canAct}
        currencySymbol={currencySymbol}
        onUpdate={onUpdate}
        liveYear={liveYear}
      />
    );
  }

  const energyBody = energy ? (
    <EnergyFlagship
      countryCode={countryCode}
      positionId={positionId}
      plants={energy.plants}
      energySummary={energy.energySummary}
      canAct={canAct}
      currencySymbol={currencySymbol}
      regions={regions}
      onUpdate={onUpdate}
    />
  ) : null;

  const estatesBody = estates ? (
    <EstatesFlagship
      countryCode={countryCode}
      positionId={positionId}
      portfolioKey={estates.portfolioKey}
      estates={estates.estates}
      estateSummary={estates.estateSummary}
      canAct={canAct}
      currencySymbol={currencySymbol}
      regions={regions}
      targetCountries={targetCountries}
      onUpdate={onUpdate}
    />
  ) : null;

  if (energyBody && estatesBody) {
    return (
      <div className="space-y-4">
        <div className="inline-flex rounded-lg border border-card-border bg-card p-0.5">
          {(["estates", "energy"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setDual(id)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                dual === id
                  ? "bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] text-gov-soft"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {id === "estates" ? "Estates" : "Generation"}
            </button>
          ))}
        </div>
        {dual === "estates" ? estatesBody : energyBody}
      </div>
    );
  }

  const infraBody = infra ? (
    <InfraFlagship
      countryCode={countryCode}
      positionId={positionId}
      projects={infra.projects}
      infraSummary={infra.infraSummary}
      canAct={canAct}
      currencySymbol={currencySymbol}
      regions={regions}
      onUpdate={onUpdate}
    />
  ) : null;

  const monetaryBody = monetary ? (
    <MonetaryFlagship
      countryCode={countryCode}
      positionId={positionId}
      canAct={canAct}
      currencySymbol={currencySymbol}
      currentTurn={monetary.currentTurn}
      monetary={monetary.monetary}
      debtPrincipal={monetary.debtPrincipal}
      sovereignBondsOutstanding={monetary.sovereignBondsOutstanding}
      sovereignBondProfile={monetary.sovereignBondProfile}
      onUpdate={onUpdate}
    />
  ) : null;

  return (
    energyBody ??
    estatesBody ??
    infraBody ??
    monetaryBody ?? <FlagshipPlaceholder label={placeholderLabel} />
  );
}
