# Character-creation era hero images

Place source WebP images in this directory, then run:

```bash
node scripts/upload-create-character-images-to-r2.mjs
# or via Railway:
railway run --service "Main Site" node scripts/upload-create-character-images-to-r2.mjs
```

## Required files

| Filename           | Era  | Used when preset is                        |
| ------------------ | ---- | ------------------------------------------ |
| `create-1953.webp` | 1953 | `1953-default`                             |
| `create-1979.webp` | 1979 | `1979-default`                             |
| `create-1991.webp` | 1991 | `1991-default`                             |
| `create-1999.webp` | 1999 | `1999-default`                             |
| `create-2007.webp` | 2007 | `2007-default`                             |
| `create-2019.webp` | 2019 | `2019-default`, `empty`, `2019-no-parties` |
| `create-2023.webp` | 2023 | `2023-default`                             |

Missing files fall back to the existing Lincoln Memorial hero.

## Specs

- Format: WebP
- Approximate size: ~1600×900 (16:9) or wider; the page renders the image full-width behind a dark gradient, so detail near the center/top should survive the overlay.
- File size target: ~150–250 KB.
- Style: Photographic, atmospheric, era-evocative. The gradient overlay (`from-background/60 via-background/70 to-background`) darkens the image heavily, so prefer images with good contrast and avoid busy text.
- Licensing: Use public-domain, CC-licensed, or otherwise cleared imagery. Record attribution in the comment block in `src/lib/images/staticCdnAssets.ts` next to `CDN_CREATE_CHARACTER_IMAGES`.

## Suggested concepts (to source)

These are starting ideas; replace with final attributions once images are chosen.

- **1953** - Korean War armistice signing, 27 July 1953, or an early Cold War / post-Stalin Kremlin scene.
- **1979** - SALT II signing, Soviet tanks entering Afghanistan, or the Three Mile Island control room.
- **1991** - Fall of the Berlin Wall, crowds at the Brandenburg Gate, or the dissolution of the Soviet Union.
- **1999** - WTO protests in Seattle, 30 November 1999, or the introduction of the euro.
- **2007** - G8 Heiligendamm summit group photo, 8 June 2007, or the first iPhone launch / global financial prelude.
- **2019** - UK House of Commons during the Brexit deal debate, 19 October 2019, or a climate-strike crowd.
- **2023** - NATO Vilnius summit family photo, 11 July 2023, or a Ukraine-war-era leaders' meeting.

## R2 target path

Each file uploads to:

```
https://cdn.ahousedividedgame.com/static/create-character/create-{era}.webp
```

The mapping is defined in `src/lib/images/staticCdnAssets.ts` (`CDN_CREATE_CHARACTER_IMAGES`).
