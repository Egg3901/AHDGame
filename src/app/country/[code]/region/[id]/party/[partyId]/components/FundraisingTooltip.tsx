"use client";

export function FundraisingTooltip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex ml-1.5 align-middle">
      <span className="h-3.5 w-3.5 rounded-full border border-card-border text-[8px] text-muted inline-flex items-center justify-center cursor-help select-none leading-none">
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-[10px] text-muted leading-snug opacity-0 transition-opacity group-hover/tip:opacity-100 z-20 shadow-lg whitespace-normal">
        {text}
      </span>
    </span>
  );
}
