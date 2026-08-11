"use client";

import { useState, useEffect, useCallback } from "react";
import { EmptyState } from "@/components/ui";
import { LawTypeCard } from "./LawTypeCard";
import { LawTypeWizard } from "./LawTypeWizard";
import type { LegislationType } from "@/lib/db/types";

interface LawTypeWithMeta extends LegislationType {
  source: "seed" | "admin";
  isPermanent?: boolean;
}

export function LawTypesTab() {
  const [lawTypes, setLawTypes] = useState<LawTypeWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [editingType, setEditingType] = useState<LawTypeWithMeta | null>(null);
  const [domainFilter, setDomainFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchLawTypes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/law-types");
      if (res.ok) {
        const data = await res.json();
        setLawTypes(data.lawTypes);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLawTypes();
  }, [fetchLawTypes]);

  const handleCreate = () => {
    setEditingType(null);
    setShowWizard(true);
  };

  const handleEdit = (type: LawTypeWithMeta) => {
    setEditingType(type);
    setShowWizard(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this law type?")) return;

    setMessage("");
    const res = await fetch(`/api/admin/law-types/${id}`, { method: "DELETE" });
    const data = await res.json();
    setMessage(res.ok ? data.message : `Error: ${data.error}`);
    if (res.ok) fetchLawTypes();
  };

  const handleMakePermanent = async (id: string) => {
    setMessage("");
    const res = await fetch(`/api/admin/law-types/${id}/make-permanent`, { method: "POST" });
    const data = await res.json();
    setMessage(res.ok ? data.message : `Error: ${data.error}`);
    if (res.ok) fetchLawTypes();
  };

  const handleRemovePermanent = async (id: string) => {
    if (!confirm("Remove from permanent storage? The law will be deleted on next reset.")) return;

    setMessage("");
    const res = await fetch(`/api/admin/law-types/${id}/remove-permanent`, { method: "POST" });
    const data = await res.json();
    setMessage(res.ok ? data.message : `Error: ${data.error}`);
    if (res.ok) fetchLawTypes();
  };

  const handleWizardClose = (saved: boolean) => {
    setShowWizard(false);
    setEditingType(null);
    if (saved) fetchLawTypes();
  };

  // Get unique domains for filter
  const domains = [...new Set(lawTypes.map((t) => t.policyDomain))].sort();

  // Filter law types
  const filteredTypes = lawTypes.filter((t) => {
    if (domainFilter !== "all" && t.policyDomain !== domainFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t._id.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (showWizard) {
    return <LawTypeWizard initialData={editingType} onClose={handleWizardClose} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Law Types</h2>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          + Create New Law Type
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All Domains</option>
          {domains.map((d) => (
            <option key={d} value={d} className="capitalize">
              {d}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
      </div>

      {/* Message */}
      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.startsWith("Error")
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-green-500/30 bg-green-500/10 text-green-400"
          }`}
        >
          {message}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-muted text-sm">
          Loading...
        </div>
      ) : filteredTypes.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8">
          <EmptyState
            title="No law types found"
            description={
              searchQuery || domainFilter !== "all"
                ? "Try adjusting your filters."
                : "Create your first law type to get started."
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTypes.map((type) => (
            <LawTypeCard
              key={type._id}
              lawType={type}
              onEdit={() => handleEdit(type)}
              onDelete={() => handleDelete(type._id)}
              onMakePermanent={() => handleMakePermanent(type._id)}
              onRemovePermanent={() => handleRemovePermanent(type._id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
