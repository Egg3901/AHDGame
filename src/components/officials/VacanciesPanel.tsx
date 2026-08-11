"use client";

import { useState } from "react";
import AppointSenatorModal from "../governors/AppointSenatorModal";

interface SenateVacancy {
  state: string;
  senateClass: number;
}

interface VacanciesPanelProps {
  senateVacancies: SenateVacancy[];
  houseVacancies: Array<{ state: string; district?: number }>;
  governorVacancies: Array<{ state: string }>;
  isGovernor: boolean;
  governorState?: string;
}

export default function VacanciesPanel({
  senateVacancies,
  houseVacancies,
  governorVacancies,
  isGovernor,
  governorState,
}: VacanciesPanelProps) {
  const [appointModalOpen, setAppointModalOpen] = useState(false);
  const [selectedVacancy, setSelectedVacancy] = useState<SenateVacancy | null>(null);

  const handleAppointClick = (vacancy: SenateVacancy) => {
    setSelectedVacancy(vacancy);
    setAppointModalOpen(true);
  };

  const hasVacancies =
    senateVacancies.length > 0 || houseVacancies.length > 0 || governorVacancies.length > 0;

  if (!hasVacancies) {
    return null;
  }

  return (
    <>
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Current Vacancies</h2>

        {senateVacancies.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 font-medium text-foreground">US Senate</h3>
            <div className="space-y-2">
              {senateVacancies.map((vacancy, index) => {
                const canAppoint = isGovernor && governorState === vacancy.state;

                return (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg bg-card-elevated border border-card-border px-3 py-2"
                  >
                    <span className="text-sm text-foreground">
                      {vacancy.state}, Class {vacancy.senateClass}
                    </span>
                    {canAppoint && (
                      <button
                        onClick={() => handleAppointClick(vacancy)}
                        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-dark transition-colors"
                      >
                        Appoint Replacement
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {houseVacancies.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 font-medium text-foreground">US House</h3>
            <div className="space-y-2">
              {houseVacancies.map((vacancy, index) => (
                <div
                  key={index}
                  className="rounded-lg bg-card-elevated border border-card-border px-3 py-2 text-sm text-foreground"
                >
                  {vacancy.state}
                  {vacancy.district ? `-${vacancy.district}` : ""} (vacant)
                </div>
              ))}
            </div>
          </div>
        )}

        {governorVacancies.length > 0 && (
          <div>
            <h3 className="mb-2 font-medium text-foreground">Governors</h3>
            <div className="space-y-2">
              {governorVacancies.map((vacancy, index) => (
                <div
                  key={index}
                  className="rounded-lg bg-card-elevated border border-card-border px-3 py-2 text-sm text-foreground"
                >
                  {vacancy.state} (vacant)
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {appointModalOpen && selectedVacancy && (
        <AppointSenatorModal
          state={selectedVacancy.state}
          senateClass={selectedVacancy.senateClass}
          onClose={() => {
            setAppointModalOpen(false);
            setSelectedVacancy(null);
          }}
        />
      )}
    </>
  );
}
