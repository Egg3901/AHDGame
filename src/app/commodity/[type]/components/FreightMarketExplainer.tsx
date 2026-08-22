export default function FreightMarketExplainer() {
  return (
    <div className="mb-4 rounded-xl border border-info/25 bg-info/5 px-5 py-4">
      <p className="text-xs font-bold uppercase tracking-wider text-info">How freight works</p>
      <p className="mt-1 text-sm text-muted">
        Freight is one shared service market. Bulk and special are cargo load types, not separate
        freight products or reserved capacity pools. Both use the same state fleet, while special
        cargo uses three times as much TEU per unit.
      </p>
      <p className="mt-2 text-xs text-muted">
        This page shows total supply and demand across every logistics operator. A corporation
        sector&apos;s sold percentage shows only the share captured by that sector, so it can differ
        from the market total.
      </p>
    </div>
  );
}
