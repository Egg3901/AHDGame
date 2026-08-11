"use client";

import { useEffect, useMemo, useState } from "react";
import { PartyLogo } from "@/components/PartyLogo";
import { Button, Input, Modal } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";

interface CharacterOption {
  id: string;
  name: string;
  party: string;
  partyName: string | null;
  homeState: string;
  partyColor: string | null;
  countryId: CountryId;
}

interface RunningMateSelectorProps {
  electionId: string;
  currentRunningMateCharacterId: string | null;
  currentRunningMateName: string | null;
  onSuccess: () => void;
}

function formatPartyName(party: string): string {
  return party
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Display label for a character's party. Prefers the resolved party name from
 * the API (e.g. "All Progressives Congress"); falls back to prettifying the raw
 * key for slug parties like "independent". Parties are stored as numeric ids in
 * most countries, so the raw key alone is not showable.
 */
function partyLabel(party: string, partyName: string | null): string {
  return partyName ?? formatPartyName(party);
}

export function RunningMateSelector({
  electionId,
  currentRunningMateCharacterId,
  currentRunningMateName,
  onSuccess,
}: RunningMateSelectorProps) {
  const [open, setOpen] = useState(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [partyFilter, setPartyFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    currentRunningMateCharacterId
  );

  const uniqueParties = useMemo(() => {
    const partyMap = new Map<
      string,
      { color: string | null; countryId: CountryId; name: string | null }
    >();

    for (const character of characters) {
      if (!partyMap.has(character.party)) {
        partyMap.set(character.party, {
          color: character.partyColor,
          countryId: character.countryId,
          name: character.partyName,
        });
      }
    }

    return Array.from(partyMap.entries()).sort((a, b) =>
      partyLabel(a[0], a[1].name).localeCompare(partyLabel(b[0], b[1].name))
    );
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return characters.filter((character) => {
      if (partyFilter && character.party !== partyFilter) return false;
      if (normalizedQuery && !character.name.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [characters, partyFilter, searchQuery]);

  const suggestedCharacters = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return filteredCharacters.slice(0, 8);
  }, [filteredCharacters, searchQuery]);

  const browseCharacters = useMemo(() => {
    if (searchQuery.trim()) return [];
    return filteredCharacters.slice(0, 40);
  }, [filteredCharacters, searchQuery]);

  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === selectedCharacterId) ?? null,
    [characters, selectedCharacterId]
  );

  const hasSelectionChanged = selectedCharacterId !== currentRunningMateCharacterId;

  useEffect(() => {
    if (open && characters.length === 0) {
      setLoading(true);
      fetch(`/api/elections/${electionId}/running-mate/characters`)
        .then((response) => response.json())
        .then((data) => {
          if (data.characters) setCharacters(data.characters);
        })
        .finally(() => setLoading(false));
    }
  }, [open, electionId, characters.length]);

  useEffect(() => {
    if (!open) return;

    setSelectedCharacterId(currentRunningMateCharacterId);
    setPartyFilter(null);
    setSearchQuery("");
    setErrorMessage("");
  }, [open, currentRunningMateCharacterId]);

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage("");

    try {
      const response = await fetch(`/api/elections/${electionId}/running-mate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runningMateId: selectedCharacterId || null }),
      });
      const data = await response.json();

      if (response.ok) {
        setOpen(false);
        onSuccess();
      } else {
        setErrorMessage(data.error ?? "Unable to update your running mate.");
      }
    } catch {
      setErrorMessage("Network error while saving your running mate.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">
        Running mate:{" "}
        <span className="font-medium text-foreground">
          {currentRunningMateName || "None selected"}
        </span>
      </span>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {currentRunningMateCharacterId ? "Change" : "Select"}
      </Button>

      <Modal open={open} title="Select Running Mate" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info">
            Choose any eligible player from your country, regardless of party. Search by player name
            or filter by party to narrow the list.
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
              {errorMessage}
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Type a player name to see matches..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />

              {searchQuery.trim().length > 0 && !loading && (
                <div className="rounded-lg border border-card-border bg-card-elevated shadow-panel">
                  {suggestedCharacters.length > 0 ? (
                    <div className="divide-y divide-card-border">
                      {suggestedCharacters.map((character) => {
                        const color = character.partyColor || "#888888";
                        const isSelected = selectedCharacterId === character.id;

                        return (
                          <button
                            key={character.id}
                            type="button"
                            onClick={() => setSelectedCharacterId(character.id)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                              isSelected ? "bg-primary/10" : "hover:bg-card"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {character.name}
                              </p>
                              <p className="text-xs text-muted">{character.homeState}</p>
                            </div>
                            <span
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                borderColor: `${color}60`,
                                backgroundColor: `${color}18`,
                                color,
                              }}
                            >
                              <PartyLogo
                                partyId={character.party}
                                partyColor={color}
                                countryId={character.countryId}
                                size="h-2 w-2"
                              />
                              {partyLabel(character.party, character.partyName)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-sm text-muted">
                      No players match that search yet.
                    </div>
                  )}
                </div>
              )}

              {searchQuery.trim().length > 0 &&
                filteredCharacters.length > suggestedCharacters.length && (
                  <p className="text-xs text-muted">
                    {filteredCharacters.length} matching players found. Keep typing to narrow the
                    list.
                  </p>
                )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPartyFilter(null)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  partyFilter === null
                    ? "border-primary/50 bg-primary/20 text-primary"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                All parties
              </button>
              {uniqueParties.map(([party, { color: partyColor, countryId, name }]) => {
                const isSelected = partyFilter === party;
                const color = partyColor || "#888888";

                return (
                  <button
                    key={party}
                    type="button"
                    onClick={() => setPartyFilter(party)}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{
                      borderColor: isSelected ? `${color}80` : `${color}40`,
                      backgroundColor: isSelected ? `${color}30` : `${color}15`,
                      color,
                    }}
                  >
                    <PartyLogo
                      partyId={party}
                      partyColor={color}
                      countryId={countryId}
                      size="h-2.5 w-2.5"
                    />
                    {partyLabel(party, name)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-card-border bg-card-elevated p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Selected running mate</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {selectedCharacter?.name ?? currentRunningMateName ?? "None selected"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {selectedCharacter
                ? `${partyLabel(selectedCharacter.party, selectedCharacter.partyName)} - ${selectedCharacter.homeState}`
                : "Choose a player from the matches above or browse below."}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {searchQuery.trim() ? "Matching players" : "Eligible players"}
              </p>
              {!searchQuery.trim() && filteredCharacters.length > browseCharacters.length && (
                <p className="text-xs text-muted">
                  Showing the first {browseCharacters.length} players. Search to narrow faster.
                </p>
              )}
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="py-4 text-sm text-muted">Loading eligible players...</div>
              ) : searchQuery.trim() ? (
                suggestedCharacters.length === 0 && (
                  <div className="rounded-lg border border-card-border bg-card p-3 text-sm text-muted">
                    No matching players to select.
                  </div>
                )
              ) : browseCharacters.length === 0 ? (
                <div className="rounded-lg border border-card-border bg-card p-3 text-sm text-muted">
                  No players match the current party filter.
                </div>
              ) : (
                browseCharacters.map((character) => {
                  const color = character.partyColor || "#888888";
                  const isSelected = selectedCharacterId === character.id;

                  return (
                    <button
                      key={character.id}
                      type="button"
                      onClick={() => setSelectedCharacterId(character.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-primary/40 bg-primary/5"
                          : "border-card-border bg-card hover:bg-card-elevated"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {character.name}
                        </p>
                        <p className="text-xs text-muted">{character.homeState}</p>
                      </div>
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          borderColor: `${color}60`,
                          backgroundColor: `${color}18`,
                          color,
                        }}
                      >
                        <PartyLogo
                          partyId={character.party}
                          partyColor={color}
                          countryId={character.countryId}
                          size="h-2 w-2"
                        />
                        {partyLabel(character.party, character.partyName)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelectedCharacterId(null)}
              disabled={
                saving || (selectedCharacterId === null && currentRunningMateCharacterId === null)
              }
            >
              Clear selection
            </Button>
            <Button onClick={handleSave} isLoading={saving} disabled={!hasSelectionChanged}>
              Save running mate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
