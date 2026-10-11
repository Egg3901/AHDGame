export type PrivateCorpTabAccess = "all" | "parent-insider" | "mod-view" | "restricted";

export interface PrivateCorpTabAccessInput {
  isPrivate: boolean;
  isCeo: boolean;
  viewerIsControllingParentCeo: boolean;
  modViewEnabled: boolean;
}

export function getPrivateCorpTabAccess({
  isPrivate,
  isCeo,
  viewerIsControllingParentCeo,
  modViewEnabled,
}: PrivateCorpTabAccessInput): PrivateCorpTabAccess {
  if (!isPrivate || isCeo) return "all";
  if (viewerIsControllingParentCeo) return "parent-insider";
  return modViewEnabled ? "mod-view" : "restricted";
}

export function filterPrivateCorpBaseTabs<T extends { id: string }>(
  tabs: readonly T[],
  access: PrivateCorpTabAccess
): T[] {
  if (access === "restricted") {
    return tabs.filter((tab) => tab.id === "overview" || tab.id === "sectors");
  }
  if (access === "mod-view" || access === "parent-insider") {
    return tabs.filter((tab) => tab.id !== "shares");
  }
  return [...tabs];
}
