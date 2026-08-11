"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Toast, type ToastVariant } from "@/components/ui/Toast";

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    variant: ToastVariant;
  } | null>(null);

  const showToast = useCallback((message: string, variant: ToastVariant = "success") => {
    setToast({ id: Date.now(), message, variant });
  }, []);

  const handleClose = useCallback(() => {
    setToast(null);
  }, []);

  // Memoized so consumers don't re-render on every toast open/close — the value
  // only carries the stable showToast callback.
  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          variant={toast.variant}
          onClose={handleClose}
        />
      )}
    </ToastContext.Provider>
  );
}

// Module-level constant so the outside-provider fallback keeps a stable identity.
const NOOP_TOAST: ToastContextValue = { showToast: () => {} };

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return NOOP_TOAST;
  }
  return ctx;
}
