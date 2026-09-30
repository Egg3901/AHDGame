# Issue 2670: background macro map inspection

## Delivered behavior

Active background aggregate records from the current preset supply population estimates, economic system, stability, trade exposure and update timing to the world page. Their map paths have light borders, hover labels, tap/click inspection and keyboard activation. The country picker also reaches entities without geographic shapes.

The inspector labels its simulation tier and coarse estimate provenance. It offers no political controls. The legend matches the renderer's four country tiers. Retired records and records from other presets cannot populate this view.

## Qualification

- 27 focused tests passed across the inspector, shared SVG renderer, bloc mode, existing landing tiers and the world map model. The final inspector/model subset also passed after the complete entity index was added.
- Four native Mongo cases passed through the real read-model loader. The fixture seeds 155 background countries, maps 153 features across 151 countries, and makes all 155 countries inspectable. Retired and wrong-preset data, forged full-country macro data and stale data in a later preset are excluded.
- Actual WorldMapSVG, D3 projections, SVG renderer, map controls and inspector passed browser checks at 1280x900, 390x844 and 320x740. Checks cover real geometric clicks/taps, keyboard activation, the 155-country picker, countries without shapes, full-country navigation, fullscreen inspection, preservation of visible globe geometry during picker updates, no horizontal overflow and no page errors.
- Mobile cases cover cumulative small-step drags without selection and native finger scrolling of the fullscreen inspector. The tap handler consumes a tap once using the geometry at touch start, preventing a second compatibility click from navigating to a different country.

The browser fixture supplies application context, theme variables and empty structural overlays. A controlled animation clock checks globe geometry preservation. It compiles the actual component sources and their Tailwind classes. It does not qualify authentication, remote deployment or historical overlays.

## Reproduction

Use an explicit isolated Mongo test URI and an evidence directory outside the source checkout:

```sh
NODE_ENV=test AHD_TEST_MONGODB_URI="$TEST_MONGO_URI" npx tsx scripts/verify/issue2670-background-map.ts "$EVIDENCE_DIR/macro-snapshot.json"
NODE_ENV=test node scripts/verify/issue2670-background-map-browser.mjs "$EVIDENCE_DIR" "$EVIDENCE_DIR/macro-snapshot.json"
```

The native script generates and removes its own disposable database. Browser evidence contains screenshots and a JSON result for each viewport.

This delivery does not change the background population generator. Its known distribution defect remains #2675. No full bootstrap, world turn or hosted reset was performed.
