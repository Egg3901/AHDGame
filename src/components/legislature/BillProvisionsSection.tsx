import type { ReactNode } from "react";
import type { ProvisionDisplay } from "@/lib/legislature/provisionEnrichment";
import { provisionToView } from "@/lib/legislature/dto/provisionView";
import { BillProvisionCard } from "./BillProvisionCard";

export function BillProvisionsSection({
  provisions,
  billCountry,
  children,
}: {
  provisions?: ProvisionDisplay[];
  billCountry?: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-card-border/40 pt-2">
      <h3 className="text-lg font-semibold">Provisions</h3>
      {provisions?.length ? (
        <>
          {provisions.map((provision, index) => (
            <BillProvisionCard
              key={index}
              view={provisionToView(provision)}
              billCountry={billCountry}
              index={index}
            />
          ))}
          {children}
        </>
      ) : (
        <p className="text-sm text-muted">No policy provisions are recorded for this bill.</p>
      )}
    </section>
  );
}
