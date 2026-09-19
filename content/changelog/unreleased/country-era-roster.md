---
date: 2026-09-08
title: Every country now declares what it is in each era, and the game agrees with it
summary: >-
  The map, the landing page and the admin reset picker each kept their own idea
  of which countries were playable in which era, and they had drifted apart. One
  declaration now answers for all of them. Japan is open to players, East Germany
  no longer turns up in worlds set after reunification, and Ukraine, Belarus and
  the Baltic republics stay where they were.
tags: [countries, presets, seeding, world map]
badges: [minor]
areas: [backend, engine]
---

Cut from development.

## Fixed

- East German parties are no longer created in worlds set after reunification.
- Czechoslovakia, Yugoslavia and East Germany no longer appear in eras after they
  ceased to exist.
- The landing page no longer advertises a country as playable when the world does
  not open it, and no longer lists countries the era does not contain.
- The admin reset picker now lists the countries a reset actually produces. It
  previously named seven for a world that contained sixteen.
- Sphere sponsorship works in the 2023 era, where previously no country could
  sponsor one at all.
- Country pages for a country the era does not contain now say so, instead of
  failing to load.

## Changed

- Japan is open to players.
- Country access is set by the era declaration when a world is created, rather
  than carried over from whatever the previous world was left on. An operator who
  has hand-tuned a country's access should expect a reset to restore it to the
  declared value.
