"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { cdnStatic } from "@/lib/images/cdnUrls";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { FlavorCard } from "./flavorCards";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type LiveCrisis = {
  _id: string;
  name: string;
  description: string;
  heroImage?: string;
  scope: "global" | "country" | "region";
  countryIds: string[];
};

type DynamicCard = {
  id: string;
  type: "crisis";
  headline: string;
  body: string;
  imageUrl: string;
  tag: string;
};

function crisesToDynamicCards(crises: LiveCrisis[]): DynamicCard[] {
  const COUNTRY_NAMES: Record<string, string> = {
    US: "United States",
    UK: "United Kingdom",
    CN: "China",
    DE: "Germany",
    JP: "Japan",
    BR: "Brazil",
    NG: "Nigeria",
    IE: "Ireland",
    FR: "France",
    IT: "Italy",
    ES: "Spain",
    SE: "Sweden",
    TR: "Turkey",
    SU: "Soviet Union",
    DD: "East Germany",
    PL: "Poland",
    HU: "Hungary",
    RO: "Romania",
    YU: "Yugoslavia",
    CS: "Czechoslovakia",
    BY: "Belarus",
    BAL: "Baltics",
  };

  return crises.map((crisis) => {
    const tag =
      crisis.scope === "global"
        ? "Global Crisis"
        : crisis.scope === "country"
          ? (COUNTRY_NAMES[crisis.countryIds[0]] ?? crisis.countryIds[0] ?? "National Crisis")
          : "Regional Crisis";

    return {
      id: String(crisis._id),
      type: "crisis",
      headline: crisis.name,
      body: crisis.description,
      // Fallback is a self-hosted, license-documented asset (see
      // scripts/landing-images/manifest.json) — never hotlink third-party
      // image services on the public landing page.
      imageUrl: crisis.heroImage ?? cdnStatic("landing", "newsroom"),
      tag,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

const CARD_CLASSES =
  "relative flex-shrink-0 w-[280px] sm:w-[320px] overflow-hidden rounded-xl border border-card-border bg-card shadow-card transition-all duration-300";

const TAG_CLASSES: Record<DynamicCard["type"], string> = {
  crisis: "bg-red-500/15 text-red-400 border-red-500/25",
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function StaticCard({ card, index }: { card: FlavorCard; index: number }) {
  return (
    <div className={CARD_CLASSES}>
      <div className="relative h-[180px] overflow-hidden">
        {/* unoptimized: static Cloudflare CDN art — routing through the Railway image optimizer would add egress */}
        <Image
          src={cdnStatic("flavor-cards", card.imageSlug)}
          alt={card.name}
          fill
          sizes="320px"
          loading="lazy"
          unoptimized={bypassNextImageOptimization(cdnStatic("flavor-cards", card.imageSlug))}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="object-cover object-[center_25%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
        <div className="absolute bottom-2 left-3 right-3">
          <span className="rounded-full border border-card-border bg-card/80 px-2 py-0.5 text-body-xs font-medium text-muted backdrop-blur-sm">
            {card.country}
          </span>
        </div>
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-body-xs text-primary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-body-xs text-muted">{card.year}</span>
        </div>
        <h3 className="text-heading-sm font-semibold text-foreground">{card.name}</h3>
        <p className="mt-0.5 text-body-xs text-muted">{card.title}</p>
        <p className="mt-2 text-body-sm italic leading-relaxed text-muted/80">
          &ldquo;{card.quote}&rdquo;
        </p>
      </div>
    </div>
  );
}

function DynamicCardItem({ card, index }: { card: DynamicCard; index: number }) {
  return (
    <div className={CARD_CLASSES}>
      <div className="relative h-[180px] overflow-hidden">
        {/* unoptimized (unconditional): crisis heroImage is a dynamic external URL — an arbitrary
            host would crash the optimizer's remotePatterns check, and proxying adds Railway egress */}
        <Image
          src={card.imageUrl}
          alt={card.headline}
          fill
          sizes="320px"
          loading="lazy"
          unoptimized
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
        <div className="absolute bottom-2 left-3">
          <span
            className={`rounded-full border px-2 py-0.5 text-body-xs font-medium backdrop-blur-sm ${TAG_CLASSES[card.type]}`}
          >
            {card.tag}
          </span>
        </div>
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-body-xs text-primary">
            {String(index + 4).padStart(2, "0")}
          </span>
        </div>
        <h3 className="text-heading-sm font-semibold text-foreground">{card.headline}</h3>
        <p className="mt-2 text-body-sm leading-relaxed text-muted">{card.body}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Carousel                                                                    */
/* -------------------------------------------------------------------------- */

export function FlavorCardCarousel({
  staticCards,
  crises = [],
}: {
  staticCards: FlavorCard[];
  crises?: LiveCrisis[];
}) {
  const dynamicCards = crisesToDynamicCards(crises);
  const allCards = [
    ...staticCards.map((c) => ({ type: "static" as const, data: c })),
    ...dynamicCards.map((c) => ({ type: "dynamic" as const, data: c })),
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  const maxIndex = Math.max(0, allCards.length - 1);

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
  }, [maxIndex]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev <= 0 ? maxIndex : prev - 1));
  }, [maxIndex]);

  /* Auto-advance */
  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(goNext, 5000);
    return () => clearInterval(timer);
  }, [isPaused, goNext]);

  /* Keyboard navigation */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  /* Touch swipe */
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goNext();
      } else {
        goPrev();
      }
    }
    touchStartX.current = null;
  };

  /* Scroll active card within the carousel track only — never scrollIntoView,
     which would pull the whole page down to the leaders section on mobile. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      return;
    }
    const card = container.children[currentIndex] as HTMLElement | undefined;
    if (!card) return;
    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const scrollLeft =
      container.scrollLeft +
      (cardRect.left - containerRect.left) -
      containerRect.width / 2 +
      cardRect.width / 2;
    container.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, [currentIndex]);

  if (allCards.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Carousel track */}
      <div
        ref={containerRef}
        /* overflow-y-hidden matters: CSS promotes a `visible` axis to `auto`
           when the other axis scrolls, so an overflow-x-only track also became
           vertically scrollable and ate the page's wheel scroll. */
        className="flex gap-4 overflow-x-auto overflow-y-hidden scroll-smooth pb-4 pt-1 scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {allCards.map((card, i) =>
          card.type === "static" ? (
            <StaticCard key={card.data.id} card={card.data} index={i} />
          ) : (
            <DynamicCardItem key={card.data.id} card={card.data} index={i} />
          )
        )}
      </div>

      {/* Navigation arrows */}
      <button
        onClick={goPrev}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 rounded-full border border-card-border bg-card/90 p-2 text-foreground shadow-lg backdrop-blur-sm transition-all hover:bg-card hover:scale-105 active:scale-95"
        aria-label="Previous card"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        onClick={goNext}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 rounded-full border border-card-border bg-card/90 p-2 text-foreground shadow-lg backdrop-blur-sm transition-all hover:bg-card hover:scale-105 active:scale-95"
        aria-label="Next card"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* Dots */}
      <div className="mt-2 flex justify-center gap-2">
        {allCards.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            className={`h-2 rounded-full transition-all ${
              i === currentIndex ? "w-6 bg-primary" : "w-2 bg-muted/40 hover:bg-muted/60"
            }`}
            aria-label={`Go to card ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
