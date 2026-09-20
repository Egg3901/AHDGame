import type { LivingConflictStatus } from "@/lib/livingConflict/types";

export interface LivingConflictView {
  key: string;
  name: string;
  phase: string;
  status: LivingConflictStatus;
  participants: string[];
  nextPhases: string[];
  tracks: Array<{ key: string; label: string; value: number }>;
}

const trackLabel = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LivingConflictStrip({ conflicts }: { conflicts: LivingConflictView[] }) {
  if (conflicts.length === 0) return null;
  return (
    <section style={{ margin: "0 auto 18px", maxWidth: 1340 }} aria-label="Living crises">
      <div
        style={{
          marginBottom: 8,
          font: "600 9px 'IBM Plex Mono',monospace",
          letterSpacing: ".18em",
          color: "#9ca3af",
        }}
      >
        LIVING CRISES
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
                Participants: {conflict.participants.join(", ")}
              </div>
            ) : null}
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
                Possible next phases: {conflict.nextPhases.join(", ")}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function livingConflictTrackView(
  tracks: Record<string, number>
): LivingConflictView["tracks"] {
  return Object.entries(tracks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, label: trackLabel(key), value }));
}
