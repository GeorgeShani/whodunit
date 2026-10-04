import { chromium } from "playwright-core";
const [base, w, h, out, ...screens] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const click = (loc) => loc.first().click({ force: true });
const shot = async (n) => { await p.waitForTimeout(900); await p.screenshot({ path: `${out}-${n}.png` }); const dx = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); console.log(n, w + "x" + h, "dx=" + dx); };
await p.goto(base + "/case/blackwood", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await click(p.locator("[data-start]"));
await p.waitForTimeout(1200);
await click(p.getByRole("button", { name: /MEET THE SUSPECTS/ }));
await p.waitForTimeout(2000);
const want = (s) => screens.includes(s);
if (want("investigate")) {
  await click(p.getByRole("button", { name: /Investigate/ }));
  await p.waitForTimeout(2000);
  await shot("investigate");
  const rooms = p.locator("[data-location-id]");
  await click(rooms);
  await p.waitForTimeout(2500);
  await shot("investigate-search");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
  await click(p.getByRole("button", { name: /Back to suspects/ }));
  await p.waitForTimeout(1200);
}
if (want("interrogate") || want("notebook") || want("confront") || want("accuse")) {
  await click(p.locator("[data-suspect-id]"));
  await p.waitForTimeout(2200);
  if (want("interrogate")) {
    await shot("interrogate");
    await click(p.getByRole("button", { name: /The victim/ }));
    await p.waitForTimeout(7000);
    await shot("interrogate-reply");
    await click(p.getByRole("button", { name: /Present evidence/ }));
    await shot("interrogate-present");
    await p.keyboard.press("Escape");
    // keyboard: shrink the visible height like an on-screen keyboard would
    await p.setViewportSize({ width: +w, height: Math.round(+h * 0.5) });
    await p.locator("form input").first().focus();
    await p.waitForTimeout(600);
    await shot("interrogate-keyboard");
    const box = await p.locator("form input").first().boundingBox();
    console.log("input box", JSON.stringify(box), "vh", Math.round(+h * 0.5));
    await p.setViewportSize({ width: +w, height: +h });
  }
  if (want("notebook")) {
    await click(p.getByRole("button", { name: /Present evidence/ }));
    await shot("notebook");
    await p.keyboard.press("Escape");
  }
  if (want("confront")) {
    await click(p.getByRole("button", { name: /Confront/ }));
    await shot("confront-menu");
    await click(p.locator("[data-confront-with]"));
    await p.waitForTimeout(1500);
    await shot("confront");
    await p.locator("form input").first().fill("Where were you when the lights went out?");
    await click(p.getByRole("button", { name: /ASK/ }));
    await p.waitForTimeout(10000);
    await shot("confront-replies");
  }
}
await b.close();
