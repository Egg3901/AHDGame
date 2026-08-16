"use client";

import { forwardRef } from "react";

const inputBase =
  "block w-full rounded-lg border border-card-border bg-card px-4 py-3 text-base text-foreground placeholder-muted transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary focus:shadow-glow-sm";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${inputBase} bg-card ${className}`.trim()} {...props} />;
  }
);
