/** Russian presidential tickets need distinct eligible running mates. */
export function chooseRussianNpcRunningMate(
  party: string,
  pool: readonly { id: string; party: string; officeType?: string }[],
  reservedIds: ReadonlySet<string>
): string | null {
  return (
    pool
      .filter(
        (person) =>
          person.party === party && !reservedIds.has(person.id) && person.officeType !== "president"
      )
      .map((person) => person.id)
      .sort()[0] ?? null
  );
}
