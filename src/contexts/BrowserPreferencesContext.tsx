"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BROWSER_PREFERENCES_STORAGE_KEY,
  DEFAULT_BROWSER_PREFERENCES,
  parseBrowserPreferences,
  type BrowserPreferences,
} from "@/lib/browserPreferences";

interface BrowserPreferencesContextValue {
  preferences: BrowserPreferences;
  updatePreferences: (updates: Partial<BrowserPreferences>) => void;
  replacePreferences: (preferences: BrowserPreferences) => void;
  resetPreferences: () => void;
}

const BrowserPreferencesContext = createContext<BrowserPreferencesContextValue | null>(null);

function applyPreferences(preferences: BrowserPreferences) {
  document.documentElement.dataset.reduceMotion = preferences.reducedMotion ? "true" : "false";
  document.documentElement.dataset.highContrast = preferences.highContrast ? "true" : "false";
  document.documentElement.lang = preferences.language;
}

export function BrowserPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<BrowserPreferences>(DEFAULT_BROWSER_PREFERENCES);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate device preferences after mount */
  useEffect(() => {
    const stored = parseBrowserPreferences(
      window.localStorage.getItem(BROWSER_PREFERENCES_STORAGE_KEY)
    );
    setPreferences(stored);
    applyPreferences(stored);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const replacePreferences = useCallback((next: BrowserPreferences) => {
    const safe = parseBrowserPreferences(next);
    setPreferences(safe);
    applyPreferences(safe);
    window.localStorage.setItem(BROWSER_PREFERENCES_STORAGE_KEY, JSON.stringify(safe));
  }, []);

  const updatePreferences = useCallback((updates: Partial<BrowserPreferences>) => {
    setPreferences((current) => {
      const next = parseBrowserPreferences({ ...current, ...updates });
      applyPreferences(next);
      window.localStorage.setItem(BROWSER_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    replacePreferences(DEFAULT_BROWSER_PREFERENCES);
  }, [replacePreferences]);

  const value = useMemo(
    () => ({ preferences, updatePreferences, replacePreferences, resetPreferences }),
    [preferences, replacePreferences, resetPreferences, updatePreferences]
  );

  return (
    <BrowserPreferencesContext.Provider value={value}>
      {children}
    </BrowserPreferencesContext.Provider>
  );
}

export function useBrowserPreferences() {
  const context = useContext(BrowserPreferencesContext);
  if (!context) {
    return {
      preferences: DEFAULT_BROWSER_PREFERENCES,
      updatePreferences: () => {},
      replacePreferences: () => {},
      resetPreferences: () => {},
    };
  }
  return context;
}
