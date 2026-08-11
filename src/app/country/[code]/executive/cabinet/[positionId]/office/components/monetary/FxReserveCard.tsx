import { MonetaryCard, Stat } from "./monetaryUi";
import type { MonetaryView } from "../../useCabinetOffice";

export function FxReserveCard({ m, sym }: { m: MonetaryView; sym: string }) {
  const money = (n: number | null) => (n == null ? "—" : `${sym}${Math.round(n).toLocaleString()}`);
  return (
    <MonetaryCard
      title="FX Reserves & Band"
      hint="Central-bank intervention pool the Treasury funds"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Reserve balance" value={money(m.reserveBalance)} />
        <Stat label="Forex revenue" value={money(m.forexRevenue)} />
        <Stat label="FX rate" value={m.fxRate == null ? "—" : m.fxRate.toFixed(4)} />
        <Stat
          label="Intervention band"
          value={m.fxBand ? `${m.fxBand.floor.toFixed(3)}–${m.fxBand.ceiling.toFixed(3)}` : "None"}
        />
      </div>
    </MonetaryCard>
  );
}
