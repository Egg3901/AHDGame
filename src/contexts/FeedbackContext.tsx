"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

const MAX_RECENT_ACTIONS = 5;

const PAGE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/map": "Map",
  "/elections": "Elections",
  "/congress": "Congress",
  "/parties": "Political Parties",
  "/politicians": "Politicians",
  "/policy": "Policy",
  "/national": "National Metrics",
  "/country/us/parties": "US Political Parties",
  "/country/uk/parties": "UK Political Parties",
  "/country/us/politicians": "US Politicians",
  "/country/uk/politicians": "UK Politicians",
  "/country/us/policy": "US Policy",
  "/country/uk/policy": "UK Policy",
  "/country/us/metrics": "US National Metrics",
  "/country/uk/metrics": "UK National Metrics",
  "/country/us/approval": "US Approval & Active Effects",
  "/country/uk/approval": "UK Approval & Active Effects",
  "/country/us/budget": "US Budget",
  "/country/uk/budget": "UK Budget",
  "/centralbank/usd": "Federal Reserve",
  "/centralbank/gbp": "Bank of England",
  "/country/us/elections": "US Elections",
  "/country/uk/elections": "UK Elections",
  "/country/us/stockmarket": "US Stock Market",
  "/country/uk/stockmarket": "UK Stock Market",
  "/notifications": "Notifications",
  "/actions": "Actions",
  "/profile": "Profile",
  "/settings": "Settings",
  "/admin": "Admin Panel",
  "/wiki": "Wiki",
  "/whitehouse": "White House",
  "/whitehouse/cabinet": "Cabinet",
  "/executive/us": "White House",
  "/executive/us/cabinet": "Cabinet",
  "/executive/uk": "UK Government",
  "/executive/uk/cabinet": "UK Cabinet",
  "/country/us/executive": "White House",
  "/country/us/executive/cabinet": "Cabinet",
  "/country/uk/executive": "UK Government",
  "/country/uk/executive/cabinet": "UK Cabinet",
};

function getPageLabel(pathname: string): string {
  if (PAGE_LABELS[pathname]) return `Viewed ${PAGE_LABELS[pathname]}`;
  const stateMatch = pathname.match(/^\/state\/([A-Z]{2})/);
  if (stateMatch) return `Viewed State ${stateMatch[1]}`;
  const regionMatch = pathname.match(/^\/country\/([a-z]{2,3})\/region\/([A-Z_]+)/);
  if (regionMatch) return `Viewed Region ${regionMatch[2]}`;
  const electionMatch = pathname.match(/^\/elections\//);
  if (electionMatch) return "Viewed election detail";
  const partyMatch = pathname.match(/^\/parties\//);
  if (partyMatch) return "Viewed party page";
  const execMatch = pathname.match(/^\/executive\/([a-z]{2})(\/cabinet)?/);
  if (execMatch) return execMatch[2] ? "Viewed Cabinet" : "Viewed Executive";
  const newExecMatch = pathname.match(/^\/country\/([a-z]{2,3})\/executive(\/cabinet)?/);
  if (newExecMatch) return newExecMatch[2] ? "Viewed Cabinet" : "Viewed Executive";
  const mapMatch = pathname.match(/^\/country\/([a-z]{2,3})\/map/);
  if (mapMatch) return `Viewed ${mapMatch[1].toUpperCase()} Map`;
  return `Viewed ${pathname || "/"}`;
}

export interface CapturedAction {
  label: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface FeedbackContextSnapshot {
  pathname: string;
  url: string;
  capturedAt: string;
  lastAction?: CapturedAction;
  recentActions: CapturedAction[];
  userAgent: string;
  viewport: { width: number; height: number };
  referrer?: string;
}

interface FeedbackContextValue {
  recordAction: (label: string, metadata?: Record<string, unknown>) => void;
  getContextSnapshot: () => FeedbackContextSnapshot;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [recentActions, setRecentActions] = useState<CapturedAction[]>([]);
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (pathname && pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      const label = getPageLabel(pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync recent actions with route
      setRecentActions((prev) => {
        const action: CapturedAction = {
          label,
          timestamp: new Date().toISOString(),
          metadata: { pathname },
        };
        return [action, ...prev].slice(0, MAX_RECENT_ACTIONS);
      });
    }
  }, [pathname]);

  const recordAction = useCallback((label: string, metadata?: Record<string, unknown>) => {
    const action: CapturedAction = {
      label,
      timestamp: new Date().toISOString(),
      metadata,
    };
    setRecentActions((prev) => {
      const next = [action, ...prev].slice(0, MAX_RECENT_ACTIONS);
      return next;
    });
  }, []);

  const getContextSnapshot = useCallback((): FeedbackContextSnapshot => {
    const now = new Date();
    return {
      pathname: pathname ?? window.location.pathname,
      url: typeof window !== "undefined" ? window.location.href : "",
      capturedAt: now.toISOString(),
      lastAction: recentActions[0],
      recentActions: [...recentActions],
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      viewport:
        typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight }
          : { width: 0, height: 0 },
      referrer:
        typeof document !== "undefined" && document.referrer ? document.referrer : undefined,
    };
  }, [pathname, recentActions]);

  const value = useMemo(
    () => ({ recordAction, getContextSnapshot }),
    [recordAction, getContextSnapshot]
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    return {
      recordAction: () => {},
      getContextSnapshot: (): FeedbackContextSnapshot => ({
        pathname: typeof window !== "undefined" ? window.location.pathname : "",
        url: typeof window !== "undefined" ? window.location.href : "",
        capturedAt: new Date().toISOString(),
        lastAction: undefined,
        recentActions: [],
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        viewport:
          typeof window !== "undefined"
            ? { width: window.innerWidth, height: window.innerHeight }
            : { width: 0, height: 0 },
        referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      }),
    };
  }
  return ctx;
}
