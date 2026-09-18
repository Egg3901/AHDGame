/**
 * Forwarder. Moved into RU's country folder.
 *
 * A SIDE-EFFECTING IMPORT, NOT A RE-EXPORT: this module registers handlers and
 * exports nothing, so there is no binding to forward and a re-export would
 * drop the registration.
 */
import "@/lib/countries/ru/ruEraEvents";
