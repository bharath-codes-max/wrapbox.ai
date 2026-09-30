// Records the grand tour as a YouTube-ready MP4 (1920×1080, 30 fps, H.264 High,
// AAC 48 kHz stereo, faststart).
//
//   node docs/_record.mjs [--url http://localhost:5990/record.html] [--limit-sec N]
//
// Needs docs/record.html + docs/tour.html built and served (npm run build:record
// then any static server on docs/), ffmpeg on PATH, and Google Chrome installed.
//
// How sync works: the tour paces every step by its narration clip's real
// length, so the page is captured silently (Chrome screencast → constant 30 fps
// by frame duplication), and each clip is then laid onto the soundtrack at the
// exact millisecond the runner reported starting it. Output:
//   docs/video/wrapbox-demo-1080p.mp4  +  docs/video/youtube-chapters.txt
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:5990/record.html");
const LIMIT = Number(arg("--limit-sec", "0")) || 0;
const FPS = 30, W = 1920, H = 1080, TAIL_MS = 4000, SR = 48000;
const OUT = join(ROOT, "docs/video");
const TMP = join(OUT, ".tmp");
mkdirSync(TMP, { recursive: true });
const VIDEO_ONLY = join(TMP, "video.mp4"), AUDIO = join(TMP, "audio.wav");
const FINAL = join(OUT, LIMIT ? "wrapbox-demo-test.mp4" : "wrapbox-demo-1080p.mp4");

const manifest = JSON.parse(readFileSync(join(ROOT, "src/tour/voice.json"), "utf8"));
const clips = manifest.cases["grand-tour"];
const { CHAPTERS } = await loadChapters();

/* ---------------------------------------------------------------- capture */
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-g", String(FPS / 2), "-bf", "2", "-r", String(FPS), VIDEO_ONLY], { stdio: ["pipe", "inherit", "inherit"] });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 }); // 2× then downscaled: sharp text
const narr = [];
let doneAt = 0, failed = null;
await page.exposeFunction("__wbRec", (ev) => {
  if (typeof ev.narrated === "number") { narr.push({ i: ev.narrated, at: ev.at }); process.stdout.write(`\r  step ${ev.narrated + 1}/${clips.length}   `); }
  if (ev.done) doneAt = ev.done;
  if (ev.error != null) failed = ev.error;
});
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".rv-title");
await page.evaluate(() => document.fonts.ready);

const cdp = await page.context().newCDPSession(page);
let t0 = 0, written = 0, last = null;
const writeUpTo = (tSec) => {
  const target = Math.floor((tSec - t0) * FPS);
  while (last && written < target) { ff.stdin.write(last); written++; }
};
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const wall = Date.now() / 1000;
  const ts = metadata.timestamp && Math.abs(metadata.timestamp - wall) < 5 ? metadata.timestamp : wall;
  if (!t0) t0 = ts;
  writeUpTo(ts);                      // the previous frame held until this one arrived
  last = Buffer.from(data, "base64");
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await page.waitForTimeout(2500);                       // the title card holds for a moment
await page.evaluate(() => window.__wbGo());

const t1 = Date.now();
while (!doneAt && !failed && (!LIMIT || Date.now() - t1 < LIMIT * 1000)) {
  await page.waitForTimeout(250);
  writeUpTo(Date.now() / 1000);                        // keep time moving on static screens
}
if (failed != null) console.error(`\n  tour reported an error at step ${failed + 1} — recording kept, check it`);
const endAt = (doneAt || Date.now()) + (doneAt ? TAIL_MS : 0);
while (Date.now() < endAt) { await page.waitForTimeout(100); writeUpTo(Date.now() / 1000); }
writeUpTo(endAt / 1000);
await cdp.send("Page.stopScreencast");
await browser.close();
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
const durSec = written / FPS;
console.log(`\n  video: ${written} frames · ${fmt(durSec)} · ${narr.length} narrated lines`);

/* ---------------------------------------------------------------- soundtrack */
// 16-bit mono PCM at 48 kHz; each clip decoded by ffmpeg and written at its offset.
const total = Math.ceil(durSec * SR);
const pcm = new Int16Array(total);
let overlaps = 0;
const seen = new Set();
for (const n of narr) {
  if (seen.has(n.i)) continue;          // a line is placed once
  seen.add(n.i);
  const clip = clips[n.i];
  if (!clip?.ms) continue;
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", join(ROOT, "docs/voice", clip.file), "-f", "s16le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const off = Math.round((n.at / 1000 - t0) * SR);
  for (let k = 0; k < s.length && off + k < total; k++) {
    if (off + k < 0) continue;
    if (pcm[off + k] !== 0) overlaps++;
    pcm[off + k] = Math.max(-32768, Math.min(32767, pcm[off + k] + s[k]));
  }
}
writeWav(AUDIO, pcm);
if (overlaps) console.log(`  note: ${overlaps} overlapping samples mixed`);

/* ---------------------------------------------------------------- mux */
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", VIDEO_ONLY, "-i", AUDIO, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-ar", String(SR), "-ac", "2", "-movflags", "+faststart", FINAL]);

/* ---------------------------------------------------------------- chapters */
const startOf = new Map(narr.map((n) => [n.i, n.at / 1000 - t0]));
const lines = CHAPTERS.map((c, k) => `${fmt(k === 0 ? 0 : Math.max(0, (startOf.get(c.at) ?? 0) - 0.5))} ${c.label}`);
if (!LIMIT) writeFileSync(join(OUT, "youtube-chapters.txt"), lines.join("\n") + "\n");
rmSync(TMP, { recursive: true, force: true });
console.log(`  wrote ${FINAL}`);

/* ---------------------------------------------------------------- helpers */
function fmt(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, "0")}`; }
function writeWav(path, samples) {
  const data = Buffer.from(samples.buffer), h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}
async function loadChapters() {
  // The scene list lives in video-tour.tsx; read the literal array rather than bundling React.
  const src = readFileSync(join(ROOT, "src/portfolio/video-tour.tsx"), "utf8");
  const body = src.slice(src.indexOf("export const CHAPTERS"), src.indexOf("];", src.indexOf("export const CHAPTERS")));
  const out = [...body.matchAll(/\{ at: (\d+), label: "([^"]+)" \}/g)].map((m) => ({ at: Number(m[1]), label: m[2] }));
  if (!existsSync(OUT) || !out.length) throw new Error("could not read CHAPTERS");
  return { CHAPTERS: out };
}
