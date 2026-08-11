"use client";

export function LevelBar({
  level,
  max = 5,
  barClass,
}: {
  level: number;
  max?: number;
  barClass: string;
}) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-sm ${i < level ? barClass : "bg-card-border"}`}
        />
      ))}
    </div>
  );
}
