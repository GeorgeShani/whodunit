// Usage: node decode_test.cjs ../../assets/audio   (needs playwright-core + a Chromium; Safari/WebKit is NOT covered)
// Decode every shipped cue in headless Chromium (desktop + mobile emulation): canPlayType, fetch+decodeAudioData (ogg and mp3),
// HTMLAudioElement load+duration, and an actual play() under autoplay-policy=no-user-gesture-required.
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dir = process.argv[2];
const srv = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (req.url === "/") { res.setHeader("content-type", "text/html"); return res.end("<html><body>t</body></html>"); }
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", f.endsWith(".ogg") ? "audio/ogg" : "audio/mpeg"); res.setHeader("accept-ranges", "bytes"); res.end(fs.readFileSync(f));
}).listen(0);
(async () => {
  const port = srv.address().port;
  const names = [...new Set(fs.readdirSync(dir).filter((f) => /\.(ogg|mp3)$/.test(f)).map((f) => f.replace(/\.\w+$/, "")))].sort();
  const out = {};
  for (const [label, ctxOpts] of [["desktop-chromium", {}], ["mobile-chromium(Pixel 7 emu)", { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" }]]) {
    const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    const c = await b.newContext(ctxOpts); const p = await c.newPage();
    await p.goto(`http://localhost:${port}/`);
    out[label] = await p.evaluate(async ({ names, port }) => {
      const a = document.createElement("audio");
      const res = { canPlay: { ogg_vorbis: a.canPlayType('audio/ogg; codecs="vorbis"'), mpeg: a.canPlayType("audio/mpeg") }, files: {} };
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      res.ctxState = ctx.state; res.sampleRate = ctx.sampleRate;
      for (const n of names) {
        const r = {};
        for (const ext of ["ogg", "mp3"]) {
          try {
            const buf = await (await fetch(`/assets/${n}.${ext}`.replace("/assets/", "/"))).arrayBuffer();
            const t0 = performance.now();
            const ab = await ctx.decodeAudioData(buf.slice(0));
            let pk = 0; const d = ab.getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
            r[ext] = { ok: true, dur: +ab.duration.toFixed(3), ch: ab.numberOfChannels, peak: +pk.toFixed(3), ms: +(performance.now() - t0).toFixed(0) };
          } catch (e) { r[ext] = { ok: false, err: String(e) }; }
          try {
            const el = new Audio(`/${n}.${ext}`); el.preload = "auto"; el.muted = true;
            await new Promise((ok, no) => { el.oncanplaythrough = ok; el.onerror = () => no(el.error && el.error.message); setTimeout(() => no("timeout"), 4000); });
            await el.play(); el.pause();
            r[ext].html = { ok: true, dur: +el.duration.toFixed(3) };
          } catch (e) { (r[ext] ||= {}).html = { ok: false, err: String(e) }; }
        }
        res.files[n] = r;
      }
      return res;
    }, { names, port });
    await b.close();
  }
  console.log(JSON.stringify(out));
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
