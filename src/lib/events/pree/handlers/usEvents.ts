/**
 * Forwarder. Moved to the United States' country folder.
 *
 * ⚠️ A SIDE-EFFECTING IMPORT, NOT A RE-EXPORT. This module registers event
 * handlers and exports nothing, so there is no binding to forward. The bare
 * import is what keeps the registration happening for anyone reaching this path.

 * ⚠️ It registers handlers through `registerEventHandler` and exports nothing, so there is no binding to forward; the bare import is what keeps the registration happening.
 */
import "@/lib/countries/us/events";
