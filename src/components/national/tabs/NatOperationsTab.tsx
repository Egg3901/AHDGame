import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import { CeoOperationsPanel } from "../official/CeoOperationsPanel";

/**
 * Operations tab (CEO-gated, spec P6g §3): the seated CEO runs the enterprise —
 * financing (profit split + treasury draw) and per-sector investment.
 */
export function NatOperationsTab({
  vm,
  corpId,
  onRefresh,
}: {
  vm: NationalCorporationViewModel;
  corpId: string;
  onRefresh: () => void;
}) {
  return <CeoOperationsPanel vm={vm} corpId={corpId} onRefresh={onRefresh} />;
}
