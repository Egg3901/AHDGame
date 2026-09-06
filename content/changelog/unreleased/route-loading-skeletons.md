---
date: 2026-09-06
title: Thirteen more routes show a layout skeleton instead of a blank page
summary: >-
  Segments with an error boundary but no loading state rendered nothing at all
  while the server worked. Officials, notifications, news, actions, world, bond
  and forex now show a skeleton matching the layout that is about to arrive.
tags: [ui]
badges: [patch]
areas: [frontend]
era: "Beta 2"
---

Cut from development.

## Added

- `loading.tsx` for `policy`, `bond`, `budget`, `forex`, `officials`,
  `notifications`, `news`, `corporations`, `politicians`, `actions`,
  `elections`, `parties` and `world`, built from the shared skeleton
  primitives in `components/ui/loading-skeletons`.
- The seven that render real work — officials, notifications, news, actions,
  world, plus bond and forex through their dynamic children — match the shape
  of the page that follows, so content does not jump when it arrives.
- The six redirect stubs get a deliberately plain shell. A detailed skeleton
  there would flash and then be replaced by a different page, which reads as
  loading twice.
