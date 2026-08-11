"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CaucusListEntry,
  CaucusDetail,
  RosterEntry,
  CaucusesTabProps,
} from "./caucus/caucusTypes";
import { apiBase } from "./caucus/caucusUtils";
import { CaucusMembershipShareCard } from "./caucus/CaucusMembershipShareCard";
import { FoundCaucusForm } from "./caucus/FoundCaucusForm";
import { SelectedCaucus } from "./caucus/SelectedCaucus";

export function CaucusesTab({
  countryCode,
  partyId,
  viewerCharacterId,
  currentTurn,
  isNationalParty,
  viewerInParty,
  eligibleStates = [],
  initialSelectedSlug = null,
}: CaucusesTabProps) {
  const [list, setList] = useState<CaucusListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaucusDetail | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterFilter, setRosterFilter] = useState<"all" | "players" | "npps">("all");
  const [showFoundForm, setShowFoundForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiBase(countryCode, partyId), { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: CaucusListEntry[] };
        setList(data.items);
      }
    } finally {
      setLoading(false);
    }
  }, [countryCode, partyId]);

  const fetchDetail = useCallback(
    async (slug: string) => {
      try {
        const res = await fetch(`${apiBase(countryCode, partyId)}/${slug}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as CaucusDetail;
          setDetail(data);
        }
      } catch {
        // ignore
      }
    },
    [countryCode, partyId]
  );

  const fetchRoster = useCallback(
    async (slug: string, filter: "all" | "players" | "npps") => {
      try {
        const res = await fetch(
          `${apiBase(countryCode, partyId)}/${slug}/roster?filter=${filter}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = (await res.json()) as { items: RosterEntry[] };
          setRoster(data.items);
        }
      } catch {
        // ignore
      }
    },
    [countryCode, partyId]
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!initialSelectedSlug || selectedSlug) return;
    if (list.some((entry) => entry.slug === initialSelectedSlug)) {
      setSelectedSlug(initialSelectedSlug);
    }
  }, [initialSelectedSlug, list, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      setRoster(null);
      return;
    }
    void fetchDetail(selectedSlug);
    void fetchRoster(selectedSlug, rosterFilter);
  }, [selectedSlug, rosterFilter, fetchDetail, fetchRoster]);

  if (!isNationalParty) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h3 className="mb-2 text-sm font-semibold">Caucuses are a National-only feature</h3>
        <p className="text-sm text-muted">
          State and regional party chapters do not own caucuses. Visit the national party page to
          view and act on caucuses.
        </p>
      </div>
    );
  }

  const selectedCaucus = list.find((caucus) => caucus.slug === selectedSlug) ?? null;
  const isChairOfSelected =
    !!selectedCaucus && !!viewerCharacterId && selectedCaucus.chairId === viewerCharacterId;

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            msg.startsWith("Success:")
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {msg}
        </div>
      )}

      {viewerInParty && (
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Caucuses are opt-in sub-blocs within this party. Each has a chair who sets policy
              positions and a campaign-fund Tax (0-5%).
            </p>
            <button
              type="button"
              onClick={() => {
                setShowFoundForm((value) => !value);
                setMsg(null);
              }}
              className="rounded-md border border-primary/50 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
            >
              {showFoundForm ? "Cancel" : "Found new caucus"}
            </button>
          </div>
          {showFoundForm && (
            <FoundCaucusForm
              countryCode={countryCode}
              partyId={partyId}
              onSuccess={(slug) => {
                setShowFoundForm(false);
                setMsg("Success: Caucus founded.");
                void refreshList().then(() => setSelectedSlug(slug));
              }}
              onError={(text) => setMsg(`Error: ${text}`)}
            />
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-card-border bg-card p-6 text-sm text-muted">
          Loading caucuses...
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-6 text-sm text-muted">
          No caucuses founded yet. {viewerInParty && "Be the first to start one."}
        </div>
      ) : (
        <div className="space-y-4">
          <CaucusMembershipShareCard
            caucuses={list}
            selectedSlug={selectedSlug}
            onSelect={setSelectedSlug}
          />

          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              {list.map((caucus) => {
                const selected = caucus.slug === selectedSlug;
                return (
                  <button
                    key={caucus.id}
                    type="button"
                    onClick={() => setSelectedSlug(caucus.slug)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-card-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: caucus.color }}
                      />
                      <span className="truncate text-sm font-bold">{caucus.name}</span>
                    </div>
                    <div className="text-[11px] text-muted">
                      Chair {caucus.chairName ?? "Vacant"} | {caucus.memberCounts.total} members |
                      {" Tax "}
                      {caucus.taxRate}%
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedCaucus && detail ? (
              <SelectedCaucus
                countryCode={countryCode}
                partyId={partyId}
                caucus={selectedCaucus}
                detail={detail}
                currentTurn={currentTurn}
                roster={roster}
                rosterFilter={rosterFilter}
                setRosterFilter={setRosterFilter}
                isChair={isChairOfSelected}
                viewerCharacterId={viewerCharacterId}
                viewerInParty={viewerInParty}
                refreshList={refreshList}
                refreshDetail={() => fetchDetail(selectedCaucus.slug)}
                refreshRoster={() => fetchRoster(selectedCaucus.slug, rosterFilter)}
                setMsg={setMsg}
                clearSelection={() => setSelectedSlug(null)}
                eligibleStates={eligibleStates}
              />
            ) : (
              <div className="rounded-lg border border-card-border bg-card p-6 text-sm text-muted">
                Select a caucus to see details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
