"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Vacancy {
  receiptId: string;
  slotPersonId: string;
  partyId: string;
  tier: "territorial" | "national";
  districtId: string;
  candidates: Array<{ personId: string; name: string; isNpc: boolean; listPosition?: number }>;
}
export function HuListVacanciesCard({
  partyId,
  onUpdate,
}: {
  partyId: string;
  onUpdate: () => void;
}) {
  const t = useTranslations("elections.huListVacancies");
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch("/api/country/hu/assembly/list-vacancies", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(t("error"));
      const data = await response.json();
      return (data.vacancies as Vacancy[]).filter((row) => row.partyId === partyId);
    },
    [partyId, t]
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal)
      .then(setVacancies)
      .catch((error) => {
        if (!controller.signal.aborted)
          setMessage(error instanceof Error ? error.message : t("error"));
      });
    return () => controller.abort();
  }, [refresh, t]);
  async function designate(vacancy: Vacancy) {
    const personId = choices[vacancy.slotPersonId];
    if (!personId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/country/hu/assembly/list-vacancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: vacancy.receiptId,
          slotPersonId: vacancy.slotPersonId,
          personId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("error"));
      setVacancies(await refresh());
      setMessage(t("success"));
      onUpdate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-2 text-sm text-muted">{t("description")}</p>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
      {!vacancies ? (
        <p>{t("loading")}</p>
      ) : !vacancies.length ? (
        <p>{t("empty")}</p>
      ) : (
        vacancies.map((vacancy) => (
          <div key={vacancy.slotPersonId} className="mt-4 space-y-2">
            <label htmlFor={`hu-list-${vacancy.slotPersonId}`} className="block text-sm">
              {t("seat", { tier: t(vacancy.tier), district: vacancy.districtId })}
            </label>
            {!vacancy.candidates.length ? (
              <p>{t("exhausted")}</p>
            ) : (
              <>
                <select
                  id={`hu-list-${vacancy.slotPersonId}`}
                  value={choices[vacancy.slotPersonId] ?? ""}
                  onChange={(event) =>
                    setChoices((old) => ({ ...old, [vacancy.slotPersonId]: event.target.value }))
                  }
                  disabled={busy}
                  className="rounded border border-card-border bg-card p-2"
                >
                  <option value="">{t("choose")}</option>
                  {vacancy.candidates.map((candidate) => (
                    <option key={candidate.personId} value={candidate.personId}>
                      {candidate.listPosition
                        ? t("nominee", { name: candidate.name, position: candidate.listPosition })
                        : candidate.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !choices[vacancy.slotPersonId]}
                  onClick={() => void designate(vacancy)}
                  className="ml-2 rounded border border-card-border px-3 py-2 disabled:opacity-50"
                >
                  {t("designate")}
                </button>
              </>
            )}
          </div>
        ))
      )}
    </section>
  );
}
