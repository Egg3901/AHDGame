import Link from "next/link";
import { useTranslations } from "next-intl";
import type { LivingConflictView } from "@/lib/livingConflict/rules/publicView";

export function LivingConflictStrip({ conflicts }: { conflicts: LivingConflictView[] }) {
  const t = useTranslations("worldConflicts.livingCrises");
  if (conflicts.length === 0) return null;
  return (
    <section style={{ margin: "0 auto 18px", maxWidth: 1340 }} aria-label={t("title")}>
      <div
        style={{
          marginBottom: 8,
          font: "600 9px 'IBM Plex Mono',monospace",
          letterSpacing: ".18em",
          color: "#9ca3af",
        }}
      >
        {t("title")}
      </div>
      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
        }}
      >
        {conflicts.map((conflict) => (
          <article
            key={conflict.key}
            style={{ border: "1px solid rgba(156,163,175,.25)", borderRadius: 10, padding: 12 }}
          >
            <div style={{ fontWeight: 700 }}>{conflict.name}</div>
            <div style={{ color: "#9ca3af", fontSize: 12 }}>
              {conflict.phase} · {conflict.status.toUpperCase()}
            </div>
            {conflict.participants.length > 0 ? (
              <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 4 }}>
                {t("participants")}: {conflict.participants.join(", ")}
              </div>
            ) : null}
            <p style={{ fontSize: 12 }}>{conflict.summary}</p>
            {conflict.localActors.length > 0 && (
              <p>
                {t("localActors")}: {conflict.localActors.join(", ")}
              </p>
            )}
            {conflict.pressures.length > 0 && (
              <p>
                {t("pressure")}: {conflict.pressures.join(", ")}
              </p>
            )}
            {conflict.decisions.length > 0 && (
              <div>
                <strong>{t("decisions")}</strong>
                <ul>
                  {conflict.decisions.map((decision) => (
                    <li key={decision.id}>
                      <Link href={`/world/crises/${decision.id}`}>{decision.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {conflict.commitments.length > 0 && (
              <div>
                <strong>{t("commitments")}</strong>
                <ul>
                  {conflict.commitments.map((commitment, index) => (
                    <li key={index}>
                      {commitment.country}: {commitment.choice}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {conflict.tracks.length > 0 ? (
              <dl style={{ display: "grid", gap: 4, margin: "10px 0 0" }}>
                {conflict.tracks.map((track) => (
                  <div key={track.key} style={{ display: "flex", justifyContent: "space-between" }}>
                    <dt>{track.label}</dt>
                    <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{track.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {conflict.nextPhases.length > 0 ? (
              <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 8 }}>
                {t("nextPhases")}: {conflict.nextPhases.join(", ")}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
