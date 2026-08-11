"use client";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  children: React.ReactNode;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white font-semibold hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50",
  secondary:
    "border border-card-border bg-card text-foreground font-medium hover:bg-card/80 hover:border-muted/40 disabled:opacity-50",
  ghost: "text-muted font-medium hover:bg-card hover:text-foreground disabled:opacity-50",
  destructive: "bg-error text-white font-semibold hover:brightness-105 disabled:opacity-50",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-md",
  md: "h-9 px-3.5 text-[13px] rounded-lg",
  lg: "h-11 px-4.5 text-sm rounded-lg",
};

// Icon-only buttons keep their visual size but extend the tap target to a
// minimum of 40x40px via an invisible ::after overlay (no layout change).
const ICON_ONLY_HIT_AREA =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[max(100%,2.5rem)] after:w-[max(100%,2.5rem)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

const iconOnlySizeStyles: Record<ButtonSize, string> = {
  sm: `h-7 w-7 p-0 rounded-md ${ICON_ONLY_HIT_AREA}`,
  md: `h-9 w-9 p-0 rounded-lg ${ICON_ONLY_HIT_AREA}`,
  lg: "h-11 w-11 p-0 rounded-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  iconOnly = false,
  children,
  isLoading = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-primary";
  const sizing = iconOnly ? iconOnlySizeStyles[size] : sizeStyles[size];

  return (
    <button
      type="button"
      className={`${base} ${sizing} ${variantStyles[variant]} ${className}`.trim()}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="32"
            strokeDashoffset="12"
          />
        </svg>
      ) : (
        children
      )}
    </button>
  );
}
