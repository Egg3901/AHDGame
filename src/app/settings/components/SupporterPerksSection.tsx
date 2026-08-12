"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Translator = ReturnType<typeof useTranslations<"settings">>;

interface RequestRow {
  _id: string;
  kind: "wall-name" | "npp-rename";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  proposedName: string | null;
  currentNppName: string | null;
  proposedNppName: string | null;
}

interface PerksState {
  tier: "supporter" | "supporter-plus" | "supporter-plus-plus" | null;
  isPatronActive: boolean;
  supporterWallName: string | null;
  canSubmitWallName: boolean;
  canSubmitNppRename: boolean;
  nppRenameUsed: boolean;
  requests: RequestRow[];
}

interface NppSearchResult {
  id: string;
  sequentialId: number | null;
  name: string;
  party: string;
  countryId: string | null;
  office: string | null;
}

const CARD_CLASS =
  "relative overflow-hidden rounded-3xl border border-card-border/80 bg-gradient-to-br from-card via-card to-card-elevated/55 p-5 shadow-sm";

function tierLabel(tier: PerksState["tier"], t: Translator): string {
  if (tier === "supporter-plus-plus") return "Supporter++";
  if (tier === "supporter-plus") return "Supporter+";
  if (tier === "supporter") return "Supporter";
  return t("supporterPerks.notSubscribed");
}

function statusBadge(status: RequestRow["status"], t: Translator) {
  const cls =
    status === "approved"
      ? "bg-green-500/15 text-green-500"
      : status === "rejected"
        ? "bg-red-500/15 text-red-500"
        : "bg-amber-500/15 text-amber-500";
  const label =
    status === "approved"
      ? t("supporterPerks.statusApproved")
      : status === "rejected"
        ? t("supporterPerks.statusRejected")
        : t("supporterPerks.statusPending");
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function SupporterPerksSection() {
  const t = useTranslations("settings");
  const [state, setState] = useState<PerksState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [wallName, setWallName] = useState("");
  const [submittingWall, setSubmittingWall] = useState(false);

  const [nppQuery, setNppQuery] = useState("");
  const [nppResults, setNppResults] = useState<NppSearchResult[]>([]);
  const [selectedNpp, setSelectedNpp] = useState<NppSearchResult | null>(null);
  const [proposedNppName, setProposedNppName] = useState("");
  const [submittingRename, setSubmittingRename] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/supporter-requests");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("supporterPerks.loadFailed"));
        return;
      }
      setState(data);
    } catch {
      setError(t("supporterPerks.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Debounced NPP search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = nppQuery.trim();
    if (q.length < 2) {
      setNppResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/settings/supporter-requests/npp-search?q=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        if (res.ok) setNppResults(data.results ?? []);
      } catch {
        // Search errors are non-fatal; keep old results.
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [nppQuery]);

  async function submitRequest(body: Record<string, unknown>, done: (v: boolean) => void) {
    setError("");
    setMessage("");
    done(true);
    try {
      const res = await fetch("/api/settings/supporter-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("supporterPerks.submitFailed"));
        return;
      }
      setMessage(t("supporterPerks.submitted"));
      setWallName("");
      setProposedNppName("");
      setSelectedNpp(null);
      setNppQuery("");
      await load();
    } catch {
      setError(t("supporterPerks.submitFailed"));
    } finally {
      done(false);
    }
  }

  if (loading) {
    return <div className="text-muted">{t("supporterPerks.loading")}</div>;
  }

  if (!state) {
    return <div className="text-sm text-red-500">{error || t("supporterPerks.loadFailed")}</div>;
  }

  const pendingWall = state.requests.find((r) => r.kind === "wall-name" && r.status === "pending");
  const pendingRename = state.requests.find(
    (r) => r.kind === "npp-rename" && r.status === "pending"
  );
  const isPlusPlus = state.tier === "supporter-plus-plus";

  return (
    <div className="space-y-5">
      <div className={CARD_CLASS}>
        <h3 className="text-base font-semibold text-foreground">{t("supporterPerks.title")}</h3>
        <p className="mt-1 text-sm text-muted">
          {t("supporterPerks.currentTier")}{" "}
          <span className="font-medium text-foreground">{tierLabel(state.tier, t)}</span>
          {state.isPatronActive
            ? ` ${t("supporterPerks.active")}`
            : state.tier
              ? ` ${t("supporterPerks.inactive")}`
              : ""}
        </p>
        {!state.isPatronActive && (
          <p className="mt-2 text-sm text-muted">{t("supporterPerks.subscriptionRequired")}</p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-500">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-500">
          {message}
        </div>
      )}

      {/* Supporter wall name */}
      <div className={CARD_CLASS}>
        <h4 className="text-sm font-semibold text-foreground">{t("supporterPerks.wallTitle")}</h4>
        <p className="mt-1 text-xs text-muted">{t("supporterPerks.wallHint")}</p>
        <p className="mt-3 text-sm text-foreground">
          {t("supporterPerks.currentWallName")}{" "}
          <span className="font-medium">{state.supporterWallName || t("common.notSet")}</span>
        </p>
        {pendingWall ? (
          <p className="mt-2 text-sm text-amber-500">
            {t("supporterPerks.pendingReview", { name: pendingWall.proposedName ?? "" })}
          </p>
        ) : state.canSubmitWallName ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={wallName}
              onChange={(e) => setWallName(e.target.value)}
              placeholder={t("supporterPerks.wallPlaceholder")}
              maxLength={40}
              className="flex-1 rounded-xl border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <button
              onClick={() =>
                submitRequest({ kind: "wall-name", proposedName: wallName }, setSubmittingWall)
              }
              disabled={submittingWall || wallName.trim().length < 2}
              className="rounded-xl border border-primary/35 bg-primary/12 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/18 disabled:opacity-50"
            >
              {t("supporterPerks.submit")}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">
            {state.isPatronActive
              ? t("supporterPerks.alreadyPending")
              : t("supporterPerks.subscribeToClaim")}
          </p>
        )}
      </div>

      {/* NPP rename (Supporter++) */}
      <div className={CARD_CLASS}>
        <h4 className="text-sm font-semibold text-foreground">{t("supporterPerks.renameTitle")}</h4>
        <p className="mt-1 text-xs text-muted">{t("supporterPerks.renameHint")}</p>
        {!isPlusPlus ? (
          <p className="mt-3 text-sm text-muted">{t("supporterPerks.requiresPlusPlus")}</p>
        ) : state.nppRenameUsed ? (
          <p className="mt-3 text-sm text-muted">{t("supporterPerks.renameUsed")}</p>
        ) : pendingRename ? (
          <p className="mt-3 text-sm text-amber-500">
            {t("supporterPerks.pendingRename", {
              from: pendingRename.currentNppName ?? "",
              to: pendingRename.proposedNppName ?? "",
            })}
          </p>
        ) : state.canSubmitNppRename ? (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t("supporterPerks.findPolitician")}
              </label>
              <input
                type="text"
                value={nppQuery}
                onChange={(e) => {
                  setNppQuery(e.target.value);
                  setSelectedNpp(null);
                }}
                placeholder={t("supporterPerks.searchPlaceholder")}
                className="w-full rounded-xl border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              />
              {!selectedNpp && nppResults.length > 0 && (
                <div className="mt-1 rounded-xl border border-card-border bg-card divide-y divide-card-border">
                  {nppResults.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setSelectedNpp(n);
                        setNppQuery(n.name);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-background/60"
                    >
                      {n.name}
                      <span className="text-muted">
                        {" "}
                        ({n.party}
                        {n.office ? `, ${n.office}` : ""}
                        {n.countryId ? `, ${n.countryId.toUpperCase()}` : ""})
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedNpp && (
              <>
                <p className="text-sm text-foreground">
                  {t("supporterPerks.selectedLabel")}{" "}
                  <span className="font-medium">{selectedNpp.name}</span>
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={proposedNppName}
                    onChange={(e) => setProposedNppName(e.target.value)}
                    placeholder={t("supporterPerks.newNamePlaceholder")}
                    maxLength={60}
                    className="flex-1 rounded-xl border border-card-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <button
                    onClick={() =>
                      submitRequest(
                        {
                          kind: "npp-rename",
                          nppId: selectedNpp.id,
                          proposedNppName,
                        },
                        setSubmittingRename
                      )
                    }
                    disabled={submittingRename || proposedNppName.trim().length < 2}
                    className="rounded-xl border border-primary/35 bg-primary/12 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/18 disabled:opacity-50"
                  >
                    {t("supporterPerks.submitRename")}
                  </button>
                </div>
                <p className="text-xs text-amber-500">{t("supporterPerks.oneTime")}</p>
              </>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{t("supporterPerks.unavailable")}</p>
        )}
      </div>

      {/* Recent requests */}
      {state.requests.length > 0 && (
        <div className={CARD_CLASS}>
          <h4 className="text-sm font-semibold text-foreground mb-2">
            {t("supporterPerks.recentRequests")}
          </h4>
          <div className="divide-y divide-card-border">
            {state.requests.map((r) => (
              <div key={r._id} className="py-2 text-sm">
                {statusBadge(r.status, t)}{" "}
                <span className="text-foreground">
                  {r.kind === "wall-name"
                    ? t("supporterPerks.wallEntry", { name: r.proposedName ?? "" })
                    : t("supporterPerks.renameEntry", {
                        from: r.currentNppName ?? "",
                        to: r.proposedNppName ?? "",
                      })}
                </span>
                {r.rejectionReason && (
                  <span className="text-muted">
                    {" "}
                    {t("supporterPerks.rejectionReason", { reason: r.rejectionReason })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
