"use client";

interface LoadingSpinnerProps {
  /** Label shown below the spinner */
  label?: string;
  /** Size variant: 'sm' (h-6), 'md' (h-8, default), 'lg' (h-12) */
  size?: "sm" | "md" | "lg";
  /** Use min-height for centering in containers */
  centered?: boolean;
  /** Custom className for the container */
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-6 w-6 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-3",
};

/**
 * Reusable loading spinner for page loading states.
 * Used by loading.tsx files for consistent loading UI.
 *
 * @example
 * // Simple usage in loading.tsx
 * export default function CongressLoading() {
 *   return <LoadingSpinner label="Loading Congress..." centered />;
 * }
 */
export function LoadingSpinner({
  label,
  size = "md",
  centered = false,
  className = "",
}: LoadingSpinnerProps) {
  const containerClass = centered
    ? `min-h-[50vh] flex items-center justify-center ${className}`
    : `flex items-center justify-center ${className}`;

  return (
    <div className={containerClass} role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div
          className={`animate-spin rounded-full border-primary border-t-transparent ${SIZE_CLASSES[size]}`}
          aria-hidden
        />
        {label && <p className="text-sm text-muted">{label}</p>}
      </div>
    </div>
  );
}
