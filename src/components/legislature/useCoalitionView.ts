// src/components/legislature/useCoalitionView.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import type { PartySeatsDisplay } from "@/components/ChamberChart";
import type { CountryId } from "@/lib/constants/countries";

/** A coalition group with its member parties' seat data */
export interface CoalitionGroup {
  coalitionId: number;
  name: string;
  color: string;
  economicPosition: number;
  totalSeats: number;
  members: PartySeatsDisplay[];
}

/** Full coalition view data passed to chart components */
export interface CoalitionViewData {
  coalitionGroups: CoalitionGroup[];
  independents: PartySeatsDisplay[];
}

/** Raw coalition from API (enriched format) */
interface CoalitionApiEntry {
  sequentialId: number;
  name: string;
  color: string;
  memberParties?: Array<{ partyId: number }>;
}

/**
 * Hook to fetch coalitions for a country and transform seat data into coalition groups.
 *
 * Returns null for coalitionView when:
 * - Still loading
 * - No coalitions exist
 * - No coalition member parties hold seats in the given composition
 */
export function useCoalitionView(countryId: CountryId | undefined) {
  const [coalitions, setCoalitions] = useState<CoalitionApiEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!countryId) return;
    async function load() {
      try {
        const res = await fetch(`/api/country/${countryId!.toLowerCase()}/coalitions`);
        const data = res.ok ? await res.json() : { coalitions: [] };
        setCoalitions(data.coalitions ?? []);
      } catch {
        setCoalitions([]);
      } finally {
        setLoaded(true);
      }
    }
    void load();
  }, [countryId]);

  /** Check whether any coalition member party holds seats in this composition */
  const hasCoalitionSeats = useCallback(
    (composition: PartySeatsDisplay[]): boolean => {
      if (!coalitions || coalitions.length === 0) return false;
      const seatedPartyIds = new Set(composition.map((p) => p.party));
      return coalitions.some((c) =>
        c.memberParties?.some((m) => seatedPartyIds.has(String(m.partyId)))
      );
    },
    [coalitions]
  );

  /** Transform party seat data into coalition-grouped view data */
  const buildCoalitionView = useCallback(
    (composition: PartySeatsDisplay[]): CoalitionViewData | null => {
      if (!coalitions || coalitions.length === 0) return null;

      // Build map: partyId string -> coalition
      const partyToCoalition = new Map<string, CoalitionApiEntry>();
      for (const c of coalitions) {
        for (const m of c.memberParties ?? []) {
          partyToCoalition.set(String(m.partyId), c);
        }
      }

      // Group parties into coalitions
      const groupMap = new Map<
        number,
        { coalition: CoalitionApiEntry; members: PartySeatsDisplay[] }
      >();
      const independents: PartySeatsDisplay[] = [];

      for (const party of composition) {
        if (party.party === "__vacant__") continue;
        const coalition = partyToCoalition.get(party.party);
        if (coalition) {
          const existing = groupMap.get(coalition.sequentialId);
          if (existing) {
            existing.members.push(party);
          } else {
            groupMap.set(coalition.sequentialId, { coalition, members: [party] });
          }
        } else {
          independents.push(party);
        }
      }

      // Build CoalitionGroup[] with computed totals and averaged position
      const coalitionGroups: CoalitionGroup[] = [];
      for (const { coalition, members } of groupMap.values()) {
        if (members.length === 0) continue;
        const totalSeats = members.reduce((sum, m) => sum + m.seats, 0);
        // Seat-weighted average of economic position
        const weightedSum = members.reduce(
          (sum, m) => sum + (m.economicPosition ?? 0) * m.seats,
          0
        );
        const economicPosition = totalSeats > 0 ? weightedSum / totalSeats : 0;

        // Sort members by seats descending
        members.sort((a, b) => b.seats - a.seats);

        coalitionGroups.push({
          coalitionId: coalition.sequentialId,
          name: coalition.name,
          color: coalition.color,
          economicPosition,
          totalSeats,
          members,
        });
      }

      // Sort groups by economic position left-to-right
      coalitionGroups.sort((a, b) => a.economicPosition - b.economicPosition);
      // Sort independents by economic position
      independents.sort((a, b) => (a.economicPosition ?? 0) - (b.economicPosition ?? 0));

      return { coalitionGroups, independents };
    },
    [coalitions]
  );

  return { loaded, hasCoalitionSeats, buildCoalitionView };
}
