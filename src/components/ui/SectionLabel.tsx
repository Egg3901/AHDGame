"use client";

interface SectionLabelProps {
  children: React.ReactNode;
  as?: "h2" | "h3" | "h4" | "p" | "span";
  className?: string;
}

export function SectionLabel({ children, as: Tag = "h2", className }: SectionLabelProps) {
  return (
    <div className={`flex items-center gap-2 mb-3 ${className ?? ""}`}>
      <span className="block h-3 w-0.5 rounded-full bg-primary opacity-70 shrink-0" />
      <Tag className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</Tag>
    </div>
  );
}
