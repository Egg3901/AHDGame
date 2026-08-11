"use client";

import { useState, useRef, useEffect } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";

interface MobileSelectOption {
  value: string;
  label: string;
}

interface MobileSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: MobileSelectOption[];
  placeholder?: string;
  className?: string;
  label?: string;
}

/**
 * Mobile-friendly select component that uses a scrollable bottom sheet modal
 * instead of the native select picker (which can have scrolling issues on some devices).
 */
export function MobileSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className = "",
  label,
}: MobileSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Filter options based on search query
  const filteredOptions = searchQuery
    ? options.filter((opt) => opt.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  // Handle click outside to close — also clears the search query.
  useClickOutside(modalRef, isOpen, () => {
    setIsOpen(false);
    setSearchQuery("");
  });

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Small delay to ensure the modal is rendered
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setIsOpen(false);
    setSearchQuery("");
  };

  return (
    <>
      {/* Trigger button styled like a select */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-left transition-colors hover:border-primary/50 ${className}`}
      >
        <span className={selectedOption ? "text-foreground" : "text-muted"}>
          {selectedOption?.label || placeholder}
        </span>
        <svg
          className="h-4 w-4 text-muted shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            ref={modalRef}
            className="w-full max-w-md max-h-[min(500px,80vh)] bg-card border border-card-border rounded-2xl shadow-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-card-border px-4 py-3 shrink-0">
              <h3 className="font-semibold text-foreground">{label || placeholder}</h3>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setSearchQuery("");
                }}
                className="rounded-lg p-1 text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Search input (only show if many options) */}
            {options.length > 10 && (
              <div className="px-4 py-2 border-b border-card-border shrink-0">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  // 16px font size on mobile so iOS Safari doesn't auto-zoom on focus.
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-base md:text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}

            {/* Options list - scrollable */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {filteredOptions.length === 0 ? (
                <div className="px-4 py-8 text-center text-muted text-sm">No options found</div>
              ) : (
                <div className="py-1">
                  {filteredOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-elevated ${
                        option.value === value ? "bg-primary/10" : ""
                      }`}
                    >
                      {/* Radio indicator */}
                      <span
                        className={`shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          option.value === value
                            ? "border-primary bg-primary"
                            : "border-card-border"
                        }`}
                      >
                        {option.value === value && (
                          <span className="h-2 w-2 rounded-full bg-white" />
                        )}
                      </span>
                      <span
                        className={`text-sm ${option.value === value ? "text-primary font-medium" : "text-foreground"}`}
                      >
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
