"use client";

import { type CountryAvailability } from "@/lib/countryAvailability";

export default function StatusBadge({ availability }: { availability: CountryAvailability }) {
  const className =
    availability.displayState === "econ-only"
      ? "bg-secondary/20 text-secondary border-secondary/30"
      : availability.tone === "active"
        ? "bg-success/20 text-success border-success/30"
        : availability.tone === "beta"
          ? "bg-warning/20 text-warning border-warning/30"
          : "bg-muted/20 text-muted border-muted/30";

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${className}`}
    >
      {availability.label}
    </span>
  );
}
