export interface ClaimWindow {
  startHour: number;
  endHour: number;
  timeZone: string;
}

export function parseClaimWindow(value: string | undefined, timeZone = "America/New_York"): ClaimWindow | null {
  if (!value) return null;
  const match = /^(\d{2}):00-(\d{2}):00$/.exec(value);
  if (!match) throw new Error("SIM_WORKER_CLAIM_WINDOW must use HH:00-HH:00");
  const startHour = Number(match[1]);
  const endHour = Number(match[2]);
  if (startHour > 23 || endHour > 24 || startHour === endHour) throw new Error("SIM_WORKER_CLAIM_WINDOW has invalid hours");
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  return { startHour, endHour, timeZone };
}

export function canClaimAt(now: Date, window: ClaimWindow | null): boolean {
  if (!window) return true;
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: window.timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  if (window.startHour < window.endHour) return hour >= window.startHour && hour < window.endHour;
  return hour >= window.startHour || hour < window.endHour;
}
