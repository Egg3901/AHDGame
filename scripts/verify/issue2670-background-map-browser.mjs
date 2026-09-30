import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import assert from "node:assert/strict";
const taskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.env.NODE_ENV, "test", "Run with NODE_ENV=test");
assert(
  process.argv[2] && process.argv[3],
  "Pass an evidence directory and a native qualification snapshot"
);
const archive = path.resolve(process.argv[2]);
fs.mkdirSync(archive, { recursive: true });
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import * as tw from "tailwindcss";
(async () => {
  const snapshot = JSON.parse(fs.readFileSync(process.argv[3]));
  const classes = new Set();
  for (const file of [
    "components/WorldMapSVG.tsx",
    "components/MapSVGContent.tsx",
    "components/MapControls.tsx",
    "components/BackgroundMacroInspector.tsx",
    "components/MapTooltip.tsx",
  ]) {
    const source = fs.readFileSync(path.join(taskRoot, "src/app/world", file), "utf8");
    for (const match of source.matchAll(/(?:"|`)([^"`\n]*)(?:"|`)/g))
      for (const token of match[1].split(/\s+/)) classes.add(token);
  }
  const theme = fs.readFileSync(new URL(import.meta.resolve("tailwindcss/theme.css")), "utf8");
  const globals = fs.readFileSync(path.join(taskRoot, "src/app/globals.css"), "utf8");
  const inlineTheme = globals.match(/@theme inline \{[\s\S]*?\n\}/)[0];
  const compiler = await tw.compile(theme + "\n" + inlineTheme + "\n@tailwind utilities;");
  const preflight = fs.readFileSync(
    new URL(import.meta.resolve("tailwindcss/preflight.css")),
    "utf8"
  );
  const css = preflight + "\n" + compiler.build([...classes]);
  const result = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import WorldMapSVG from '@/app/world/components/WorldMapSVG';
      window.__navigations=[]; const snapshot=${JSON.stringify(snapshot)};
      createRoot(document.getElementById('app')).render(<WorldMapSVG countryAccess={{US:{enabledForPlayers:true,status:'active',economyPreview:false,registered:true,econOnly:false}}} worldEntities={snapshot} blocMapData={{membership:{},customBlocs:[]}} />);`,
      loader: "tsx",
      resolveDir: taskRoot,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.join(taskRoot, "src") },
    define: { "process.env.NODE_ENV": '"development"' },
    banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
    plugins: [
      {
        name: "fixture-host-context",
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(next\/navigation)$|RegisteredCountriesContext|WorldMetricFilterContext|GlobeMetricPanel$/,
            },
            (args) => ({ path: args.path, namespace: "host-context" })
          );
          build.onLoad({ filter: /.*/, namespace: "host-context" }, (args) => {
            let contents;
            if (args.path.includes("navigation"))
              contents =
                "export const useRouter=()=>({push:(path)=>window.__navigations.push(path)});";
            else if (args.path.includes("RegisteredCountries"))
              contents =
                'export const useActivePreset=()=>"1991-default"; export const useCountryDisplayName=()=>id=>id;';
            else if (args.path.includes("WorldMetricFilter"))
              contents =
                'const value={metricFilter:{type:"none"},setMetricFilter:()=>{},worldMetrics:null,partyData:{},corpsData:null,countryIdToIso:id=>({US:"840",UK:"826",RU:"643"})[id]};export const useWorldMetricFilter=()=>value;';
            else contents = "export default function GlobeMetricPanel(){return null;}";
            return { contents, loader: "js" };
          });
        },
      },
    ],
  });
  const script = result.outputFiles[0].text;
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n:root{--background:#111827;--foreground:#f8fafc;--card:#1f2937;--card-elevated:#28354a;--card-border:#475569;--primary:#60a5fa;--primary-dark:#1e3a8a;--muted-foreground:#cbd5e1;--success:#4ade80;--success-muted:#166534;--warning:#fbbf24;--warning-muted:#713f12;--border:#475569;--popover:#1f2937;--popover-foreground:#f8fafc}body{margin:0;padding:16px;background:var(--background);color:var(--foreground);font:15px system-ui}*{box-sizing:border-box}button,select{font:inherit;color:inherit}button{cursor:pointer}#app{max-width:1200px;margin:auto}select{max-width:100%}</style><div id="app"></div><script src="/fixture.js"></script>`;
  const server = http.createServer((req, res) => {
    res.setHeader(
      "content-type",
      req.url === "/fixture.js" ? "application/javascript" : "text/html"
    );
    res.end(req.url === "/fixture.js" ? script : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const evidence = [];
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const size of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 740 },
    ]) {
      const context = await browser.newContext({ viewport: size, hasTouch: size.width < 500 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (err) => {
        errors.push(err.message);
        console.error("BROWSER ERROR", err.stack);
      });
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("countries-110m"))
          return route.fulfill({
            contentType: "application/json",
            body: fs.readFileSync(path.join(taskRoot, "public/geo/countries-110m.json"), "utf8"),
          });
        if (url.pathname.includes("regions") || url.pathname.includes("region-ownership"))
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(
              url.pathname.includes("ownership")
                ? { owners: {}, preset: "1991-default" }
                : { type: "FeatureCollection", features: [] }
            ),
          });
        return route.continue();
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle" });
      await page.getByRole("combobox", { name: "Inspect a background country" }).waitFor();
      assert.equal(await page.getByRole("combobox").locator("option").count(), 156);
      await page
        .getByRole("button", { name: "Inspect Canada background macro" })
        .waitFor({ state: "attached" });
      await page.evaluate(() => {
        const nativeRaf = window.requestAnimationFrame.bind(window);
        const pending = [];
        window.__freezeMapAnimation = true;
        window.requestAnimationFrame = (callback) =>
          nativeRaf((time) => {
            if (window.__freezeMapAnimation) pending.push(callback);
            else callback(time);
          });
        window.__releaseMapAnimation = () => {
          window.__freezeMapAnimation = false;
          for (const callback of pending.splice(0)) window.requestAnimationFrame(callback);
        };
      });
      await page.waitForTimeout(80);
      const beforePicker = await page
        .locator('svg path[role="button"]')
        .evaluateAll((paths) =>
          paths
            .filter((path) => getComputedStyle(path).opacity !== "0" && path.getAttribute("d"))
            .map((path) => ({ label: path.getAttribute("aria-label"), d: path.getAttribute("d") }))
        );
      await page.getByRole("combobox").selectOption("CA");
      await page.getByRole("complementary", { name: "Canada macro summary" }).waitFor();
      const afterPicker = await page
        .locator('svg path[role="button"]')
        .evaluateAll((paths) =>
          paths
            .filter((path) => getComputedStyle(path).opacity !== "0" && path.getAttribute("d"))
            .map((path) => ({ label: path.getAttribute("aria-label"), d: path.getAttribute("d") }))
        );
      assert.deepEqual(afterPicker, beforePicker);
      await page.getByRole("button", { name: "Close macro summary" }).click();
      await page.evaluate(() => window.__releaseMapAnimation());
      await page.getByRole("button", { name: "Map settings" }).click();
      await page.getByRole("button", { name: "Map", exact: true }).click();
      await page.getByRole("button", { name: "Globe", exact: true }).waitFor();
      await page.waitForTimeout(1500);
      const canada = page.getByRole("button", { name: "Inspect Canada background macro" });
      await canada.waitFor();
      const clickPoint = await canada.evaluate((el) => {
        const box = el.getBBox();
        for (let x = 0.1; x < 1; x += 0.1)
          for (let y = 0.1; y < 1; y += 0.1) {
            const point = new DOMPoint(box.x + box.width * x, box.y + box.height * y);
            if (!el.isPointInFill(point)) continue;
            const screen = point.matrixTransform(el.getScreenCTM());
            if (document.elementFromPoint(screen.x, screen.y) === el)
              return { x: screen.x, y: screen.y };
          }
        throw Error("No visible Canada interior click point");
      });
      if (size.width < 500) await page.touchscreen.tap(clickPoint.x, clickPoint.y);
      else await page.mouse.click(clickPoint.x, clickPoint.y);
      await page.getByRole("complementary", { name: "Canada macro summary" }).waitFor();
      assert.match(
        await page.getByRole("complementary").innerText(),
        /Background macro simulation/
      );
      assert.match(
        await page.getByRole("complementary").innerText(),
        /Political play is unavailable/
      );
      assert.match(await page.getByRole("complementary").innerText(), /not historical statistics/);
      assert.deepEqual(await page.evaluate(() => window.__navigations), []);
      await page.getByRole("combobox").selectOption("IN");
      await page.getByRole("complementary", { name: "India macro summary" }).waitFor();
      const mappedEntities = new Set(
        Object.values(snapshot.byFeatureId).map((item) => item.entityId)
      );
      const unmapped = Object.values(snapshot.byEntityId).find(
        (item) => item.macroSummary && !mappedEntities.has(item.entityId)
      );
      assert(unmapped);
      await page.getByRole("combobox").selectOption(unmapped.entityId);
      await page
        .getByRole("complementary", { name: `${unmapped.displayName} macro summary` })
        .waitFor();
      await page.getByRole("button", { name: "Close macro summary" }).click();
      assert.equal(await page.getByRole("complementary").count(), 0);
      if (size.width < 500) {
        const session = await context.newCDPSession(page);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [clickPoint],
        });
        for (let delta = 2; delta <= 8; delta += 2) {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: clickPoint.x + delta, y: clickPoint.y }],
          });
          await page.waitForTimeout(20);
        }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(50);
        assert.equal(await page.getByRole("complementary").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__navigations), []);
        await session.detach();
      }
      await canada.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("complementary", { name: "Canada macro summary" }).waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      assert.equal(overflow, false);
      assert.deepEqual(errors, []);
      const us = page.locator('svg path[fill="rgba(74, 222, 128, 0.82)"]');
      assert.equal(await us.count(), 1);
      const usPoint = await us.evaluate((el) => {
        const box = el.getBBox();
        for (let x = 0.1; x < 1; x += 0.1)
          for (let y = 0.1; y < 1; y += 0.1) {
            const point = new DOMPoint(box.x + box.width * x, box.y + box.height * y);
            if (!el.isPointInFill(point)) continue;
            const screen = point.matrixTransform(el.getScreenCTM());
            if (document.elementFromPoint(screen.x, screen.y) === el)
              return { x: screen.x, y: screen.y };
          }
        throw Error("No visible Canada interior click point");
      });
      if (size.width < 500) await page.touchscreen.tap(usPoint.x, usPoint.y);
      else await page.mouse.click(usPoint.x, usPoint.y);
      assert.deepEqual(await page.evaluate(() => window.__navigations), ["/country/us"]);
      await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
      await page.getByRole("button", { name: "Exit Fullscreen" }).waitFor();
      await page.getByRole("combobox").selectOption("CA");
      await page.getByRole("complementary", { name: "Canada macro summary" }).waitFor();
      const scrollBox = page.getByRole("combobox").locator("..").locator("..");
      const touchAncestors = await scrollBox.evaluate((el) => {
        const values = [];
        for (let node = el; node; node = node.parentElement)
          values.push(getComputedStyle(node).touchAction);
        return values;
      });
      assert(!touchAncestors.includes("none"));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: path.join(archive, `2670-browser-${size.width}.png`),
        fullPage: true,
      });
      let nativeInspectorScroll = null;
      if (size.width < 500) {
        const dimensions = await scrollBox.evaluate((el) => ({
          height: el.clientHeight,
          scrollHeight: el.scrollHeight,
        }));
        if (dimensions.scrollHeight > dimensions.height) {
          const box = await scrollBox.boundingBox();
          assert(box);
          const session = await context.newCDPSession(page);
          const point = { x: box.x + box.width / 2, y: box.y + box.height - 40 };
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [point],
          });
          for (let delta = 20; delta <= 120; delta += 20) {
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: point.x, y: point.y - delta }],
            });
            await page.waitForTimeout(20);
          }
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await page.waitForTimeout(100);
          assert((await scrollBox.evaluate((el) => el.scrollTop)) > 0);
          nativeInspectorScroll = true;
          await session.detach();
        }
      }
      evidence.push({
        viewport: size,
        mapClickOrTap: true,
        countryPickerCount: 155,
        keyboardInspection: true,
        pickerPreservesGlobeGeometry: true,
        summaryAndProvenance: true,
        noPoliticalNavigation: true,
        fullCountryNavigation: true,
        fullscreenInspection: true,
        inspectorTouchNotBlocked: true,
        unmappedCountryInspection: true,
        smallStepDragDoesNotSelect: size.width < 500 ? true : null,
        nativeInspectorScroll,
        horizontalOverflow: false,
        pageErrors: errors,
      });
      await context.close();
    }
    fs.writeFileSync(
      path.join(archive, "2670-browser-proof.json"),
      JSON.stringify(
        {
          passed: true,
          scope:
            "Actual WorldMapSVG, renderer, D3 projections, controls and inspector with native Mongo snapshot. Fixture supplies application context and empty structural overlays.",
          cases: evidence,
        },
        null,
        2
      )
    );
    console.log(JSON.stringify({ passed: true, cases: evidence }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
