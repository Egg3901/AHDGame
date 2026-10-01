"use client";
import React from "react";
import { useTranslations } from "next-intl";
import type { CandidateDetail, GeneralVotes } from "./ElectionDetailTypes";
export function RussianPresidentialResultPanel({
  candidates,
  tally,
}: {
  candidates: Pick<CandidateDetail, "id" | "characterName" | "partyName">[];
  tally: GeneralVotes;
}) {
  const t = useTranslations("elections.russianPresidential");
  const result = tally.russianPresidentialResult;
  const total = Object.values(tally.totalVotes).reduce((sum, votes) => sum + votes, 0);
  const winner =
    result?.outcome === "won" ? candidates.find((c) => c.id === result.winnerCandidateId) : null;
  return (
    <section className="rounded-lg border border-card-border p-4 space-y-3">
      <h2 className="font-semibold">{t("title")}</h2>
      <p>
        {winner
          ? t("winner", { name: winner.characterName })
          : t(
              result?.outcome === "runoff"
                ? "runoff"
                : result?.outcome === "repeat"
                  ? "repeat"
                  : "counting"
            )}
      </p>
      {result && (
        <p className="text-sm text-muted">
          {t("participation", {
            participants: result.participants,
            registered: result.registeredVoters,
          })}
        </p>
      )}
      <p className="text-sm text-muted">{t("rules")}</p>
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="flex justify-between gap-4">
            <span>
              {candidate.characterName} ({candidate.partyName})
            </span>
            <span>
              {t("votes", {
                votes: tally.totalVotes[candidate.id] ?? 0,
                share: total
                  ? (((tally.totalVotes[candidate.id] ?? 0) / total) * 100).toFixed(1)
                  : "0.0",
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
