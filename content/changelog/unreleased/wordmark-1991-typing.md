---
date: 2026-10-01
title: Type the site name in on 1991 worlds
summary: >-
  On a 1991 world the navbar's site name types itself in on page load in a
  mono font: a cursor blinks on an empty field, the name arrives a key at a
  time, and the cursor blinks twice more and goes.
tags: [landing, navbar, 1991]
badges: [patch]
areas: [frontend]
---

## What changed

- On a 1991 world, the site name beside the logo is set in a mono font and typed in once per page load. Moving between pages does not retype it.
- The loading navbar and the full navbar share one typing run, so the name does not restart when the full navbar arrives.
- The name types one letter at a time even while the page is still loading. A busy page pauses the typing instead of skipping letters.
- With reduced motion on, the name appears at once. Screen readers always get the whole name.
- Other eras keep the existing wordmark.
- The 1991 headline's year reads as one year to search engines and copy and paste; the rolling digits are drawn by CSS.
- On phones the satellite beams no longer print their datelines behind the headline.
