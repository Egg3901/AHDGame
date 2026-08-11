"use client";

import { forwardRef, useCallback, useRef, useEffect } from "react";

type SliderVariant = "primary" | "warning" | "error" | "success" | "secondary" | "muted";

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Color variant for the slider */
  variant?: SliderVariant;
  /** Show value tooltip on hover/drag */
  showTooltip?: boolean;
  /** Format the tooltip value */
  formatTooltip?: (value: number) => string;
}

/**
 * Styled range slider with theme support and color variants.
 *
 * Uses CSS custom properties for theming, supports all standard input[range] props.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    variant = "primary",
    showTooltip: _showTooltip = false,
    formatTooltip,
    className = "",
    onChange,
    value,
    defaultValue,
    min = 0,
    max = 100,
    ...props
  },
  forwardedRef
) {
  const internalRef = useRef<HTMLInputElement>(null);

  // Update the fill gradient for WebKit browsers
  // Uses the controlled value prop (if provided) to ensure fill matches the actual value,
  // not the raw slider position (important when value is capped by parent)
  const updateFill = useCallback(
    (overrideValue?: number) => {
      const input = internalRef.current;
      if (!input) return;

      const minVal = parseFloat(String(min));
      const maxVal = parseFloat(String(max));
      // Use override value, then controlled value prop, then input.value
      const currentVal =
        overrideValue !== undefined
          ? overrideValue
          : value !== undefined
            ? parseFloat(String(value))
            : parseFloat(input.value);
      const percentage = Math.max(
        0,
        Math.min(100, ((currentVal - minVal) / (maxVal - minVal)) * 100)
      );

      // Use CSS variable for the color, with border-radius to match track
      input.style.background = `linear-gradient(to right, var(--slider-color) 0%, var(--slider-color) ${percentage}%, var(--track) ${percentage}%, var(--track) 100%)`;
    },
    [min, max, value]
  );

  // Update fill when value changes (after React re-renders with potentially capped value)
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM is updated with controlled value
    requestAnimationFrame(() => {
      updateFill();
    });
  }, [value, defaultValue, updateFill]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Don't update fill here - let the useEffect handle it after React
    // re-renders with the (potentially capped) controlled value
    onChange?.(e);
  };

  // Combine refs
  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      internalRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef]
  );

  const variantClass = `ahd-slider-${variant}`;

  return (
    <input
      ref={setRefs}
      type="range"
      min={min}
      max={max}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      className={`ahd-slider ${variantClass} ${className}`.trim()}
      {...props}
    />
  );
});
