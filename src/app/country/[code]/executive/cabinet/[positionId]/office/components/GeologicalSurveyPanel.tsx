"use client";

import { useState } from "react";
import { CommissionSurveyModal } from "@/components/extraction/CommissionSurveyModal";
import { ProspectingSurveyList } from "@/components/extraction/ProspectingSurveyList";
import { useProspectingSurveys } from "@/hooks/useProspectingSurveys";
import { useGameTurnStatus } from "@/hooks/useGameEvents";

interface GeologicalSurveyPanelProps {
  countryId: string;
  canAct: boolean;
  stateOptions: { id: string; name: string }[];
}

/**
 * National geological survey funding — Treasury-tab action for the finance
 * minister (or, on the presidential executive surface, the head of state).
 * POST /api/prospecting/government {countryId, stateId, resource, level:"national"}.
 * Rendered only when gameConfig.prospectingEnabled (caller gates mounting).
 */
export function GeologicalSurveyPanel({
  countryId,
  canAct,
  stateOptions,
}: GeologicalSurveyPanelProps) {
  const [showModal, setShowModal] = useState(false);
  const gameTurn = useGameTurnStatus();
  const { surveys, loading, refresh } = useProspectingSurveys({ countryId });

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Geological Surveys</h2>
        {canAct && stateOptions.length > 0 && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition-colors"
          >
            Fund Geological Survey
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        Fund a state survey crew from the federal treasury to search for new extraction capacity
        anywhere in the country.
      </p>

      <ProspectingSurveyList
        surveys={surveys}
        currentTurn={gameTurn?.currentTurn ?? 0}
        loading={loading}
      />

      {canAct && showModal && (
        <CommissionSurveyModal
          level="national"
          countryId={countryId}
          stateOptions={stateOptions}
          onClose={() => setShowModal(false)}
          onLaunched={() => {
            setShowModal(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}
