"use client";

interface Template {
  id: string;
  name: string;
  description: string;
  sections: string;
}

interface TemplateSelectorProps {
  selectedTemplate: string | null;
  onSelectTemplate: (templateId: string, sections: string) => void;
}

const templates: Template[] = [
  {
    id: "game-mechanic",
    name: "Game Mechanic",
    description: "Explain how a game system works",
    sections: `## Overview

Brief description of the mechanic.

## How It Works

Step-by-step explanation.

## Strategy Tips

Advanced strategies and tips.

## Examples

Practical examples.
`,
  },
  {
    id: "strategy-guide",
    name: "Strategy Guide",
    description: "Guide players on effective strategies",
    sections: `## Introduction

What this guide covers.

## Core Strategy

Main strategic approach.

## Common Mistakes

What to avoid.

## Advanced Techniques

Expert-level tactics.
`,
  },
  {
    id: "reference",
    name: "Reference",
    description: "Quick reference for game information",
    sections: `## Summary

Quick overview.

## Details

Comprehensive information.

## Related Topics

Links to related pages.
`,
  },
];

export function TemplateSelector({ selectedTemplate, onSelectTemplate }: TemplateSelectorProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-foreground">Template (optional)</label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelectTemplate(template.id, template.sections)}
            className={`p-4 border rounded-lg text-left transition-colors ${
              selectedTemplate === template.id
                ? "border-primary bg-primary/10"
                : "border-card-border hover:border-primary/50 hover:bg-muted"
            }`}
          >
            <h3 className="font-medium text-foreground">{template.name}</h3>
            <p className="mt-1 text-sm text-muted">{template.description}</p>
          </button>
        ))}
      </div>
      {selectedTemplate && (
        <button
          type="button"
          onClick={() => onSelectTemplate("", "")}
          className="text-sm text-muted hover:text-foreground"
        >
          Clear template
        </button>
      )}
    </div>
  );
}
