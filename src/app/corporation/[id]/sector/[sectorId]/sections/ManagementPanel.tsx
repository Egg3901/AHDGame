interface ManagementPanelProps {
  children: React.ReactNode;
}

export default function ManagementPanel({ children }: ManagementPanelProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="border-b border-card-border px-6 py-4">
        <h2 className="text-lg font-bold text-foreground">Sector administration</h2>
        <p className="mt-1 text-xs text-muted">
          Identity, ownership and irreversible actions are kept together here.
        </p>
      </div>
      <div className="space-y-6 px-6 py-6">{children}</div>
    </div>
  );
}
