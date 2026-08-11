"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { MessageBanner, SpinnerIcon, CheckIcon } from "./shared";

const MAX_BIO = 500;

interface CharacterData {
  name: string;
  bio?: string;
  lastNameChange?: string;
}

interface Props {
  character: CharacterData;
  onCharacterUpdate: (updates: Partial<CharacterData>) => void;
  profileHref: string;
}

export function ProfileSection({ character, onCharacterUpdate, profileHref }: Props) {
  // Name form state
  const [newName, setNewName] = useState(character.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState<string | null>(null);

  // Bio form state
  const [bio, setBio] = useState(character.bio ?? "");
  const [bioSaving, setBioSaving] = useState(false);
  const [bioMsg, setBioMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [bioSaved, setBioSaved] = useState(false);

  const updateCooldown = useCallback((lastChange?: string) => {
    if (!lastChange) {
      setCooldownRemaining(null);
      return;
    }
    const diff = Date.now() - new Date(lastChange).getTime();
    const cooldownMs = 24 * 60 * 60 * 1000;
    if (diff < cooldownMs) {
      const remaining = cooldownMs - diff;
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCooldownRemaining(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    } else {
      setCooldownRemaining(null);
    }
  }, []);

  useEffect(() => {
    updateCooldown(character.lastNameChange);
    if (!character.lastNameChange) return;
    const interval = setInterval(() => updateCooldown(character.lastNameChange), 1000);
    return () => clearInterval(interval);
  }, [character.lastNameChange, updateCooldown]);

  const nameValidation = (() => {
    if (!newName)
      return { valid: false, msg: "3–30 chars. Alphanumeric and spaces only. 24h cooldown." };
    if (newName.length < 3) return { valid: false, msg: `Too short (${newName.length}/3 min)` };
    if (newName.length > 30) return { valid: false, msg: `Too long (${newName.length}/30 max)` };
    if (!/^[a-zA-Z0-9 ]+$/.test(newName))
      return { valid: false, msg: "Only letters, numbers, and spaces." };
    if (newName === character.name) return { valid: true, msg: "No changes to save." };
    return { valid: true, msg: "Looks good!" };
  })();

  const handleNameSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameSaving(true);
    setNameMsg(null);
    try {
      const res = await fetch("/api/settings/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (res.ok) {
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 1500);
        onCharacterUpdate({ name: data.name, lastNameChange: new Date().toISOString() });
      } else {
        setNameMsg({ text: data.error ?? "Failed to change name.", ok: false });
      }
    } catch {
      setNameMsg({ text: "Network error.", ok: false });
    } finally {
      setNameSaving(false);
      setTimeout(() => setNameMsg(null), 5000);
    }
  };

  const handleBioSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBioSaving(true);
    setBioMsg(null);
    try {
      const res = await fetch("/api/profile/bio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio }),
      });
      const data = await res.json();
      if (res.ok) {
        setBioSaved(true);
        setTimeout(() => setBioSaved(false), 1500);
      } else setBioMsg({ text: data.error ?? "Save failed.", ok: false });
    } catch {
      setBioMsg({ text: "Network error.", ok: false });
    } finally {
      setBioSaving(false);
      setTimeout(() => setBioMsg(null), 3000);
    }
  };

  return (
    <>
      <p className="text-sm text-muted mb-4">Display name and bio shown on your public profile.</p>

      <Link
        href={profileHref}
        className="mb-6 inline-flex items-center gap-2 rounded-xl border border-card-border bg-background/50 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-elevated hover:border-card-border"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
        View public profile
      </Link>

      <div className="my-6 border-t border-card-border" />

      <form onSubmit={handleNameSave} className="space-y-4 mb-6">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-foreground mb-1.5">
            Character Name
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="displayName"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={`flex-1 rounded-xl border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                newName && nameValidation.valid
                  ? "border-success/60 focus:ring-success/30"
                  : newName && !nameValidation.valid
                    ? "border-error/60 focus:ring-error/30"
                    : "border-card-border focus:border-primary focus:ring-primary/50"
              }`}
              disabled={nameSaving || !!cooldownRemaining}
              placeholder="Enter character name"
            />
            <button
              type="submit"
              disabled={
                nameSaving ||
                !!cooldownRemaining ||
                !nameValidation.valid ||
                newName === character.name
              }
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <span className="flex items-center gap-2">
                {nameSaved ? <CheckIcon /> : nameSaving ? <SpinnerIcon /> : null}
                {nameSaved
                  ? "Saved!"
                  : nameSaving
                    ? "Saving…"
                    : cooldownRemaining
                      ? `Wait ${cooldownRemaining}`
                      : "Save Name"}
              </span>
            </button>
          </div>
          {cooldownRemaining && (
            <p className="mt-1.5 text-xs text-warning">
              Name change available in {cooldownRemaining}
            </p>
          )}
          <p
            className={`mt-1 text-xs transition-colors ${
              newName && nameValidation.valid
                ? "text-success"
                : newName && !nameValidation.valid
                  ? "text-error"
                  : "text-muted"
            }`}
          >
            {newName
              ? nameValidation.msg
              : "Alphanumeric and spaces only. 3–30 chars. 24h cooldown."}
          </p>
        </div>
        {nameMsg && (
          <MessageBanner ok={nameMsg.ok} text={nameMsg.text} onDismiss={() => setNameMsg(null)} />
        )}
      </form>

      <div className="my-8 border-t border-card-border" />

      <form onSubmit={handleBioSave} className="space-y-3">
        <label htmlFor="bio" className="block text-sm font-medium text-foreground mb-1.5">
          Public Bio
        </label>
        <div className="relative">
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
            rows={4}
            placeholder="A seasoned political operative from the heartland, known for..."
            className="w-full rounded-xl border border-card-border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={bioSaving}
          />
          <span
            className={`absolute bottom-3 right-3 text-[11px] ${bio.length >= MAX_BIO ? "text-error" : "text-muted"}`}
          >
            {bio.length}/{MAX_BIO}
          </span>
        </div>
        {bioMsg && (
          <MessageBanner ok={bioMsg.ok} text={bioMsg.text} onDismiss={() => setBioMsg(null)} />
        )}
        <button
          type="submit"
          disabled={bioSaving}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <span className="flex items-center gap-2">
            {bioSaved ? <CheckIcon /> : bioSaving ? <SpinnerIcon /> : null}
            {bioSaved ? "Saved!" : bioSaving ? "Saving…" : "Save Bio"}
          </span>
        </button>
      </form>
    </>
  );
}
