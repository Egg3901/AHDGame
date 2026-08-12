import { useState, useEffect } from "react";
import type { FreightDemandResponse } from "@/lib/logistics/types";

export type FreightDemandData = Pick<FreightDemandResponse, "turn" | "states">;

export function useFreightDemandData(mode: string, countryId: string): FreightDemandData {
  const [data, setData] = useState<FreightDemandData>({ turn: null, states: {} });

  useEffect(() => {
    if (mode !== "logistics") return;
    fetch(`/api/map/logistics?countryId=${countryId}`)
      .then(async (r) => (r.ok ? ((await r.json()) as FreightDemandResponse) : null))
      .then((d) => setData({ turn: d?.turn ?? null, states: d?.states ?? {} }))
      .catch(() => setData({ turn: null, states: {} }));
  }, [mode, countryId]);

  return data;
}
