/**
 * Scripted (not unit) check for scrollbar flashes: drives every screen in a
 * headless Chromium at desktop and phone sizes and samples, on every animation
 * frame, whether the DOCUMENT overflows the viewport (scrollWidth/scrollHeight
 * vs innerWidth/innerHeight) or any scroll container overflows sideways.
 *
 *   npx tsx scripts/check-overflow.ts [baseUrl] [--chrome /path/to/chrome]
 *       [--only 390x844,740x360] [--shots dir] [--report-targets]
 *
 * Stage B: also reports interactive elements under 44x44 CSS px on touch
 * viewports and inputs under 16px (iOS zooms them), screen by screen.
 *
 * Case-agnostic: it picks the first suspect, the first notebook clue and
 * searches rooms until a clue turns up (data-* hooks), so it works on
 * /case/<id> for any case (pass the full URL as baseUrl).
 *
 * Defaults: http://localhost:3000, /usr/bin/google-chrome (or $CHROME_PATH).
 * Exits 1 on any overflow sample. Interrogation talks to /api/interrogate, so
 * against a server with a model key it makes a couple of live calls.
 */
import { chromium, type Page } from "playwright-core";

const args = process.argv.slice(2);
const flagValues = new Set(["--chrome", "--only", "--shots"].flatMap((f) => (args.indexOf(f) >= 0 ? [args[args.indexOf(f) + 1]] : [])));
const base = args.find((a) => !a.startsWith("--") && !flagValues.has(a)) ?? "http://localhost:3000";
const chromeIdx = args.indexOf("--chrome");
const executablePath = chromeIdx >= 0 ? args[chromeIdx + 1] : process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

// Stage B sizes: portrait phones, phone landscape, tablets, plus the desktop reference.
// --only 390x844,740x360 limits the run; --shots <dir> saves a screenshot of every labelled screen.
const VIEWPORTS = [
  { name: "desktop 1280x800", width: 1280, height: 800, isMobile: false },
  { name: "phone 360x740", width: 360, height: 740, isMobile: true },
  { name: "phone 390x844", width: 390, height: 844, isMobile: true },
  { name: "phone 430x932", width: 430, height: 932, isMobile: true },
  { name: "phone landscape 740x360", width: 740, height: 360, isMobile: true },
  { name: "phone landscape 844x390", width: 844, height: 390, isMobile: true },
  { name: "tablet 768x1024", width: 768, height: 1024, isMobile: true },
  { name: "tablet landscape 1024x768", width: 1024, height: 768, isMobile: true },
];
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",") : null;
const shotsIdx = args.indexOf("--shots");
const shotsDir = shotsIdx >= 0 ? args[shotsIdx + 1] : null;
/** Minimum touch target on touch viewports (WCAG 2.5.5 / Apple HIG): 44x44 CSS px. */
const MIN_TARGET = 44;
/** Touch targets under 44px fail the run (use --report-targets to only list them). */
const strictTargets = !args.includes("--report-targets");

interface Sample { label: string; t: number; dx: number; dy: number; inner?: string }
interface Small { label: string; what: string; w: number; h: number }
interface SmallText { label: string; what: string; px: number }

/**
 * Runs in the page: an rAF sampler that records every overflowing frame.
 * Plain JS source (not a TS function) so the runner's transpiler can't inject helpers.
 */
const SAMPLER = `
(() => {
  window.__ovf = [];
  window.__label = "load";
  window.__frames = 0;
  const tick = () => {
    window.__frames++;
    const d = document.documentElement;
    const dx = d.scrollWidth - window.innerWidth;
    const dy = d.scrollHeight - window.innerHeight;
    let inner;
    for (const el of document.querySelectorAll(".scroll-area, .screen-scroll")) {
      if (el.scrollWidth > el.clientWidth + 1) inner = el.className.split(" ")[0] + " x+" + (el.scrollWidth - el.clientWidth);
    }
    if (dx > 0 || dy > 0 || inner) window.__ovf.push({ label: window.__label, t: Math.round(performance.now()), dx, dy, inner });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Touch-target + legibility audit every 350 ms, filed under the current screen label.
  // Uses layout size (offsetWidth/Height), so entrance scale animations don't cause false hits.
  window.__small = [];
  window.__smallText = [];
  const seen = new Set();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none" || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 36);
  setInterval(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const label = window.__label;
    for (const el of document.querySelectorAll("button, a[href], input, textarea, select, summary, [role=button], [role=tab]")) {
      if (el.disabled || el.closest("[inert]") || !visible(el)) continue;
      const w = el.offsetWidth, h = el.offsetHeight;
      const key = label + "|" + el.tagName + "|" + name(el);
      if (touch && (w < ${MIN_TARGET} || h < ${MIN_TARGET}) && !seen.has("t" + key)) {
        seen.add("t" + key);
        window.__small.push({ label, what: el.tagName.toLowerCase() + " " + name(el), w, h });
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16 && !seen.has("f" + key)) {
        seen.add("f" + key);
        window.__smallText.push({ label, what: "INPUT font " + name(el), px: parseFloat(getComputedStyle(el).fontSize) });
      }
    }
  }, 350);
})();
`;

let shotVp = "";
let shotN = 0;
async function label(p: Page, l: string) {
  await p.evaluate((x) => ((window as unknown as { __label: string }).__label = x), l);
  if (shotsDir) {
    // Give the screen a moment to settle, then save it (390x844 review set and every other size).
    await p.waitForTimeout(700);
    const file = `${shotsDir}/${shotVp}-${String(++shotN).padStart(2, "0")}-${l.replace(/[^a-z0-9]+/gi, "_")}.png`;
    await p.screenshot({ path: file }).catch(() => undefined);
  }
}

async function clickButton(p: Page, text: string | RegExp) {
  try {
    await p.getByRole("button", { name: text }).first().click({ force: true, timeout: 15_000 });
  } catch (e) {
    const shot = `/tmp/check-overflow-fail-${Date.now()}.png`;
    await p.screenshot({ path: shot }).catch(() => undefined);
    console.error(`  could not click ${text} (screenshot: ${shot})`);
    throw e;
  }
}

async function waitReply(p: Page) {
  // The ASK button re-enables once the reply (model or fallback) has landed.
  await p.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("ASK!"));
    return b && !document.querySelector('[aria-busy="true"]') && document.querySelectorAll("p.font-medium").length >= 2;
  }, undefined, { timeout: 30_000 });
}

async function run(): Promise<number> {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  let failures = 0;
  let smallTotal = 0;
  let smallFonts = 0;
  const viewports = VIEWPORTS.filter((v) => !only || only.some((o) => v.name.endsWith(o)));
  for (const vp of viewports) {
    shotVp = vp.name.replace(/[^a-z0-9]+/gi, "_");
    shotN = 0;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile, deviceScaleFactor: 1 });
    await ctx.addInitScript({ content: SAMPLER });
    const p = await ctx.newPage();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const wait = (ms: number) => p.waitForTimeout(ms);

    await p.goto(base, { waitUntil: "networkidle" });
    await label(p, "title");
    await wait(2500); // title pulse + spring intro
    await label(p, "title→intro");
    await clickButton(p, /START CASE/);
    await wait(1500);
    await label(p, "intro→suspects");
    await clickButton(p, /MEET THE SUSPECTS/);
    await wait(1500);
    await label(p, "suspects (scrolled)");
    await p.evaluate(() => document.querySelector(".screen-scroll")?.scrollTo({ top: 99999 }));
    await wait(500);
    await label(p, "suspects→interrogation");
    await p.locator("[data-suspect-id]").first().click({ force: true });
    await wait(1500);
    await label(p, "interrogation reply (emotion)");
    await clickButton(p, /The victim/);
    await waitReply(p);
    await wait(2500); // emotion overlay intro + loop, speaking pose
    await label(p, "present evidence menu");
    await clickButton(p, /Present evidence/);
    await wait(800);
    if (await p.locator("[data-evidence-id]").count()) await p.locator("[data-evidence-id]").first().click({ force: true });
    await wait(300);
    if (await p.locator("[data-notebook]").count()) await p.keyboard.press("Escape"); // empty notebook: close it
    await waitReply(p).catch(() => undefined);
    await wait(2500);
    // Confrontation (optional: skipped if the build has no Confront menu).
    const confrontBtn = p.getByRole("button", { name: /Confront/ });
    if (await confrontBtn.count()) {
      await label(p, "confront menu");
      await confrontBtn.first().click({ force: true });
      await wait(600);
      if (await p.locator("[data-confront-with]").count()) {
        await p.locator("[data-confront-with]").first().click({ force: true });
        await wait(1200);
        await label(p, "confront screen");
        const box = p.locator("form input, form textarea").first();
        if (await box.count()) {
          await box.fill("Where were you when the lights went out?");
          await clickButton(p, /ASK/);
          await p.waitForSelector("[data-confront-left]", { timeout: 5_000 }).catch(() => undefined);
          await wait(9000); // two model calls, lines delivered 1.4s apart
          await label(p, "confront replies");
          const present = p.locator("[data-confront-present]:not([disabled])");
          if (await present.count()) {
            await label(p, "confront notebook");
            await present.first().click({ force: true });
            await wait(900);
            await p.keyboard.press("Escape");
            await wait(500);
          }
        }
      } else await p.keyboard.press("Escape");
    }
    const investigate = p.getByRole("button", { name: /Investigate/ });
    await label(p, "interrogation→suspects");
    await clickButton(p, /Back to suspects/);
    await wait(1200);
    if (await investigate.count()) {
      await label(p, "investigate");
      await investigate.first().click({ force: true });
      await wait(2500);
      await label(p, "investigate: search + discovery sting");
      await p.evaluate(() => document.querySelector(".screen-scroll")?.scrollTo({ top: 99999 }));
      const rooms = p.locator("[data-location-id]");
      for (let i = 0; i < (await rooms.count()); i++) {
        await rooms.nth(i).click({ force: true });
        await wait(2000);
        if (await p.getByRole("button", { name: /Next clue|Into the notebook/ }).count()) break;
      }
      for (let i = 0; i < 3; i++) {
        const next = p.getByRole("button", { name: /Next clue|Into the notebook/ });
        if (!(await next.count())) break;
        await next.first().click({ force: true });
        await wait(1200);
      }
      await label(p, "notebook (suspect screen)");
      await clickButton(p, /Back to suspects/);
      await wait(1200);
      const notebook = p.getByRole("button", { name: /Notebook/ });
      if (await notebook.count()) {
        await notebook.first().click({ force: true });
        await wait(1200);
        const hintBtn = p.locator("[data-hint-ask]");
        if (await hintBtn.count()) {
          await label(p, "notebook hint");
          await hintBtn.first().click({ force: true });
          await wait(1500);
        }
        await p.evaluate(() => document.querySelector("[data-notebook] .scroll-area")?.scrollTo({ top: 99999 }));
        await wait(500);
        await p.keyboard.press("Escape");
        await wait(600);
      }
      // Phase 8/9: accusation form → confirm → ending cut-scene → end screen.
      const accuseBtn = p.locator("[data-accuse-open]");
      if (await accuseBtn.count()) {
        await label(p, "suspects→accuse");
        await accuseBtn.first().click({ force: true });
        await wait(1500);
        await label(p, "accuse form");
        await p.locator("[data-accuse-suspect]").first().click({ force: true });
        await p.locator("[data-accuse-weapon]").first().click({ force: true });
        await p.locator("[data-accuse-motive]").first().click({ force: true });
        await p.locator("[data-accuse-proof]").first().click({ force: true });
        await p.evaluate(() => document.querySelector(".screen-scroll")?.scrollTo({ top: 99999 }));
        await wait(500);
        await clickButton(p, /SUBMIT ACCUSATION/);
        await wait(800);
        await label(p, "accuse confirm → ending");
        await clickButton(p, /Yes, accuse/);
        await p.waitForSelector("[data-ending-scene], [data-end-screen]", { timeout: 30_000 });
        await wait(2500);
        if (await p.locator("[data-ending-scene]").count()) {
          await label(p, "ending cut-scene");
          for (let i = 0; i < 3; i++) {
            await p.keyboard.press("Space");
            await wait(1200);
          }
          await label(p, "ending skip → end screen");
          await clickButton(p, /Skip/);
          await p.waitForSelector("[data-end-screen]", { timeout: 15_000 });
          await wait(2000);
        }
        await label(p, "end screen (scrolled)");
        await p.evaluate(() => document.querySelector(".screen-scroll")?.scrollTo({ top: 99999 }));
        await wait(800);
      }
    }

    const { ovf, frames, small, smallText } = await p.evaluate(() => {
      const w = window as unknown as { __ovf: Sample[]; __frames: number; __small: Small[]; __smallText: SmallText[] };
      return { ovf: w.__ovf, frames: w.__frames, small: w.__small, smallText: w.__smallText };
    });
    const byLabel = new Map<string, Sample[]>();
    for (const s of ovf) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
    console.log(`\n${vp.name}: ${frames} frames sampled, ${ovf.length} overflowing`);
    for (const [l, ss] of byLabel) {
      const worst = ss.reduce((a, b) => (Math.max(b.dx, b.dy) > Math.max(a.dx, a.dy) ? b : a));
      console.log(`  ✗ ${l}: ${ss.length} frames (worst dx=${worst.dx} dy=${worst.dy}${worst.inner ? ` inner ${worst.inner}` : ""})`);
    }
    if (vp.isMobile) {
      for (const t of small) console.log(`  ✗ target < ${MIN_TARGET}px on "${t.label}": ${t.what} (${t.w}x${t.h})`);
      if (!small.length) console.log(`  ✓ every interactive element is at least ${MIN_TARGET}x${MIN_TARGET}`);
      smallTotal += small.length;
    }
    for (const t of smallText) console.log(`  ✗ ${t.what} on "${t.label}" is ${t.px}px (iOS zooms inputs under 16px)`);
    smallFonts += smallText.length;
    if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
    if (!ovf.length) console.log("  ✓ no document or sideways overflow on any frame");
    if (frames < 60) {
      console.log("  ✗ sampler did not run (too few frames)");
      failures += 1;
    }
    failures += ovf.length + smallText.length + (strictTargets ? small.length : 0);
    await ctx.close();
  }
  await browser.close();
  console.log(`\nTouch targets under ${MIN_TARGET}px: ${smallTotal}; inputs under 16px: ${smallFonts}`);
  return failures;
}

run().then(
  (f) => process.exit(f ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
