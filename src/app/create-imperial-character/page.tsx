"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { State } from "@/lib/db/types";

interface EligibleCountry {
  countryId: string;
  name: string;
  titles: { male: string; female: string; nonbinary: string };
}

export default function CreateImperialCharacterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [eligibleCountries, setEligibleCountries] = useState<EligibleCountry[]>([]);
  const [states, setStates] = useState<State[]>([]);

  const [country, setCountry] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "nonbinary" | "">("");
  const [royalHouse, setRoyalHouse] = useState("");
  const [homeState, setHomeState] = useState("");
  const [bio, setBio] = useState("");

  const selectedCountry = eligibleCountries.find((c) => c.countryId === country);
  const titlePreview =
    selectedCountry && gender
      ? selectedCountry.titles[gender as keyof typeof selectedCountry.titles]
      : null;

  const filteredStates = country
    ? states.filter((s) => (s.countryId ?? "US").toLowerCase() === country.toLowerCase())
    : [];

  // Scroll to error when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  // Auth check: require admin
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          router.replace("/login?returnUrl=" + encodeURIComponent("/create-imperial-character"));
          return;
        }
        const data = await res.json();
        // Check both isAdmin flag and role field for robustness
        if (!data.user?.isAdmin && data.user?.role !== "admin") {
          router.replace("/settings");
          return;
        }
        setAuthChecked(true);
      } catch {
        router.replace("/login?returnUrl=" + encodeURIComponent("/create-imperial-character"));
      }
    };
    checkAuth();
  }, [router]);

  // Fetch eligible countries and states
  useEffect(() => {
    if (!authChecked) return;
    const fetchData = async () => {
      try {
        const [eligibleRes, statesRes] = await Promise.all([
          fetch("/api/imperial-characters/eligible"),
          fetch("/api/game/states?playableHome=1"),
        ]);
        if (eligibleRes.ok) {
          const data = await eligibleRes.json();
          setEligibleCountries(data.countries ?? []);
        }
        if (statesRes.ok) setStates(await statesRes.json());
      } catch (err) {
        console.error("Failed to fetch initial data:", err);
      }
    };
    fetchData();
  }, [authChecked]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!country || !name || !gender || !royalHouse || !homeState) {
      setError("All fields are required.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/imperial-characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryId: country,
          name,
          gender,
          royalHouse,
          homeState,
          bio: bio || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create imperial character.");
        setIsLoading(false);
        return;
      }

      router.push(`/imperial/${data.sequentialId}`);
    } catch {
      setError("An unexpected error occurred.");
      setIsLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (eligibleCountries.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">No Eligible Countries</h1>
        <p className="text-muted">
          All eligible countries already have an imperial character, or no countries support
          imperial characters.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:py-16">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Create Imperial Character</h1>
        <p className="mt-2 text-sm text-muted">Create a ceremonial head of state for a country.</p>
      </div>

      {error && (
        <div
          ref={errorRef}
          className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Country */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
            Country
          </label>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setHomeState("");
            }}
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-foreground"
          >
            <option value="">Select a country...</option>
            {eligibleCountries.map((c) => (
              <option key={c.countryId} value={c.countryId}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Arthur Vale, Aiko Mori"
            maxLength={50}
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted/50"
          />
          <p className="mt-1 text-xs text-muted">
            2–50 characters. The title ({titlePreview ?? "King/Emperor"}) is added automatically.
          </p>
        </div>

        {/* Gender */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
            Gender
          </label>
          <div className="flex gap-2">
            {(["male", "female", "nonbinary"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                  gender === g
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-card-border bg-card text-muted hover:text-foreground"
                }`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          {titlePreview && (
            <p className="mt-2 text-xs text-primary">
              Title: <span className="font-semibold">{titlePreview}</span>
              {name && (
                <span>
                  {" "}
                  — displayed as &ldquo;{titlePreview} {name}&rdquo;
                </span>
              )}
            </p>
          )}
        </div>

        {/* Royal House */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
            Royal House
          </label>
          <input
            type="text"
            value={royalHouse}
            onChange={(e) => setRoyalHouse(e.target.value)}
            placeholder="e.g., House of Windsor"
            maxLength={80}
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted/50"
          />
        </div>

        {/* Home Province */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
            Home Province
          </label>
          <select
            value={homeState}
            onChange={(e) => setHomeState(e.target.value)}
            disabled={!country}
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-foreground disabled:opacity-50"
          >
            <option value="">{country ? "Select a province..." : "Select a country first"}</option>
            {filteredStates.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Also sets the headquarters for the starter corporation.
          </p>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
            Bio{" "}
            <span className="font-normal normal-case tracking-normal text-muted/60">
              (optional)
            </span>
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Write a short biography..."
            maxLength={500}
            rows={3}
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted/50 resize-none"
          />
          <p className="mt-1 text-xs text-muted text-right">{bio.length}/500</p>
        </div>

        {/* Starter Corporation Preview */}
        {selectedCountry && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-1">
              Starter Corporation
            </p>
            <p className="text-sm text-foreground">
              A <span className="font-semibold">Real Estate</span> corporation will be automatically
              created with $50,000,000 starting capital.
            </p>
          </div>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={isLoading || !country || !name || !gender || !royalHouse || !homeState}
          className="w-full"
        >
          {isLoading ? "Creating..." : "Create Imperial Character"}
        </Button>
      </form>
    </div>
  );
}
