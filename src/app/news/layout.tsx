export const metadata = {
  title: "National News | A House Divided",
  description: "Political updates and news from across the nation",
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div
        role="note"
        aria-label="In-character content notice"
        className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-900 sm:text-sm dark:text-amber-200"
      >
        <span className="font-semibold uppercase tracking-wide">In-character</span>
        <span className="mx-2 opacity-50">·</span>
        Posts and headlines are written by players inside a fictional political simulation. They are
        not real news and do not represent the views of any real person, party, or government.
      </div>
      {children}
    </>
  );
}
