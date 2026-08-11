"use client";

interface SkeletonProps {
  className?: string;
}

/**
 * Pulse placeholder for loading states.
 * Use for cards, text lines, avatars, etc.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded-lg bg-card-border ${className}`} aria-hidden />;
}
