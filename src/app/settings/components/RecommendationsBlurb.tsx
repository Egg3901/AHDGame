"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { type SectionId } from "./shared";
import { type Recommendation } from "./sectionsConfig";

export function RecommendationsBlurb({
  recommendations,
  onSelectSection,
}: {
  recommendations: Recommendation[];
  onSelectSection: (id: SectionId) => void;
}) {
  const t = useTranslations("settings");
  const [index, setIndex] = useState(0);
  const active = recommendations[index % recommendations.length];

  useEffect(() => {
    if (recommendations.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % recommendations.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [recommendations.length]);

  const handleClick = () => {
    if (!active) return;
    if (active.action === "section" && active.sectionId) {
      onSelectSection(active.sectionId);
    } else if (active.action === "link" && active.href) {
      window.location.href = active.href;
    }
  };

  if (!active) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card-muted/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleClick}
          className="flex flex-1 items-center gap-2 text-left text-sm text-foreground hover:text-primary transition-colors"
        >
          <span className="text-primary">{active.icon}</span>
          <span className="font-medium">{active.label}</span>
          <svg
            className="ml-auto h-4 w-4 shrink-0 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {recommendations.length > 1 && (
        <div className="mt-2 flex justify-center gap-1">
          {recommendations.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={t("recommendations.itemAria", { number: i + 1 })}
              onClick={() => setIndex(i)}
              className={`h-1 rounded-full transition-all ${
                i === index ? "w-4 bg-primary" : "w-1.5 bg-card-border hover:bg-muted"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
