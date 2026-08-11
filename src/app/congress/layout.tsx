/**
 * Congress layout — establishes segment tree so nested error boundaries
 * (bills/[id], nominations/[id]) catch errors before this one.
 */
export default function CongressLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
