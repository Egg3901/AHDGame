"use client";

import { useState } from "react";
import { MessageBanner, SpinnerIcon, CheckIcon } from "./shared";

interface Demographics {
  race: string;
  gender: string;
  education: string;
  wealth: string;
}

interface CharacterData {
  demographics?: Demographics;
}

interface Props {
  character: CharacterData;
  onCharacterUpdate: (updates: Partial<CharacterData>) => void;
}

export function DemographicsSection({ character, onCharacterUpdate }: Props) {
  const [demoRace, setDemoRace] = useState(character.demographics?.race ?? "");
  const [demoGender, setDemoGender] = useState(character.demographics?.gender ?? "");
  const [demoEducation, setDemoEducation] = useState(character.demographics?.education ?? "");
  const [demoWealth, setDemoWealth] = useState(character.demographics?.wealth ?? "");
  const [demoSaving, setDemoSaving] = useState(false);
  const [demoMsg, setDemoMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [demoSaved, setDemoSaved] = useState(false);

  const handleDemographicsSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoRace || !demoGender || !demoEducation || !demoWealth) {
      setDemoMsg({ text: "Please select all demographic options.", ok: false });
      return;
    }
    setDemoSaving(true);
    setDemoMsg(null);
    try {
      const res = await fetch("/api/settings/demographics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          race: demoRace,
          gender: demoGender,
          education: demoEducation,
          wealth: demoWealth,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDemoSaved(true);
        setTimeout(() => setDemoSaved(false), 1500);
        onCharacterUpdate({
          demographics: {
            race: demoRace,
            gender: demoGender,
            education: demoEducation,
            wealth: demoWealth,
          },
        });
      } else {
        setDemoMsg({ text: data.error ?? "Save failed.", ok: false });
      }
    } catch {
      setDemoMsg({ text: "Network error.", ok: false });
    } finally {
      setDemoSaving(false);
      setTimeout(() => setDemoMsg(null), 3000);
    }
  };

  const selectCls =
    "w-full rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50";

  return (
    <>
      <p className="text-sm text-muted mb-6">
        Set your politician&apos;s demographic background. These traits influence how voter groups
        perceive you.
      </p>
      {!character.demographics && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          Please select your character&apos;s background to complete your profile.
        </div>
      )}
      <form onSubmit={handleDemographicsSave} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="demoRace" className="block text-sm font-medium mb-1.5">
              Race
            </label>
            <select
              id="demoRace"
              value={demoRace}
              onChange={(e) => setDemoRace(e.target.value)}
              className={selectCls}
              disabled={demoSaving}
            >
              <option value="">Select race...</option>
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="hispanic">Hispanic</option>
              <option value="asian">Asian</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="demoGender" className="block text-sm font-medium mb-1.5">
              Gender
            </label>
            <select
              id="demoGender"
              value={demoGender}
              onChange={(e) => setDemoGender(e.target.value)}
              className={selectCls}
              disabled={demoSaving}
            >
              <option value="">Select gender...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Non-binary</option>
            </select>
          </div>
          <div>
            <label htmlFor="demoEducation" className="block text-sm font-medium mb-1.5">
              Education Level
            </label>
            <select
              id="demoEducation"
              value={demoEducation}
              onChange={(e) => setDemoEducation(e.target.value)}
              className={selectCls}
              disabled={demoSaving}
            >
              <option value="">Select education...</option>
              <option value="no_college">No College Degree</option>
              <option value="college">College Degree</option>
              <option value="graduate">Graduate Degree</option>
            </select>
          </div>
          <div>
            <label htmlFor="demoWealth" className="block text-sm font-medium mb-1.5">
              Starting Wealth
            </label>
            <select
              id="demoWealth"
              value={demoWealth}
              onChange={(e) => setDemoWealth(e.target.value)}
              className={selectCls}
              disabled={demoSaving}
            >
              <option value="">Select wealth level...</option>
              <option value="low">Low Income</option>
              <option value="middle">Middle Income</option>
              <option value="high">High Income</option>
            </select>
          </div>
        </div>
        {demoMsg && (
          <MessageBanner ok={demoMsg.ok} text={demoMsg.text} onDismiss={() => setDemoMsg(null)} />
        )}
        <button
          type="submit"
          disabled={demoSaving}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <span className="flex items-center gap-2">
            {demoSaved ? <CheckIcon /> : demoSaving ? <SpinnerIcon /> : null}
            {demoSaved ? "Saved!" : demoSaving ? "Saving…" : "Save Background"}
          </span>
        </button>
      </form>
    </>
  );
}
