"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId, CountryStatus } from "@/lib/constants/countries";
import { useToast } from "@/contexts/ToastContext";
import { useRuntimeCountryConfig } from "@/hooks/useRuntimeCountryConfig";
import { CountryFlag } from "@/components/CountryFlag";

interface CountrySettings {
  enabledForPlayers: boolean;
  status: CountryStatus;
  economyPreview: boolean;
  stats: {
    currentTurn: number | null;
    currentYear: number | null;
    activePlayers: number;
    activeNpps: number;
    politicalParties: number;
  };
}

interface Props {
  countryId: CountryId;
}

const STATUS_LABELS: Record<CountryStatus, string> = {
  active: "Active",
  beta: "Beta",
  "coming-soon": "Coming Soon",
};

const STATUS_COLORS: Record<CountryStatus, string> = {
  active: "bg-success/15 text-success",
  beta: "bg-warning/15 text-warning",
  "coming-soon": "bg-muted/15 text-muted",
};

const ELECTION_SYSTEM_LABELS: Record<string, string> = {
  fptp: "First Past the Post",
  pr_hareQuota: "Proportional (Hare quota)",
  pr_sainteLague: "Proportional (Sainte-Laguë)",
  ams: "Additional Member System",
  electoralCollege: "Electoral College",
  parliamentary: "Parliamentary (confidence)",
  ceremonial: "Ceremonial / Appointed",
};

export default function CountryOverviewCard({ countryId }: Props) {
  const { showToast } = useToast();
  const config = COUNTRY_CONFIGS[countryId];
  // Runtime governmentType so the admin "Type" display reflects mid-game
  // mutations (Stage-4 conversion etc.). Falls back to seed while loading.
  const { config: runtime } = useRuntimeCountryConfig(countryId);
  const displayGovernmentType = runtime?.governmentType ?? config.governmentType;

  const [settings, setSettings] = useState<CountrySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [patching, setPatching] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const previousStatusRef = useRef<CountryStatus | null>(null);
  const closeConfirmModal = useCallback(() => setShowConfirmModal(false), []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/settings`);
      if (!res.ok) throw new Error("Failed to load");
      const data: CountrySettings = await res.json();
      setSettings(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleStatusChange = async (newStatus: CountryStatus) => {
    if (!settings) return;

    previousStatusRef.current = settings.status;
    setSettings((prev) => (prev ? { ...prev, status: newStatus } : prev));

    setPatching(true);
    try {
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to update status");
      }
    } catch (err) {
      // Revert optimistic update
      const prev = previousStatusRef.current;
      if (prev !== null) {
        setSettings((s) => (s ? { ...s, status: prev } : s));
      }
      showToast(err instanceof Error ? err.message : "Failed to update status", "error");
    } finally {
      setPatching(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!settings) return;
    setShowConfirmModal(false);

    const newEnabled = !settings.enabledForPlayers;
    setPatching(true);
    try {
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledForPlayers: newEnabled }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to update");
      }
      setSettings((prev) => (prev ? { ...prev, enabledForPlayers: newEnabled } : prev));
      showToast(
        newEnabled ? `${config.name} enabled for players` : `${config.name} disabled for players`,
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update", "error");
    } finally {
      setPatching(false);
    }
  };

  const handleToggleEconomyPreview = async () => {
    if (!settings) return;
    const newPreview = !settings.economyPreview;
    setPatching(true);
    try {
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ economyPreview: newPreview }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to update");
      }
      setSettings((prev) => (prev ? { ...prev, economyPreview: newPreview } : prev));
      showToast(
        newPreview
          ? `${config.name} economy preview enabled`
          : `${config.name} economy preview disabled`,
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update", "error");
    } finally {
      setPatching(false);
    }
  };

  const isToggleDisabled = loading || error || patching;

  return (
    <>
      {/* Header card */}
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <CountryFlag country={countryId} size="xl" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground truncate">{config.name}</h2>
              <p className="text-xs text-muted uppercase tracking-wider">{countryId}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Status dropdown */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider">
                Status
              </label>
              <select
                value={settings?.status ?? "coming-soon"}
                onChange={(e) => handleStatusChange(e.target.value as CountryStatus)}
                disabled={isToggleDisabled || !settings}
                className="rounded-lg border border-card-border bg-card-elevated px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                <option value="active">Active</option>
                <option value="beta">Beta</option>
                <option value="coming-soon">Coming Soon</option>
              </select>
            </div>

            {/* Enabled toggle */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider">
                Players Enabled
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={settings?.enabledForPlayers ?? false}
                onClick={() => setShowConfirmModal(true)}
                disabled={isToggleDisabled || !settings}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${
                  settings?.enabledForPlayers ? "bg-success" : "bg-muted/30"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    settings?.enabledForPlayers ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Economy Preview toggle — only relevant when players are disabled */}
            {settings && !settings.enabledForPlayers && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-muted uppercase tracking-wider">
                  Economy Preview
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.economyPreview}
                  onClick={handleToggleEconomyPreview}
                  disabled={isToggleDisabled}
                  title="Allow players to view economy pages (map, metrics, markets) without enabling political features"
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${
                    settings.economyPreview ? "bg-primary" : "bg-muted/30"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      settings.economyPreview ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Current status badge */}
            {settings && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-muted uppercase tracking-wider">
                  &nbsp;
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[settings.status]}`}
                >
                  {STATUS_LABELS[settings.status]}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-card-border bg-card p-4 animate-pulse"
              >
                <div className="h-3 w-20 rounded bg-muted/20 mb-2" />
                <div className="h-6 w-12 rounded bg-muted/20" />
              </div>
            ))}
          </>
        ) : error ? (
          <div className="col-span-2 sm:col-span-4 rounded-xl border border-card-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">Failed to load country data.</p>
              <button
                type="button"
                onClick={fetchSettings}
                className="text-xs font-medium text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            <StatCard
              label="Turn / Year"
              value={
                settings != null &&
                settings.stats.currentTurn !== null &&
                settings.stats.currentYear !== null
                  ? `T${settings.stats.currentTurn} / ${settings.stats.currentYear}`
                  : "—"
              }
            />
            <StatCard label="Players" value={settings?.stats.activePlayers ?? 0} />
            <StatCard label="NPPs" value={settings?.stats.activeNpps ?? 0} />
            <StatCard label="Parties" value={settings?.stats.politicalParties ?? 0} />
          </>
        )}
      </div>

      {/* Details row */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Government info */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Government</h3>
          <dl className="space-y-2">
            <DetailRow label="Type" value={displayGovernmentType} />
            <DetailRow label="Executive" value={config.executiveTitle} />
            <DetailRow
              label="Election System"
              value={
                config.electionSystems.lowerChamber
                  ? (ELECTION_SYSTEM_LABELS[config.electionSystems.lowerChamber] ??
                    config.electionSystems.lowerChamber)
                  : "—"
              }
            />
            <DetailRow label="Regions" value={config.regionLabelPlural} />
          </dl>
        </div>

        {/* Legislature info */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{config.legislature.name}</h3>
          <dl className="space-y-2">
            <DetailRow
              label={config.legislature.lowerChamber.name}
              value={`${config.legislature.lowerChamber.seats} seats`}
            />
            {config.legislature.upperChamber && (
              <DetailRow
                label={config.legislature.upperChamber.name}
                value={`${config.legislature.upperChamber.seats} seats`}
              />
            )}
          </dl>
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirmModal && settings && (
        <ConfirmModal
          countryName={config.name}
          enabling={!settings.enabledForPlayers}
          activePlayers={settings.stats.activePlayers}
          onConfirm={handleToggleEnabled}
          onCancel={closeConfirmModal}
        />
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className="text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted shrink-0">{label}</dt>
      <dd className="text-xs font-medium text-foreground text-right capitalize">{value}</dd>
    </div>
  );
}

function ConfirmModal({
  countryName,
  enabling,
  activePlayers,
  onConfirm,
  onCancel,
}: {
  countryName: string;
  enabling: boolean;
  activePlayers: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap: focus first button on mount, trap Tab within modal
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const focusableEls = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];

    firstEl?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl?.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="w-full max-w-sm rounded-xl border border-card-border bg-card p-6 shadow-xl"
        >
          <h3 id="confirm-title" className="mb-2 text-base font-semibold text-foreground">
            {enabling ? "Enable" : "Disable"} {countryName} for Players?
          </h3>
          <p className="mb-5 text-sm text-muted">
            {enabling ? (
              `This will make ${countryName} accessible to all players. Characters, NPPs, corporations, and all country data will become visible. Continue?`
            ) : (
              <>
                This will hide {countryName} from all non-admin players.{" "}
                <strong className="text-foreground">
                  {activePlayers} active player characters
                </strong>{" "}
                are currently in this country — they will be unable to access country pages or
                perform country-scoped actions until re-enabled. The country will continue
                processing turns internally but will be invisible on all public-facing pages.
                Continue?
              </>
            )}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-card-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                enabling ? "bg-success hover:bg-success/80" : "bg-danger hover:bg-danger/80"
              }`}
            >
              {enabling ? "Enable" : "Disable"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
