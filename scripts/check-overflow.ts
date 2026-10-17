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
 * HOW TO PLAY audit: on every in-case screen it visits (not the ending) exactly one labelled HOW TO PLAY pill is
 * visible, at least 44x44, not covered and not overlapping another control or the screen title; it opens the manual
 * and Esc brings focus and the screen's scroll position back exactly.
 *
 * CTA audit: the screen-bottom call to action ([data-cta-bar], intro and accuse) never overlaps text, at the first
 * view and at the end of scroll (the accuse form is reached by restoring a saved session, so no gate is needed).
 * HUD audit: the mute toggle and the HOW TO PLAY pill keep at least 12px (16px from 640px wide) from the top and
 * right edges, 8px+ between each other, and overlap no control or heading on the top layer.
 *
 * Defaults: http://localhost:3000, /usr/bin/google-chrome (or $CHROME_PATH).
 * Exits 1 on any overflow sample. Interrogation talks to /api/interrogate, so
 * against a server with a model key it makes a couple of live calls.
 * --model-down answers /api/interrogate and /api/confront in the browser with the "model unavailable" reply
 * (no request reaches the server, no live call is made) so the walk-through also covers the Ask again state; the first
 * answer on each screen is a breather (429, retryAfter 65 s), covering the disabled AGAIN with its countdown (#49).
 */
import { chromium, type Page } from "playwright-core";

const args = process.argv.slice(2);
const modelDown = args.includes("--model-down");
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
  // Short desktop / laptop windows (George's 1024x490 intro report) and the shortest common phone landscape.
  { name: "desktop short 1024x490", width: 1024, height: 490, isMobile: false },
  { name: "desktop short 1280x600", width: 1280, height: 600, isMobile: false },
  { name: "laptop 1366x650", width: 1366, height: 650, isMobile: false },
  { name: "phone landscape 667x375", width: 667, height: 375, isMobile: true },
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

/** Plain JS source (see SAMPLER): exactly one visible pill, labelled, 44px+, on top, overlapping nothing. */
const helpAudit = (scrolled: boolean) => `
(() => {
  const scrolled = ${scrolled};
  const onTop = (el) => { const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return Boolean(t && el.contains(t)); };
  const vis = (el) => {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight) return false;
    for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return false; }
    return true;
  };
  // Visible AND on top: a screen's own pill under the Notebook's backdrop does not count.
  const pills = [...document.querySelectorAll("[data-help-button]")].filter((el) => vis(el) && onTop(el));
  if (pills.length !== 1) return { error: pills.length + " visible, uncovered HOW TO PLAY buttons" };
  const el = pills[0];
  document.querySelectorAll("[data-audit-target]").forEach((x) => x.removeAttribute("data-audit-target"));
  el.setAttribute("data-audit-target", "");
  const b = el.getBoundingClientRect();
  const problems = [];
  if (el.getAttribute("aria-label") !== "How to Play") problems.push("aria-label " + el.getAttribute("aria-label"));
  if (!/How to Play/.test(el.innerText)) problems.push("label not visible: " + JSON.stringify(el.innerText));
  if (el.offsetWidth < 44 || el.offsetHeight < 44) problems.push("size " + el.offsetWidth + "x" + el.offsetHeight);
  if (b.left < 0 || b.right > innerWidth || b.top < 0 || b.bottom > innerHeight) problems.push("off screen");
  // Crowding: nothing it overlaps in the same layer (inside its modal, if any). Skipped once the screen is scrolled:
  // content then passes under the fixed HUD, as it does under the mute toggle.
  const layer = el.closest("[aria-modal=true]") || document;
  for (const o of scrolled ? [] : layer.querySelectorAll("button, a[href], input, textarea, select, h1, h2, [data-confront-left]")) {
    if (o === el || el.contains(o) || o.contains(el) || !vis(o)) continue;
    if (layer === document && o.closest("[aria-modal=true]")) continue;
    // The part of it actually shown: clipped by every scrolling / overflow-hidden ancestor (a card scrolled out of
    // the Notebook's list sits under the footer but is not drawn there).
    const r = { left: 0, top: 0, right: 0, bottom: 0, ...JSON.parse(JSON.stringify(o.getBoundingClientRect())) };
    for (let n = o.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).overflow === "visible") continue;
      const c = n.getBoundingClientRect();
      r.left = Math.max(r.left, c.left); r.top = Math.max(r.top, c.top); r.right = Math.min(r.right, c.right); r.bottom = Math.min(r.bottom, c.bottom);
    }
    const ox = Math.min(b.right, r.right) - Math.max(b.left, r.left), oy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
    if (ox > 1 && oy > 1) problems.push("overlaps " + o.tagName.toLowerCase() + " " + (o.getAttribute("aria-label") || o.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 30));
  }
  return { problems, variant: el.getAttribute("data-help-button"), w: el.offsetWidth, h: el.offsetHeight };
})()
`;
/** Plain JS: text under a [data-cta-bar] (visible part of every text line, clipped by its scroll containers). */
const CTA_AUDIT = `
(() => {
  const out = [];
  const bars = [...document.querySelectorAll("[data-cta-bar]")].filter((b) => b.getBoundingClientRect().height > 0);
  if (!bars.length) return { bars: 0, out };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const host = t.parentElement;
    if (!host || bars.some((b) => b.contains(host)) || host.closest("[aria-hidden=true], [data-mute-toggle], [data-help-button]")) continue;
    if (host.closest("[aria-modal=true]")) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    for (const r0 of range.getClientRects()) {
      const r = { left: r0.left, top: r0.top, right: r0.right, bottom: r0.bottom };
      for (let n = host; n; n = n.parentElement) {
        if (getComputedStyle(n).overflow === "visible") continue;
        const c = n.getBoundingClientRect();
        r.left = Math.max(r.left, c.left); r.top = Math.max(r.top, c.top); r.right = Math.min(r.right, c.right); r.bottom = Math.min(r.bottom, c.bottom);
      }
      if (r.right - r.left < 1 || r.bottom - r.top < 1) continue;
      for (const b of bars) {
        const q = b.getBoundingClientRect();
        if (Math.min(r.right, q.right) - Math.max(r.left, q.left) > 1 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 1) {
          out.push(JSON.stringify(t.textContent.trim().slice(0, 40)));
          break;
        }
      }
    }
  }
  return { bars: bars.length, out: [...new Set(out)] };
})()
`;
/** Plain JS: top-right HUD edge spacing and overlap. */
const HUD_AUDIT = `
(() => {
  const out = [];
  const min = innerWidth >= 640 ? 16 : 12;
  const vis = (el) => { const b = el.getBoundingClientRect(); if (!b.width || !b.height) return false; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false; } return true; };
  const mute = document.querySelector("[data-mute-toggle]");
  const pill = [...document.querySelectorAll('[data-help-button="fixed"]')].find(vis);
  if (!mute || !vis(mute)) return ["no mute toggle"];
  const m = mute.getBoundingClientRect();
  if (innerWidth - m.right < min - 0.5) out.push("mute " + Math.round(innerWidth - m.right) + "px from the right edge (min " + min + ")");
  if (m.top < min - 0.5) out.push("mute " + Math.round(m.top) + "px from the top edge (min " + min + ")");
  if (pill) {
    const p = pill.getBoundingClientRect();
    if (p.top < min - 0.5) out.push("pill " + Math.round(p.top) + "px from the top edge (min " + min + ")");
    if (m.left - p.right < 8 - 0.5) out.push("pill and mute " + Math.round(m.left - p.right) + "px apart (min 8)");
  }
  const modals = [...document.querySelectorAll("[aria-modal=true]")].filter(vis);
  const layer = modals[modals.length - 1] || document;
  for (const hud of [mute, pill].filter(Boolean)) {
    const h = hud.getBoundingClientRect();
    for (const o of layer.querySelectorAll("button, a[href], input, textarea, select, h1, h2, [data-confront-left]")) {
      if (o === hud || hud.contains(o) || o === mute || o === pill || !vis(o)) continue;
      if (layer === document && o.closest("[aria-modal=true]")) continue;
      const r = o.getBoundingClientRect();
      if (Math.min(h.right, r.right) - Math.max(h.left, r.left) > 1 && Math.min(h.bottom, r.bottom) - Math.max(h.top, r.top) > 1)
        out.push((hud === mute ? "mute" : "pill") + " overlaps " + o.tagName.toLowerCase() + " " + (o.getAttribute("aria-label") || o.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 30));
    }
  }
  return out;
})()
`;
const ctaIssues: string[] = [];
const ctaSeen: string[] = [];
const hudIssues: string[] = [];
let hudChecks = 0;

/** CTA bar vs text, at the current scroll and at the end of scroll (then back). */
async function checkCta(p: Page, where: string) {
  await p.waitForTimeout(400);
  const first = (await p.evaluate(CTA_AUDIT)) as { bars: number; out: string[] };
  if (!first.bars) return;
  for (const t of first.out) ctaIssues.push(`${shotVp} ${where} (first view): CTA covers ${t}`);
  await p.evaluate(() => document.querySelectorAll(".screen-scroll").forEach((e) => e.scrollTo({ top: 99999 })));
  await p.waitForTimeout(400);
  const end = (await p.evaluate(CTA_AUDIT)) as { bars: number; out: string[] };
  for (const t of end.out) ctaIssues.push(`${shotVp} ${where} (end of scroll): CTA covers ${t}`);
  await p.evaluate(() => document.querySelectorAll(".screen-scroll").forEach((e) => e.scrollTo({ top: 0 })));
  await p.waitForTimeout(200);
  ctaSeen.push(where);
}

async function checkHud(p: Page, where: string) {
  hudChecks++;
  for (const x of (await p.evaluate(HUD_AUDIT)) as string[]) hudIssues.push(`${shotVp} ${where}: ${x}`);
}

const SCROLLS = `[...document.querySelectorAll(".screen-scroll, .scroll-area")].map((e) => e.scrollTop).join(",")`;
const helpIssues: string[] = [];
const helpSeen: string[] = [];

/** Audit the pill on this screen, then open the manual with it and close with Esc: focus and scroll come back. */
async function checkHelp(p: Page, where: string, scrolled = false) {
  await p.waitForTimeout(500);
  if (!scrolled) await checkHud(p, where);
  const r = (await p.evaluate(helpAudit(scrolled))) as { error?: string; problems?: string[]; variant?: string; w?: number; h?: number };
  if (r.error) return void helpIssues.push(`${shotVp} ${where}: ${r.error}`);
  for (const x of r.problems ?? []) helpIssues.push(`${shotVp} ${where}: ${x}`);
  helpSeen.push(`${where} (${r.variant} ${r.w}x${r.h})`);
  const before = await p.evaluate(SCROLLS);
  const pill = p.locator("[data-audit-target]");
  await pill.focus();
  await pill.press("Enter");
  await p.waitForSelector("[data-how-to-play]", { timeout: 5_000 }).catch(() => helpIssues.push(`${shotVp} ${where}: the manual did not open`));
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape");
  await p.waitForSelector("[data-how-to-play]", { state: "detached", timeout: 5_000 }).catch(() => helpIssues.push(`${shotVp} ${where}: Esc did not close the manual`));
  await p.waitForTimeout(200);
  if (!(await p.evaluate(`document.activeElement?.hasAttribute("data-help-button")`))) helpIssues.push(`${shotVp} ${where}: focus did not return to the pill`);
  const after = await p.evaluate(SCROLLS);
  if (after !== before) helpIssues.push(`${shotVp} ${where}: scroll moved (${before} -> ${after})`);
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
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("ASK!")) ?? document.querySelector("[data-model-retry]");
    return b && !document.querySelector('[aria-busy="true"]') && (document.querySelectorAll("p.font-medium").length >= 2 || document.querySelector("[data-model-retry]"));
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
    if (modelDown) {
      const line = "The telephone line is down for the night, and they won't be drawn just now. Search the rooms, check your notebook, or make your accusation; talk resumes when the line is mended.";
      const down = { source: "unavailable", error: "quota", unavailable: { kind: "quiet", line }, response: { dialogue: "…", emotion: "calm", intensity: 0.3, evidenceReactions: [], wantsToLeave: false, stressDelta: 0, trustDelta: 0 } };
      // #49: the FIRST answer on each screen is a breather (429) so the disabled AGAIN with its countdown is measured
      // too (65 s: the widest "1:05" label); later ones are the "quiet" line with a live AGAIN.
      const breather = "They need a breather, detective. Give them 2 minutes, then ask again.";
      const rateLimited = { unavailable: { kind: "breather", line: breather, retryAfter: 65 }, error: "rate_limited" };
      let asked = 0;
      let confronted = 0;
      await ctx.route("**/api/interrogate", (r) =>
        asked++ === 0
          ? r.fulfill({ status: 429, contentType: "application/json", headers: { "retry-after": "65" }, body: JSON.stringify({ ...down, ...rateLimited, source: "unavailable" }) })
          : r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify(down) }),
      );
      await ctx.route("**/api/confront", (r) =>
        confronted++ === 0
          ? r.fulfill({ status: 429, contentType: "application/json", headers: { "retry-after": "65" }, body: JSON.stringify({ lines: [], line: breather, ...rateLimited }) })
          : r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ lines: [], line, error: "quota", unavailable: { kind: "quiet", line } }) }),
      );
    }
    const p = await ctx.newPage();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const wait = (ms: number) => p.waitForTimeout(ms);

    await p.goto(base, { waitUntil: "networkidle" });
    await label(p, "title");
    await wait(2500); // title pulse + spring intro
    await checkHud(p, "title");
    await label(p, "title→intro");
    await clickButton(p, /START CASE/);
    await wait(1500);
    await label(p, "intro→suspects");
    await checkCta(p, "intro");
    await checkHelp(p, "intro");
    await clickButton(p, /MEET THE SUSPECTS/);
    await wait(1500);
    await checkHelp(p, "suspects");
    await label(p, "suspects (scrolled)");
    await p.evaluate(() => document.querySelector(".screen-scroll")?.scrollTo({ top: 99999 }));
    await wait(500);
    await checkHelp(p, "suspects (scrolled)", true);
    await label(p, "suspects→interrogation");
    await p.locator("[data-suspect-id]").first().click({ force: true });
    await wait(1500);
    await checkHelp(p, "interrogation");
    await label(p, "interrogation reply (emotion)");
    await clickButton(p, /The victim/);
    await waitReply(p);
    await wait(2500); // emotion overlay intro + loop, speaking pose
    if (modelDown) await label(p, "model down: AGAIN countdown (breather)");
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
        await checkHelp(p, "confront");
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
            await checkHelp(p, "confront notebook");
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
      await checkHelp(p, "investigate");
      await label(p, "investigate: search + discovery sting");
      await p.evaluate(() => document.querySelector(".screen-scroll")?.scrollTo({ top: 600 }));
      await wait(500);
      await checkHelp(p, "investigate (scrolled)", true);
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
        await checkHelp(p, "notebook");
        const hintBtn = p.locator("[data-hint-ask]");
        if (await hintBtn.count()) {
          await label(p, "notebook hint");
          await hintBtn.first().click({ force: true });
          await wait(1500);
        }
        const leadsTab = p.locator('[data-notebook-tab="leads"]');
        if (await leadsTab.count()) {
          await leadsTab.first().click({ force: true });
          await wait(600);
          await label(p, "notebook leads");
          await p.locator('[data-notebook-tab="evidence"]').first().click({ force: true });
          await wait(400);
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
        if (await p.locator("[data-case-not-ready]").count()) {
          // Progression cases shut the gate until the checklist is met: audit the CASE NOT READY dialog and stop there.
          await label(p, "case not ready dialog");
          await wait(600);
          await p.keyboard.press("Escape");
          await wait(600);
          // The form itself (audited for the CTA bar): restore this session onto the accuse screen, no gate involved.
          const restored = await p.evaluate(() => {
            const k = Object.keys(sessionStorage).find((x) => x.startsWith("whodunit:game:"));
            const raw = k ? sessionStorage.getItem(k) : null;
            if (!k || !raw) return false;
            sessionStorage.setItem(k, JSON.stringify({ ...JSON.parse(raw), screen: "accuse" }));
            return true;
          });
          if (restored) {
            await p.reload({ waitUntil: "networkidle" });
            await wait(1800);
            if (await p.locator("[data-accuse-suspect]").count()) {
              await label(p, "accuse form (restored)");
              await checkCta(p, "accuse");
              await p.locator("[data-accuse-suspect]").first().click({ force: true });
              await checkCta(p, "accuse (picked)");
              // Phase 5: the "Did anyone help?" picker (cases with accuse.askHelper): the hint beside the disabled
              // Submit, then an answer, so both CTA-bar states are audited.
              if (await p.locator("[data-accuse-helper]").count()) {
                await label(p, "accuse helper picker");
                await checkCta(p, "accuse (helper unanswered)");
                await p.locator('[data-accuse-helper="none"]').click({ force: true });
                await checkCta(p, "accuse (helper answered)");
              }
              await checkHelp(p, "accuse");
            } else ctaIssues.push(`${shotVp} accuse: the restored session did not open the accuse form`);
          }
        } else {
        await label(p, "accuse form");
        await p.locator("[data-accuse-suspect]").first().click({ force: true });
        if (await p.locator("[data-accuse-helper]").count()) await p.locator('[data-accuse-helper="none"]').click({ force: true });
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
    const ctaHere = ctaIssues.filter((x) => x.startsWith(`${shotVp} `));
    for (const x of ctaHere) console.log(`  ✗ CTA: ${x.slice(shotVp.length + 1)}`);
    if (!ctaHere.length) console.log(`  ✓ CTA bar covers no text (first view + end of scroll) on: ${ctaSeen.join(", ") || "none found"}`);
    if (ctaSeen.length < 2) {
      console.log("  ✗ CTA audit did not reach both the intro and the accuse form");
      failures += 1;
    }
    failures += ctaHere.length;
    ctaSeen.length = 0;
    const hudHere = hudIssues.filter((x) => x.startsWith(`${shotVp} `));
    for (const x of hudHere) console.log(`  ✗ HUD: ${x.slice(shotVp.length + 1)}`);
    if (!hudHere.length) console.log(`  ✓ top-right HUD: edge spacing, gap and no overlap on ${hudChecks} screens`);
    failures += hudHere.length;
    hudChecks = 0;
    const helpHere = helpIssues.filter((x) => x.startsWith(`${shotVp} `));
    for (const x of helpHere) console.log(`  ✗ HOW TO PLAY: ${x.slice(shotVp.length + 1)}`);
    if (!helpHere.length) console.log(`  ✓ HOW TO PLAY on ${helpSeen.length} screens, opens + Esc restores focus and scroll: ${helpSeen.join("; ")}`);
    failures += helpHere.length;
    helpSeen.length = 0;
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
