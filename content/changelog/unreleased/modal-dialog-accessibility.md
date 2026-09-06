---
date: 2026-09-06
title: Modal dialogs announce themselves and close on Escape
summary: >-
  Nine hand-rolled overlays carried no dialog role, no modal flag and no
  Escape handler, so a screen reader did not know a dialog had opened and
  keyboard users could not dismiss one. The shared Modal also announced itself
  as an unnamed "dialog".
tags: [ui, accessibility]
badges: [patch]
areas: [frontend]
era: "Beta 2"
---

Cut from development.

## Fixed

- Nine hand-rolled overlays now carry `role="dialog"`, `aria-modal`, a heading
  that names the dialog, and Escape-to-close: the spin-off, formalize
  subsidiary, appoint subsidiary CEO, portfolio sell, expand market, share
  issuance and share purchase dialogs, plus bond trading and currency exchange.
- The shared `Modal` now names itself from its title. It already had the role,
  the modal flag and Escape handling, but no `aria-labelledby`, so all
  twenty-six dialogs built on it announced as an unnamed "dialog".

## Added

- `useDialogA11y`, one place holding the contract, so a new dialog gets it by
  calling a hook rather than by remembering four separate attributes.
