/**
 * Central registry for event handlers (PREE, future UCE).
 */
import type { EventHandler } from "./types";
import { validateOutcomeTable } from "./tiers";

const handlers = new Map<string, EventHandler>();

export function registerEventHandler(handler: EventHandler): void {
  for (const option of handler.options) {
    validateOutcomeTable(option.outcomeTable);
  }
  handlers.set(handler.kind, handler);
}

export function getEventHandler(kind: string): EventHandler | undefined {
  return handlers.get(kind);
}

export function getDefaultOptionId(kind: string): string | undefined {
  return handlers.get(kind)?.defaultOptionId;
}

/** Test-only: clear all registered handlers. */
export function _resetEventHandlerRegistryForTests(): void {
  handlers.clear();
}
