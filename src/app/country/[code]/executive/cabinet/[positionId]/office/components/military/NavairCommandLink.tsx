"use client";

import Link from "next/link";
import { SectionCard } from "../dossier";
import { navairUrl } from "@/lib/urls";

/**
 * The way into naval and air command from the defence office.
 *
 * The fleet orders — station, mission, Blockade — live on their own page at
 * `/country/<code>/navair`, which already owns the whole force in one screen. But
 * nothing in this office linked to it: support told a player to find
 * "Defence office > Commands > Naval and air command" and the tab had no such
 * control anywhere (ticket #1243). The one route in was the country lander's
 * directory row, which a player following the support path never thinks to check.
 *
 * Not a second command surface: one door, labelled with what it is, on the tab the
 * support copy names. The page itself still gates on the seat server side, so the
 * link renders for the whole department while the page keeps its own answer for
 * anyone who is not the officeholder.
 */
export function NavairCommandLink({ countryCode }: { countryCode: string }) {
  return (
    <SectionCard
      title="Naval and air command"
      sub="Stations and missions for the fleet and air force, including the Blockade posture"
    >
      <p className="text-[12px] text-muted">
        Hulls and wings are commanded from one screen, not from this roster. Where each formation is
        stationed and what it is doing — sea control, blockade of an enemy&apos;s trade approaches,
        close air support — is set at{" "}
        <Link
          href={navairUrl(countryCode)}
          className="font-semibold text-foreground underline decoration-dotted underline-offset-2 hover:text-gov-soft"
        >
          Naval and air command
        </Link>
        .
      </p>
    </SectionCard>
  );
}
