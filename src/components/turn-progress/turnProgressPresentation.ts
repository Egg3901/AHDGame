export function describeTurnPhase(phase: string | null, label: string | null): string {
  const key = (phase ?? "").toLowerCase();
  if (/elect|vote|primary|referendum/.test(key)) return "Counting votes and resolving elections";
  if (/market|corp|bank|forex|econom|trade|production|wage|tax/.test(key))
    return "Updating markets and the economy";
  if (/war|military|conflict|defen|army|navy|nuclear/.test(key))
    return "Resolving conflicts and military affairs";
  if (/bill|legislat|policy|law|court|judic/.test(key)) return "Advancing laws and public policy";
  if (/party|approval|campaign|opinion|ideolog/.test(key))
    return "Updating parties and public opinion";
  if (/population|demograph|migration|health|education/.test(key))
    return "Updating people and public services";
  if (!label) return "Preparing the next turn";
  return `Updating ${label.toLowerCase()}`;
}
