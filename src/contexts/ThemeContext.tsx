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
import { usePathname } from "next/navigation";
import { isLightweightLayoutPath } from "@/lib/constants/layoutPaths";
import { logError } from "@/lib/utils/errorLog";
import { useAuthMe } from "@/contexts/AuthDataContext";

const STORAGE_KEY = "ahd-theme";

export type Theme =
  | "light"
  | "default"
  | "oled"
  | "usa"
  | "pastel"
  | "dark-pastel"
  | "retro"
  | "solarized"
  | "cloakroom"
  | "broadsheet"
  | "coldwar"
  | "command-1953";

const VALID_THEMES: Theme[] = [
  "light",
  "default",
  "oled",
  "usa",
  "pastel",
  "dark-pastel",
  "retro",
  "solarized",
  "cloakroom",
  "broadsheet",
  "coldwar",
  "command-1953",
];

const EXCLUDED_PATHS = ["/", "/login", "/register", "/banned"];

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "default";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (VALID_THEMES.includes(stored as Theme)) {
    return stored as Theme;
  }
  return "default";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user: authUser, loading: authLoading } = useAuthMe();
  const [theme, setThemeState] = useState<Theme>("default");
  const [initialized, setInitialized] = useState(false);
  const [serverThemeSynced, setServerThemeSynced] = useState(false);
  const useStoredThemeOnly =
    EXCLUDED_PATHS.includes(pathname ?? "") || isLightweightLayoutPath(pathname);

  // On public/lightweight pages, skip the auth lookup and use localStorage only.
  // When the user later navigates into the game shell, sync once from the server
  // using the shared AuthDataContext (no extra network request).
  // Syncs theme from localStorage or the shared auth context — sets state after reading
  // an external system (localStorage / server preference), which is the intended use of effects.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (useStoredThemeOnly) {
      setThemeState(getStoredTheme());
      setInitialized(true);
      return;
    }

    if (serverThemeSynced) {
      setInitialized(true);
      return;
    }

    // Wait for the shared auth fetch to complete before reading theme
    if (authLoading) return;

    const themeVal = authUser?.theme;
    if (themeVal && VALID_THEMES.includes(themeVal)) {
      setThemeState(themeVal);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, themeVal);
      }
    } else {
      setThemeState(getStoredTheme());
    }
    setServerThemeSynced(true);
    setInitialized(true);
  }, [serverThemeSynced, useStoredThemeOnly, authLoading, authUser]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!initialized) return;
    const effectiveTheme = EXCLUDED_PATHS.includes(pathname ?? "") ? "default" : theme;
    applyTheme(effectiveTheme);
  }, [pathname, theme, initialized]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      // Persist to user model when logged in
      fetch("/api/settings/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      }).catch((error) => {
        logError(error, {
          component: "ThemeContext",
          action: "persist theme to server",
        });
      });
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "default" as Theme,
      setTheme: () => {},
    };
  }
  return ctx;
}
