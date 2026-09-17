"use client";

import { useCallback, useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CommonsElectionDto,
  CommonsVacancyDto,
  CommonsVacancyStatus,
  RecallPetitionDto,
} from "@/lib/uk/elections/commonsVacancyStatus";

const VACANCY_REASON_LABELS: Record<string, string> = {
  death: "Death",
  retirement: "Retirement",
  defection: "Defection",
  resignation: "Resignation",
  recall: "Recall",
  removal: "Removal",
};

const VACANCY_STATUS_LABELS: Record<string, string> = {
  open: "Awaiting by-election",
  scheduled: "By-election scheduled",
  filled: "Filled",
  subsumed: "Subsumed by general election",
};

const PETITION_STATUS_LABELS: Record<string, string> = {
  watch: "Under watch",
  open: "Collecting signatures",
  check: "Support check",
  retained: "Retained",
  vacated: "Vacated",
  expired: "Expired",
};

function electionForVacancy(vacancy: CommonsVacancyDto, elections: CommonsElectionDto[]) {
  if (!vacancy.electionId) return null;
  return elections.find((e) => e.id === vacancy.electionId) ?? null;
}

async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { ok: res.ok, data, status: res.status };
}

function VacancyCard({
  vacancy,
  elections,
}: {
  vacancy: CommonsVacancyDto;
  elections: CommonsElectionDto[];
}) {
  const election = electionForVacancy(vacancy, elections);
  return (
    <li className="rounded-xl border border-card-border/60 bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {vacancy.constituency ?? vacancy.state} · {vacancy.seats} seat
          {vacancy.seats === 1 ? "" : "s"}
        </p>
        <span className="text-xs text-muted">
          {VACANCY_STATUS_LABELS[vacancy.status] ?? vacancy.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Vacated by {VACANCY_REASON_LABELS[vacancy.reason] ?? vacancy.reason} on turn{" "}
        {vacancy.vacatedTurn}
        {vacancy.priorCharacterName ? ` · formerly ${vacancy.priorCharacterName}` : ""}
        {vacancy.priorParty ? ` (${vacancy.priorParty})` : ""}
      </p>
      {election ? (
        <div className="mt-2 rounded-lg bg-background/60 px-3 py-2 text-xs">
          <p className="text-muted">
            {election.status === "active" || election.status === "upcoming"
              ? `By-election running, closes turn ${election.endTurn ?? "unknown"}`
              : election.status === "cancelled"
                ? "By-election cancelled, a new race will be scheduled"
                : `By-election ${election.status}, closed turn ${election.endTurn ?? "unknown"}`}
            {typeof election.carve === "number"
              ? ` · electorate ${(election.carve * 100).toFixed(1)}% of the region`
              : ""}
          </p>
          {election.candidates.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {election.candidates.map((c) => (
                <li key={c.id} className="text-foreground">
                  {c.characterName} · {c.party}
                  {election.status !== "active" &&
                  election.status !== "upcoming" &&
                  c.status === "active"
                    ? " · seated"
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">No candidates declared yet.</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          No by-election scheduled yet. One spawns automatically.
        </p>
      )}
    </li>
  );
}

function PetitionCard({
  petition,
  onAction,
  pending,
}: {
  petition: RecallPetitionDto;
  onAction: (petition: RecallPetitionDto, action: "sign" | "retain" | "remove") => void;
  pending: string | null;
}) {
  const busy = pending === petition.id;
  return (
    <li className="rounded-xl border border-card-border/60 bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {petition.targetCharacterName} · {petition.state}
        </p>
        <span className="text-xs text-muted">
          {PETITION_STATUS_LABELS[petition.status] ?? petition.status}
        </span>
      </div>
      {petition.status === "open" && (
        <p className="mt-1 text-xs text-muted">
          {petition.signatures} of {petition.signaturesRequired} signatures
          {petition.openedTurn != null ? ` · closes turn ${petition.openedTurn + 12}` : ""}
        </p>
      )}
      {petition.status === "check" && (
        <p className="mt-1 text-xs text-muted">
          Remove {petition.removeDeclarations} · Retain {petition.retainDeclarations}
          {petition.turnsRemaining != null ? ` · resolves in ${petition.turnsRemaining} turns` : ""}
        </p>
      )}
      {petition.status === "watch" && (
        <p className="mt-1 text-xs text-muted">
          Approval watch: a petition opens after sustained low approval or high infamy.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {petition.status === "open" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(petition, "sign")}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Signing" : "Sign recall petition"}
          </button>
        )}
        {petition.status === "check" && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(petition, "remove")}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Recording" : "Declare: remove"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(petition, "retain")}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {busy ? "Recording" : "Declare: retain"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function CommonsVacancyPanel({ countryId }: { countryId: CountryId }) {
  const [status, setStatus] = useState<CommonsVacancyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [defectParty, setDefectParty] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/uk/commons/vacancies", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setStatus((await res.json()) as CommonsVacancyStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vacancies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (countryId !== "UK") return;
    void load();
  }, [countryId, load]);

  if (countryId !== "UK") return null;

  async function refreshAfter(message: string) {
    setFeedback(message);
    await load();
  }

  async function handlePetitionAction(
    petition: RecallPetitionDto,
    action: "sign" | "retain" | "remove"
  ) {
    setPending(petition.id);
    setFeedback(null);
    try {
      const result =
        action === "sign"
          ? await postJson("/api/uk/commons/recall/sign", { petitionId: petition.id })
          : await postJson("/api/uk/commons/recall/declare", {
              petitionId: petition.id,
              side: action,
            });
      if (!result.ok) {
        setFeedback(
          typeof result.data.error === "string" ? result.data.error : "That action failed."
        );
      } else if (typeof result.data.message === "string") {
        await refreshAfter(result.data.message);
      } else {
        await refreshAfter("Done.");
      }
    } catch {
      setFeedback("That action failed. Retry.");
    } finally {
      setPending(null);
    }
  }

  async function handleResign() {
    setPending("resign");
    setFeedback(null);
    try {
      const result = await postJson("/api/uk/commons/resign", {});
      if (!result.ok) {
        setFeedback(
          typeof result.data.error === "string" ? result.data.error : "Resignation failed."
        );
      } else if (typeof result.data.message === "string") {
        await refreshAfter(result.data.message);
      } else {
        await refreshAfter("Resigned. A by-election will fill the seat.");
      }
    } catch {
      setFeedback("Resignation failed. Retry.");
    } finally {
      setPending(null);
    }
  }

  async function handleDefect() {
    const toParty = defectParty.trim();
    if (!toParty) {
      setFeedback("Enter a party to defect to.");
      return;
    }
    setPending("defect");
    setFeedback(null);
    try {
      const result = await postJson("/api/uk/commons/defect", { toParty });
      if (!result.ok) {
        setFeedback(
          typeof result.data.error === "string" ? result.data.error : "Defection failed."
        );
      } else if (typeof result.data.message === "string") {
        await refreshAfter(result.data.message);
      } else {
        await refreshAfter("Defected. Your former seat goes to by-election.");
      }
    } catch {
      setFeedback("Defection failed. Retry.");
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-label="Loading vacancies">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
        <p>Vacancies failed to load: {error}</p>
        <button type="button" onClick={() => void load()} className="mt-1 underline">
          Retry
        </button>
      </div>
    );
  }

  const holdsSeat = status?.viewer.officialId != null;
  const hasContent = (status?.vacancies.length ?? 0) + (status?.petitions.length ?? 0) > 0;

  return (
    <section aria-label="Commons vacancies and recall">
      <div role="status" aria-live="polite" className="sr-only">
        {feedback ?? ""}
      </div>
      {feedback && <p className="mb-3 text-sm text-foreground">{feedback}</p>}

      {holdsSeat && (
        <div className="mb-4 rounded-xl border border-card-border/60 bg-card px-4 py-3">
          <p className="text-sm font-medium text-foreground">Your seat · {status?.viewer.state}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending === "resign"}
              onClick={() => void handleResign()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending === "resign" ? "Resigning" : "Resign seat"}
            </button>
            <input
              type="text"
              value={defectParty}
              onChange={(e) => setDefectParty(e.target.value)}
              placeholder="New party"
              aria-label="Party to defect to"
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={pending === "defect"}
              onClick={() => void handleDefect()}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {pending === "defect" ? "Defecting" : "Defect"}
            </button>
          </div>
        </div>
      )}

      {!hasContent && (
        <p className="py-8 text-center text-sm text-muted">
          No open vacancies or recall petitions. Every Commons seat is filled.
        </p>
      )}

      {(status?.vacancies.length ?? 0) > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Open vacancies</h3>
          <ul className="mb-4 space-y-2">
            {status?.vacancies.map((v) => (
              <VacancyCard key={v.id} vacancy={v} elections={status?.elections ?? []} />
            ))}
          </ul>
        </>
      )}

      {(status?.petitions.length ?? 0) > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Recall petitions</h3>
          <ul className="space-y-2">
            {status?.petitions.map((p) => (
              <PetitionCard
                key={p.id}
                petition={p}
                onAction={(pet, act) => void handlePetitionAction(pet, act)}
                pending={pending}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
