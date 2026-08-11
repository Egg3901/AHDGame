"use client";

import { getPartyColor } from "@/lib/utils/politics";

interface ElectedOfficial {
  _id: string;
  officeType: string;
  state?: string;
  senateClass?: number;
  district?: number;
  seatsHeld?: number;
  characterId: string | null;
  characterName?: string;
  party?: string;
}

interface OfficialsListProps {
  officials: ElectedOfficial[];
  getOfficialLabel: (official: ElectedOfficial) => string;
  onAppoint: (official: ElectedOfficial) => void;
}

export function OfficialsList({ officials, getOfficialLabel, onAppoint }: OfficialsListProps) {
  if (officials.length === 0) return null;

  return (
    <div className="mb-4 max-h-96 overflow-y-auto rounded-lg border border-card-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-card-border">
            <th className="px-4 py-2 text-left">Position</th>
            <th className="px-4 py-2 text-left">Incumbent</th>
            <th className="px-4 py-2 text-left">Party</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {officials.map((official) => (
            <tr key={official._id} className="border-b border-card-border last:border-b-0">
              <td className="px-4 py-2 font-medium">{getOfficialLabel(official)}</td>
              <td className="px-4 py-2">
                {official.characterName || <span className="text-muted">Vacant</span>}
              </td>
              <td className="px-4 py-2">
                {official.party && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${getPartyColor(official.party)}`}
                  >
                    {official.party.charAt(0).toUpperCase() + official.party.slice(1)}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => onAppoint(official)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs text-primary hover:bg-primary/30"
                >
                  {official.characterId ? "Change" : "Appoint"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
