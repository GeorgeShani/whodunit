/**
 * Scripted (not unit) check for scrollbar flashes: drives every screen in a
 * headless Chromium at desktop and phone sizes and samples, on every animation
 * frame, whether the DOCUMENT overflows the viewport (scrollWidth/scrollHeight
 * vs innerWidth/innerHeight) or any scroll container overflows sideways.
 *
 *   npx tsx scripts/check-overflow.ts [baseUrl] [--chrome /path/to/chrome]
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
const base = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const chromeIdx = args.indexOf("--chrome");
const executablePath = chromeIdx >= 0 ? args[chromeIdx + 1] : process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

const VIEWPORTS = [
  { name: "desktop 1280x800", width: 1280, height: 800, isMobile: false },
  { name: "phone 390x844", width: 390, height: 844, isMobile: true },
];

interface Sample { label: string; t: number; dx: number; dy: number; inner?: string }

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
})();
`;

async function label(p: Page, l: string) {
  await p.evaluate((x) => ((window as unknown as { __label: string }).__label = x), l);
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
  for (const vp of VIEWPORTS) {
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
        await p.evaluate(() => document.querySelector("[data-notebook] .scroll-area")?.scrollTo({ top: 99999 }));
        await wait(500);
        await p.keyboard.press("Escape");
        await wait(600);
      }
    }

    const { ovf, frames } = await p.evaluate(() => {
      const w = window as unknown as { __ovf: Sample[]; __frames: number };
      return { ovf: w.__ovf, frames: w.__frames };
    });
    const byLabel = new Map<string, Sample[]>();
    for (const s of ovf) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
    console.log(`\n${vp.name}: ${frames} frames sampled, ${ovf.length} overflowing`);
    for (const [l, ss] of byLabel) {
      const worst = ss.reduce((a, b) => (Math.max(b.dx, b.dy) > Math.max(a.dx, a.dy) ? b : a));
      console.log(`  ✗ ${l}: ${ss.length} frames (worst dx=${worst.dx} dy=${worst.dy}${worst.inner ? ` inner ${worst.inner}` : ""})`);
    }
    if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
    if (!ovf.length) console.log("  ✓ no document or sideways overflow on any frame");
    if (frames < 60) {
      console.log("  ✗ sampler did not run (too few frames)");
      failures += 1;
    }
    failures += ovf.length;
    await ctx.close();
  }
  await browser.close();
  return failures;
}

run().then(
  (f) => process.exit(f ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
