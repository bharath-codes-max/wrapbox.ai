// Narration for the live walkthroughs — generated at BUILD time, on this machine.
//   npx tsx docs/_voice.ts            generate any missing clips, prune stale ones
//   npx tsx docs/_voice.ts --dry      list what would be generated
//
// Uses OpenAI text-to-speech (POST https://api.openai.com/v1/audio/speech,
// model gpt-4o-mini-tts, `instructions` for tone). The API key is read from the
// environment or the git-ignored .env.local of the parent project; it is only
// sent to api.openai.com and never printed, written to disk or shipped — the
// deck only carries the resulting MP3 files and a manifest of their lengths.
// OpenAI's usage policy requires telling listeners the voice is AI-generated;
// the deck labels the sound control "AI voice".
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TourCase } from "../src/tour/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CASES_DIR = join(ROOT, "src/tour/cases");
const OUT = join(ROOT, "docs/voice");
const MANIFEST = join(ROOT, "src/tour/voice.json");
const DRY = process.argv.includes("--dry");

const MODEL = "gpt-4o-mini-tts";
const VOICE = "marin";
const INSTRUCTIONS = [
  "Identity: a real person casually walking a friend through a product they genuinely find cool — not a narrator, not an ad, not a robot reading a script.",
  "Delivery: sound completely human and spontaneous, as if you're seeing it happen live and reacting. Vary your pitch and energy naturally: lift on the interesting bits, soften on the asides, land the key point. Let sentences breathe — real, uneven pauses, a beat of thought before 'why', a tiny pause after a comma.",
  "Tone: warm, friendly, relaxed and quietly enthusiastic. Curious, plain-spoken, reassuring. Never salesy, never theatrical, never sing-song, never flat.",
  "Pace: unhurried and easy, like normal conversation. Slow down slightly on the important sentence so it sticks; speed up a touch on the familiar bits.",
  "Fillers: use light, natural connectors — 'okay', 'so', 'now', 'and', 'here's the thing', 'watch this' — the way people actually talk, but don't overdo it.",
  "Pronunciation: Wrapbox is 'wrap-box'. Read 'A-I' as the two letters. Say product words plainly and clearly.",
].join(" ");

function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const f of [join(ROOT, "../.env.local"), join(ROOT, ".env.local")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("OPENAI_API_KEY not found (env or .env.local)");
}

const lineOf = (s: TourCase["steps"][number]) => (s.say ?? `${s.title}. ${s.body}`).replace(/\s+/g, " ").trim();
const idOf = (text: string) => createHash("sha1").update(`${MODEL}|${VOICE}|${INSTRUCTIONS}|${text}`).digest("hex").slice(0, 10);

async function speak(key: string, text: string, file: string) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
    });
    if (res.ok) {
      // Speech needs no stereo or 128 kbps: 64 kbps mono halves the download.
      const tmp = `${file}.src.mp3`;
      writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-b:a", "64k", file]);
      rmSync(tmp);
      return;
    }
    const msg = (await res.text()).slice(0, 200);
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`TTS ${res.status}: ${msg}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

function durationMs(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim();
  return Math.round(parseFloat(out) * 1000);
}

async function main() {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  const cases: TourCase[] = [];
  for (const f of files) cases.push((await import(pathToFileURL(join(CASES_DIR, f)).href)).default as TourCase);

  const old: { cases?: Record<string, { file: string; ms: number }[]> } = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const manifest: { model: string; voice: string; cases: Record<string, { file: string; ms: number }[]> } = { model: MODEL, voice: VOICE, cases: {} };
  const jobs: { text: string; file: string; rel: string; caseId: string; i: number }[] = [];
  for (const c of cases) {
    manifest.cases[c.id] = [];
    c.steps.forEach((s, i) => {
      const text = lineOf(s);
      const rel = `${c.id}/${i}-${idOf(text)}.mp3`;
      const file = join(OUT, rel);
      const known = old.cases?.[c.id]?.find((x) => x.file === rel);
      manifest.cases[c.id][i] = { file: rel, ms: known?.ms ?? 0 };
      if (!existsSync(file)) jobs.push({ text, file, rel, caseId: c.id, i });
    });
  }
  console.log(`${cases.length} cases · ${Object.values(manifest.cases).reduce((n, a) => n + a.length, 0)} lines · ${jobs.length} to generate`);
  if (DRY) { jobs.forEach((j) => console.log(`  ${j.rel}: ${j.text}`)); return; }

  const key = jobs.length ? apiKey() : "";
  let next = 0, done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      mkdirSync(dirname(j.file), { recursive: true });
      await speak(key, j.text, j.file);
      done++;
      if (done % 10 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // Lengths from the files themselves; prune clips no step uses any more.
  const keep = new Set<string>();
  for (const [id, list] of Object.entries(manifest.cases)) list.forEach((x) => { keep.add(x.file); if (!x.ms) x.ms = durationMs(join(OUT, x.file)); void id; });
  if (existsSync(OUT)) for (const d of readdirSync(OUT)) {
    const dir = join(OUT, d);
    for (const f of readdirSync(dir)) if (!keep.has(`${d}/${f}`)) rmSync(join(dir, f));
    if (!readdirSync(dir).length) rmSync(dir, { recursive: true });
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
  const total = Object.values(manifest.cases).flat().reduce((n, x) => n + x.ms, 0);
  console.log(`manifest written · ${(total / 60000).toFixed(1)} min of narration`);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
