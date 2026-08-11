"use client";

import { useState, useMemo } from "react";
import { Avatar } from "@/components/Avatar";
import { Button, Input } from "@/components/ui";

interface EligibleCharacter {
  _id: string;
  name: string;
  party?: string;
  partyName?: string;
  avatarUrl?: string;
  constituency: string;
  chamberName?: string;
  sequentialId?: number | null;
}

interface Position {
  id: string;
  name: string;
  order: number;
  member: {
    // Null for an NPP-held seat.
    characterId: string | null;
    characterName: string;
    party?: string;
    avatarUrl?: string | null;
    confirmedAt: string;
    isNPP?: boolean;
  } | null;
  cooldownUntil: string | null;
  nomination: unknown;
}

interface AppointModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: Position;
  characters: EligibleCharacter[];
  loading: boolean;
  onAppoint: (positionId: string, characterId: string) => void;
  chamberMemberLabel?: string;
  chamberName?: string;
  isOnePartyState?: boolean;
}

export function AppointModal({
  isOpen,
  onClose,
  position,
  characters,
  loading,
  onAppoint,
  chamberMemberLabel = "Member of Parliament",
  chamberName = "House of Commons",
  isOnePartyState = false,
}: AppointModalProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return characters;
    const query = searchQuery.toLowerCase();
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.constituency.toLowerCase().includes(query) ||
        (c.partyName?.toLowerCase() ?? c.party?.toLowerCase() ?? "").includes(query)
    );
  }, [characters, searchQuery]);

  const selectedCharacter = characters.find((c) => c._id === selectedCharacterId);

  const handleAppoint = () => {
    if (selectedCharacterId) {
      onAppoint(position.id, selectedCharacterId);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-card-border bg-card shadow-lg">
        <div className="border-b border-card-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">Appoint {position.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {isOnePartyState
              ? "Select any player to appoint to this cabinet position."
              : `Select a ${chamberMemberLabel} to appoint to this cabinet position.`}
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-8 text-center text-muted">Loading eligible candidates...</div>
          ) : characters.length === 0 ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
              No eligible candidates found. Candidates must be:
              <ul className="mt-2 list-inside list-disc">
                <li>Player characters (not NPPs)</li>
                <li>
                  {isOnePartyState ? "Citizens of this country" : `Members of the ${chamberName}`}
                </li>
                <li>Not already in cabinet</li>
                <li>Not the sitting Prime Minister</li>
              </ul>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <Input
                  type="text"
                  placeholder="Search by name, constituency, or party..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                {filteredCharacters.map((character) => (
                  <button
                    key={character._id}
                    onClick={() => setSelectedCharacterId(character._id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selectedCharacterId === character._id
                        ? "border-primary bg-primary/5"
                        : "border-card-border hover:border-primary/50"
                    }`}
                  >
                    <Avatar
                      url={character.avatarUrl}
                      name={character.name}
                      size="h-10 w-10"
                      className="rounded-lg shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{character.name}</p>
                      <p className="text-sm text-muted">
                        {character.chamberName && (
                          <span className="mr-1">{character.chamberName} - </span>
                        )}
                        {character.constituency}
                        {(character.partyName || character.party) && (
                          <span className="ml-1">- {character.partyName ?? character.party}</span>
                        )}
                      </p>
                    </div>
                  </button>
                ))}
                {filteredCharacters.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted">
                    No characters match your search.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-card-border p-4 sm:p-6">
          {selectedCharacter && (
            <div className="mb-4 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info">
              <strong>Selected:</strong> {selectedCharacter.name} (
              {selectedCharacter.chamberName ? `${selectedCharacter.chamberName} - ` : ""}
              {selectedCharacter.constituency})
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleAppoint}
              disabled={!selectedCharacterId || loading || characters.length === 0}
              className="flex-1"
            >
              {loading ? "Appointing..." : "Confirm Appointment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
