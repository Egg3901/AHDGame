import { SectionCard } from "./dossier";

export function FlagshipPlaceholder({ label }: { label: string }) {
  return (
    <SectionCard title={label} sub="Flagship operations">
      <div className="rounded-lg border border-dashed border-card-border bg-card-muted p-8 text-center">
        <p className="text-sm font-medium text-foreground">{label} operations are coming soon.</p>
        <p className="mt-1 text-[12px] text-muted">
          This portfolio&apos;s flagship management tools are being built in a future update.
        </p>
      </div>
    </SectionCard>
  );
}
