import type { Metadata } from "next";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import VacanciesPanel from "@/components/officials/VacanciesPanel";
import type { ElectedOfficial } from "@/lib/db/types";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { isFilledOfficial } from "@/lib/governors/senateVacancy";
import { US_SENATE_2020 } from "@/lib/constants/historicalSeats";

export const metadata: Metadata = {
  ...publicPageMetadata({
    title: "Officials & Vacancies | A House Divided",
    description:
      "Browse current player and NPC elected officials across the simulation and find vacant offices you can run for in the next election cycle.",
    pathname: "/officials",
  }),
  robots: {
    index: false,
    follow: true,
  },
};

export default async function OfficialsPage() {
  const user = await getAuthUserWithCharacter();
  const db = await getDb();
  const officialsCollection = db.collection<ElectedOfficial>("electedOfficials");

  // Check if user is a governor
  let isGovernor = false;
  let governorState: string | undefined;

  if (user?.character) {
    const governorOfficial = await officialsCollection.findOne({
      characterId: user.character._id,
      officeType: "governor",
    });

    if (governorOfficial && governorOfficial.state) {
      isGovernor = true;
      governorState = governorOfficial.state;
    }
  }

  // Get Senate officials, states, and Governor officials in one round
  const [senateOfficials, states, governorOfficials] = await Promise.all([
    officialsCollection.find({ officeType: "senate" }).toArray(),
    db
      .collection("states")
      .find({}, { projection: { abbreviation: 1 } })
      .toArray(),
    officialsCollection.find({ officeType: "governor" }).toArray(),
  ]);

  // Build map of filled seats
  const filledSeats = new Map<string, boolean>();
  senateOfficials.forEach((off) => {
    if (off.state && off.senateClass && isFilledOfficial(off)) {
      filledSeats.set(`${off.state}-${off.senateClass}`, true);
    }
  });

  // Check for Senate vacancies
  const senateVacancies: Array<{ state: string; senateClass: number }> = [];
  US_SENATE_2020.forEach((seat) => {
    if (seat.senateClass && !filledSeats.has(`${seat.state}-${seat.senateClass}`)) {
      senateVacancies.push({
        state: seat.state,
        senateClass: seat.senateClass,
      });
    }
  });

  const stateAbbreviations = states.map((s) => s.abbreviation);

  // Get Governor vacancies
  const governorStates = new Set(governorOfficials.map((g) => g.state));
  const governorVacancies = stateAbbreviations
    .filter((state) => !governorStates.has(state))
    .map((state) => ({ state }));

  // House vacancies would require a districts table - skip for now
  const houseVacancies: Array<{ state: string; district?: number }> = [];

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Officials & Vacancies</h1>
        <p className="mt-2 text-muted">View current elected officials and vacant offices</p>
      </div>

      <VacanciesPanel
        senateVacancies={senateVacancies}
        houseVacancies={houseVacancies}
        governorVacancies={governorVacancies}
        isGovernor={isGovernor}
        governorState={governorState}
      />
    </div>
  );
}
