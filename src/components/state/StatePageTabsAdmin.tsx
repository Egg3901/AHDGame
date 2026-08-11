"use client";

import { useState, useEffect, useCallback } from "react";
import type { State } from "@/lib/db/types";
import {
  getRegionalExecutiveOfficeKey,
  getOfficeTypeConfig,
  type CountryId,
} from "@/lib/constants/countries";
import type { SerializedPlayer, NPPDisplaySimple } from "./StatePageTabsTypes";

/** One region seat group from the vacant-seats route (config-driven). */
interface SeatGroup {
  officeType: string;
  label: string;
  groupLabel: string;
  kind: "executive" | "classedUpper" | "upperChamber" | "lowerChamber" | "subNationalChamber";
  multiSeat: boolean;
  vacant: number;
  total: number;
  /** Present only for the US-style classed senate group. */
  classes?: { class: 1 | 2 | 3; isVacant: boolean }[];
}

/** The seat the admin has selected to fill. */
interface SelectedSeat {
  officeType: string;
  senateClass?: 1 | 2 | 3;
  /** Heading/button label, e.g. "Governor", "Class I Senator", "NPC Delegate". */
  label: string;
  multiSeat: boolean;
  /** Max seats assignable for a multi-seat group. */
  max: number;
}

interface FilledOfficial {
  _id: string;
  officeType: string;
  senateClass?: number;
  seatsHeld: number;
  characterId: string | null;
  nppId: string | null;
  characterName: string;
  party: string | null;
  isNPP: boolean;
}

export function AdminTab({
  state,
  players,
  npps,
}: {
  state: State;
  players: SerializedPlayer[];
  npps: NPPDisplaySimple[];
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<SelectedSeat | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [entityType, setEntityType] = useState<"player" | "npp">("player");
  const [seatsToAssign, setSeatsToAssign] = useState<number>(1);
  const [vacantSeats, setVacantSeats] = useState<{
    seatGroups: SeatGroup[];
    filledOfficials: FilledOfficial[];
  } | null>(null);

  const fetchVacantSeats = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/country/${state.countryId.toLowerCase()}/region/${encodeURIComponent(state._id)}/vacant-seats`
      );
      if (res.ok) {
        const data = await res.json();
        setVacantSeats(data);
      }
    } catch (error) {
      console.error("Error fetching vacant seats:", error);
    }
  }, [state._id, state.countryId]);

  useEffect(() => {
    fetchVacantSeats();
  }, [fetchVacantSeats]);

  const handleAssign = async () => {
    if (!selectedSeat || !selectedEntityId) {
      setMessage({
        type: "error",
        text: "Please select a seat and a politician",
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch(
        `/api/admin/country/${state.countryId.toLowerCase()}/region/${encodeURIComponent(state._id)}/assign-seat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seatType: selectedSeat.officeType,
            senateClass: selectedSeat.senateClass,
            entityId: selectedEntityId,
            entityType,
            seatsToAssign: selectedSeat.multiSeat ? seatsToAssign : 1,
          }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        setMessage({
          type: "success",
          text: data.message || "Seat assigned successfully",
        });
        setSelectedSeat(null);
        setSelectedEntityId("");
        setSeatsToAssign(1);
        fetchVacantSeats();
      } else {
        setMessage({
          type: "error",
          text: data.error || "Failed to assign seat",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Network error - please try again",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (officialId: string) => {
    if (!confirm("Are you sure you want to remove this official from their position?")) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch(
        `/api/admin/country/${state.countryId.toLowerCase()}/region/${encodeURIComponent(state._id)}/remove-official`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ officialId }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        setMessage({
          type: "success",
          text: data.message || "Official removed successfully",
        });
        fetchVacantSeats();
      } else {
        setMessage({
          type: "error",
          text: data.error || "Failed to remove official",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Network error - please try again",
      });
    } finally {
      setLoading(false);
    }
  };

  // Single-seat offices (executive / classed senate) are unique per holder — hide
  // anyone who already holds that office. Multi-seat chambers can accumulate, so
  // no exclusion there.
  const excludesCurrentHolders = Boolean(selectedSeat && !selectedSeat.multiSeat);
  const holdsSelectedOffice = (office?: { type?: string } | null) =>
    Boolean(office && office.type === selectedSeat?.officeType);
  const availableEntities =
    entityType === "player"
      ? players.filter((p) =>
          excludesCurrentHolders ? !holdsSelectedOffice(p.currentOffice) : true
        )
      : npps.filter((n) => (excludesCurrentHolders ? !holdsSelectedOffice(n.currentOffice) : true));

  // The regional executive's officeType key is "governor" for several countries
  // but its real title varies (UK "First Minister", DE "Minister-President"). Use
  // the config label so the removal list matches the appointer + hero.
  const execOfficeKey = getRegionalExecutiveOfficeKey(state.countryId as CountryId);
  const execLabel =
    getOfficeTypeConfig(state.countryId as CountryId, execOfficeKey)?.label ?? "Governor";

  const getOfficeLabel = (official: FilledOfficial) => {
    if (official.officeType === execOfficeKey) return execLabel;
    switch (official.officeType) {
      case "senate":
        return `Senator (Class ${["I", "II", "III"][(official.senateClass ?? 1) - 1]})`;
      case "house":
        return `House Rep (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "governor":
        return "Governor";
      case "stateSenate":
        return `State Senator (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "regionalCouncil":
        return `Regional Councillor (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "bundestag":
        return `Member of Bundestag (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "landtag":
        return `Mitglied des Landtags (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "ministerPresident":
        return "Minister-President";
      case "shugiin":
        return `Shūgiin Member (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "sangiin":
        return `Sangiin Member (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "commons":
        return `MP (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "npcDelegate":
        return `NPC Delegate (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "peoplesCongress":
        return `People's Congress Delegate (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "dail":
        return `TD (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "seanad":
        return `Senator (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      case "localCouncil":
        return `Councillor (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
      default:
        return official.officeType;
    }
  };

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <div className="flex items-start gap-3">
          <svg
            className="h-5 w-5 text-red-500 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <h3 className="font-semibold text-red-400">Admin Controls</h3>
            <p className="text-sm text-red-300/80 mt-1">
              These controls allow you to manually assign or remove players and NPPs from elected
              positions. Use with caution - changes take effect immediately.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-red-500/10 border border-red-500/30 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Assign Seats Section */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h3 className="text-lg font-semibold mb-4">Vacant Seats in {state.name}</h3>

        {vacantSeats ? (
          <div className="grid gap-4 md:grid-cols-2">
            {vacantSeats.seatGroups
              // Hide multi-seat chambers a region doesn't have (total 0); always
              // show the executive and the classed senate group.
              .filter((g) => !g.multiSeat || g.total > 0)
              .map((group) => {
                const roman = ["I", "II", "III"];
                const btnClass = (selected: boolean, vacant: boolean) =>
                  `w-full flex items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : vacant
                        ? "border-card-border bg-background hover:border-primary/50 cursor-pointer"
                        : "border-card-border/50 bg-card-border/10 text-muted/50 cursor-not-allowed"
                  }`;

                // US-style classed senate: one button per class.
                if (group.kind === "classedUpper") {
                  return (
                    <div key={group.officeType} className="space-y-2">
                      <h4 className="text-sm font-medium text-muted">
                        {group.groupLabel} ({group.classes?.length ?? 0} positions)
                      </h4>
                      <div className="space-y-2">
                        {group.classes?.map((seat) => {
                          const selected =
                            selectedSeat?.officeType === group.officeType &&
                            selectedSeat?.senateClass === seat.class;
                          const seatLabel = `Class ${roman[seat.class - 1]} ${group.label}`;
                          return (
                            <button
                              key={seat.class}
                              onClick={() =>
                                seat.isVacant &&
                                setSelectedSeat({
                                  officeType: group.officeType,
                                  senateClass: seat.class,
                                  label: seatLabel,
                                  multiSeat: false,
                                  max: 1,
                                })
                              }
                              disabled={!seat.isVacant}
                              className={btnClass(selected, seat.isVacant)}
                            >
                              <span>{seatLabel}</span>
                              <span
                                className={seat.isVacant ? "text-yellow-400" : "text-green-400"}
                              >
                                {seat.isVacant ? "Vacant" : "Filled"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                // Executive (single) or chamber (multi): a single button.
                const selected = selectedSeat?.officeType === group.officeType;
                const isVacant = group.vacant > 0;
                return (
                  <div key={group.officeType} className="space-y-2">
                    <h4 className="text-sm font-medium text-muted">{group.groupLabel}</h4>
                    <button
                      onClick={() =>
                        isVacant &&
                        setSelectedSeat({
                          officeType: group.officeType,
                          label: group.label,
                          multiSeat: group.multiSeat,
                          max: group.vacant,
                        })
                      }
                      disabled={!isVacant}
                      className={btnClass(selected, isVacant)}
                    >
                      <span>{group.label}</span>
                      <span className={isVacant ? "text-yellow-400" : "text-green-400"}>
                        {group.multiSeat
                          ? `${group.vacant} / ${group.total} vacant`
                          : isVacant
                            ? "Vacant"
                            : "Filled"}
                      </span>
                    </button>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="text-center py-4 text-muted">Loading vacant seats...</div>
        )}
      </div>

      {/* Assignment Form */}
      {selectedSeat && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
          <h3 className="text-lg font-semibold mb-4">Assign {selectedSeat.label}</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Politician Type</label>
              <div className="flex rounded-lg border border-card-border overflow-hidden">
                <button
                  onClick={() => {
                    setEntityType("player");
                    setSelectedEntityId("");
                  }}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    entityType === "player"
                      ? "bg-primary text-white"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  Player
                </button>
                <button
                  onClick={() => {
                    setEntityType("npp");
                    setSelectedEntityId("");
                  }}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    entityType === "npp"
                      ? "bg-purple-500 text-white"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  NPP
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-2">
                Select {entityType === "player" ? "Player" : "NPP"}
              </label>
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-background px-4 py-2 text-sm focus:outline-none focus:border-primary"
              >
                <option value="">-- Select --</option>
                {availableEntities.map((e) => (
                  <option key={e._id} value={e._id}>
                    {e.name} ({e.party})
                  </option>
                ))}
              </select>
            </div>

            {selectedSeat.multiSeat && (
              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Seats to Assign (max {selectedSeat.max})
                </label>
                <input
                  type="number"
                  min={1}
                  max={selectedSeat.max}
                  value={seatsToAssign}
                  onChange={(e) => {
                    setSeatsToAssign(
                      Math.max(1, Math.min(selectedSeat.max, parseInt(e.target.value) || 1))
                    );
                  }}
                  className="w-full rounded-lg border border-card-border bg-background px-4 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setSelectedSeat(null);
                  setSelectedEntityId("");
                }}
                className="flex-1 rounded-lg border border-card-border bg-card py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={loading || !selectedEntityId}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {loading ? "Assigning..." : "Assign Seat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Officials Section */}
      {vacantSeats && vacantSeats.filledOfficials.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h3 className="text-lg font-semibold mb-4">Current Officials</h3>
          <p className="text-sm text-muted mb-4">
            Click the remove button to vacate a position. This will clear the official&apos;s
            currentOffice field.
          </p>
          <div className="space-y-2">
            {vacantSeats.filledOfficials.map((official) => (
              <div
                key={official._id}
                className="flex items-center justify-between rounded-lg border border-card-border bg-background px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium text-sm">{official.characterName}</div>
                    <div className="text-xs text-muted">
                      {getOfficeLabel(official)}
                      {official.party && ` · ${official.party}`}
                      {official.isNPP && <span className="ml-1 text-purple-400">(NPP)</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(official._id)}
                  disabled={loading}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
