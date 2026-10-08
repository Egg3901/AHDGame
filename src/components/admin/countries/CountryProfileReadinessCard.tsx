import type {
  CountryBackgroundMode,
  CountryContentStatus,
  CountryRequirementLevel,
} from "@/lib/world/countryRequirementLevel";

interface ReadinessBlocker {
  capabilityId: string;
  label: string;
  evidence: string;
}

interface ReadinessProfileRow {
  level: CountryRequirementLevel;
  label: "Background" | "Economy Preview" | "Player Enabled";
  status: "ready" | "not-ready";
  blockers: ReadinessBlocker[];
}

export interface CountryProfileReadiness {
  presetId: string;
  source: "reset-preset";
  activeLevel: CountryRequirementLevel;
  presetLevel: CountryRequirementLevel;
  backgroundMode: CountryBackgroundMode | null;
  contentStatus: CountryContentStatus | "not-assessed";
  contentGaps: ReadinessBlocker[];
  profiles: ReadinessProfileRow[];
}

const MODE_LABELS: Record<CountryBackgroundMode, string> = {
  npp: "NPP registered",
  latent: "Latent and seeded",
  absent: "Absent from this era",
};

function presetLabel(presetId: string): string {
  const year = presetId.match(/^\d{4}/)?.[0];
  return year ? `${year} reset profile` : presetId;
}

export function CountryProfileReadinessCard({ readiness }: { readiness: CountryProfileReadiness }) {
  return (
    <section
      className="rounded-xl border border-card-border bg-card p-5"
      aria-labelledby="readiness-title"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="readiness-title" className="text-sm font-semibold text-foreground">
            Readiness
          </h3>
          <p className="mt-1 text-xs text-muted">
            Evaluated against the latest reset preset. The current in-game year does not change the
            authored era profile.
          </p>
        </div>
        <span className="rounded-full border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted">
          {presetLabel(readiness.presetId)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {readiness.profiles.map((profile) => {
          const ready = profile.status === "ready";
          const isActive = profile.level === readiness.activeLevel;
          const isPreset = profile.level === readiness.presetLevel;
          return (
            <div
              key={profile.level}
              className={`rounded-lg border p-3 ${
                ready ? "border-success/25 bg-success/5" : "border-danger/30 bg-danger/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted">{profile.label}</p>
                  <p
                    className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${
                      ready ? "text-success" : "text-danger"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${ready ? "bg-success" : "bg-danger"}`}
                    />
                    {ready ? "Ready" : "Not ready"}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {isActive && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Current
                    </span>
                  )}
                  {isPreset && readiness.presetLevel !== readiness.activeLevel && (
                    <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      Preset
                    </span>
                  )}
                </div>
              </div>

              {profile.level === "background" && readiness.backgroundMode && (
                <p className="mt-2 text-xs text-muted">
                  Preset mode: {MODE_LABELS[readiness.backgroundMode]}
                </p>
              )}

              {!ready && profile.blockers.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium text-danger">
                    {profile.blockers.length}{" "}
                    {profile.blockers.length === 1 ? "blocker" : "blockers"}
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {profile.blockers.map((blocker) => (
                      <li key={blocker.capabilityId} className="rounded-md bg-card-elevated p-2">
                        <p className="font-medium text-foreground">{blocker.label}</p>
                        <p className="mt-0.5 text-muted">{blocker.evidence}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg border border-card-border/70 bg-card-elevated p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-foreground">Content and era fidelity</span>
          <span
            className={
              readiness.contentStatus === "complete"
                ? "text-success"
                : readiness.contentStatus === "gaps"
                  ? "text-warning"
                  : "text-muted"
            }
          >
            {readiness.contentStatus === "complete"
              ? "Complete"
              : readiness.contentStatus === "gaps"
                ? `${readiness.contentGaps.length} tracked ${readiness.contentGaps.length === 1 ? "gap" : "gaps"}`
                : "Not assessed"}
          </span>
        </div>
        {readiness.contentGaps.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-muted">Show content gaps</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {readiness.contentGaps.map((gap) => (
                <li key={gap.capabilityId}>
                  <span className="font-medium text-foreground">{gap.label}:</span> {gap.evidence}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
