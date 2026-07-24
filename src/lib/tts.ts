
/** SYSTEM TTS READER â€” reads narrator prose aloud through the device's own speech engine
 *  (window.speechSynthesis â†’ the iPhone system voices on iOS Safari; free, offline, no API).
 *
 *  iOS quirks handled here:
 *  - speechSynthesis.getVoices() is EMPTY until the async `voiceschanged` event fires â€” cached + refreshed.
 *  - Long utterances get silently cut off on several engines â€” prose is chunked into sentence
 *    packs (~220 chars) and queued; the engine treats each as a fresh utterance.
 *  - pause()/resume() are unreliable on iOS â€” the UI model is play/stop only.
 *  - Playback must start from a user gesture (the button tap provides it).
 *
 *  Voice + rate preferences are device-specific (installed voices differ per phone), so they
 *  live in localStorage, not in the save.
 */

const PREF_KEY = "weft_tts_prefs";

export interface TtsPrefs { voiceURI?: string; rate?: number }

let voicesCache: SpeechSynthesisVoice[] = [];
let stopped = false;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function refreshVoices() {
  const s = synth();
  if (!s) return;
  try { voicesCache = s.getVoices() ?? []; } catch { /* ignore */ }
}
if (synth()) {
  refreshVoices();
  try { synth()!.addEventListener("voiceschanged", refreshVoices); } catch { /* older Safari */ }
}

export function ttsAvailable(): boolean { return !!synth(); }

export function listVoices(): SpeechSynthesisVoice[] {
  if (!voicesCache.length) refreshVoices();
  // system-language voices first, then the rest, stable by name
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  return [...voicesCache].sort((a, b) => {
    const al = a.lang.slice(0, 2).toLowerCase() === lang ? 0 : 1;
    const bl = b.lang.slice(0, 2).toLowerCase() === lang ? 0 : 1;
    return al - bl || a.name.localeCompare(b.name);
  });
}

export function getTtsPrefs(): TtsPrefs {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}"); } catch { return {}; }
}
export function setTtsPrefs(p: TtsPrefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Sentence-pack chunking: split on sentence ends, greedily pack to â‰¤ maxLen. */
function chunk(text: string, maxLen = 220): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?â€¦]+[.!?â€¦]+["'â€â€™)]*|[^.!?â€¦]+$/g) ?? [clean];
  const out: string[] = [];
  let cur = "";
  for (const sent of sentences) {
    const sTrim = sent.trim();
    if (!sTrim) continue;
    if (cur && (cur.length + sTrim.length + 1) > maxLen) { out.push(cur); cur = sTrim; }
    else cur = cur ? `${cur} ${sTrim}` : sTrim;
    // pathological single sentence longer than maxLen: hard-split on commas/spaces
    while (cur.length > maxLen * 1.6) {
      const cut = cur.lastIndexOf(",", maxLen) > 40 ? cur.lastIndexOf(",", maxLen) + 1 : cur.lastIndexOf(" ", maxLen);
      out.push(cur.slice(0, cut).trim());
      cur = cur.slice(cut).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function stopSpeaking() {
  stopped = true;
  const s = synth();
  if (s) try { s.cancel(); } catch { /* ignore */ }
}

export function isSpeaking(): boolean {
  const s = synth();
  return !!s && (s.speaking || s.pending);
}

/** Read text aloud. `onDone` fires when the last chunk ends, is stopped, or errors. */
export function speak(text: string, onDone?: () => void) {
  const s = synth();
  if (!s) { onDone?.(); return; }
  stopSpeaking(); // one reader at a time
  stopped = false;
  const prefs = getTtsPrefs();
  const rate = Math.max(0.5, Math.min(1.6, prefs.rate ?? 1));
  const voice = prefs.voiceURI ? listVoices().find((v) => v.voiceURI === prefs.voiceURI) : undefined;
  const parts = chunk(text);
  if (!parts.length) { onDone?.(); return; }
  let idx = 0;
  const next = () => {
    if (stopped) return;                       // UI clears its own state on stop
    if (idx >= parts.length) { onDone?.(); return; }
    const u = new SpeechSynthesisUtterance(parts[idx++]);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => { if (!stopped) next(); };
    u.onerror = () => { if (!stopped) next(); }; // skip a bad chunk rather than dying
    try { s.speak(u); } catch { onDone?.(); }
  };
  next();
}

