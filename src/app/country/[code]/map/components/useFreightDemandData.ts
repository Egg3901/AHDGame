import { useState, useEffect } from "react";
import type { FreightDemandEntry } from "@/app/api/map/logistics/route";

export type FreightDemandData = {
  turn: number | null;
  states: Record<string, FreightDemandEntry>;
};

export function useFreightDemandData(mode: string, countryId: string): FreightDemandData {
  const [data, setData] = useState<FreightDemandData>({ turn: null, states: {} });

  useEffect(() => {
    if (mode !== "logistics") return;
    fetch(`/api/map/logistics?countryId=${countryId}`)
      .then((r) => (r.ok ? r.json() : { turn: null, states: {} }))
      .then((d: FreightDemandData) => setData({ turn: d.turn ?? null, states: d.states ?? {} }))
      .catch(() => setData({ turn: null, states: {} }));
  }, [mode, countryId]);

  return data;
}
