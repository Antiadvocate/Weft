/** Time — "Day N, HH:MM" canonical, tolerant parser, heuristic elapse. */

export interface ParsedTime { day: number; hour: number; minute: number }

export function parseTime(s: string): ParsedTime {
  const m = /day\s*(\d+)\s*,?\s*(\d{1,2}):(\d{2})/i.exec(s || "");
  if (m) return { day: +m[1], hour: +m[2], minute: +m[3] };
  return { day: 1, hour: 9, minute: 0 };
}

export function formatTime(t: ParsedTime): string {
  const phase = t.hour < 5 ? "Deep Night" : t.hour < 8 ? "Dawn" : t.hour < 12 ? "Morning" : t.hour < 17 ? "Afternoon" : t.hour < 21 ? "Evening" : "Night";
  return `Day ${t.day}, ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")} (${phase})`;
}

export function advance(s: string, minutes: number): string {
  const t = parseTime(s);
  let total = t.hour * 60 + t.minute + Math.max(0, Math.round(minutes));
  let day = t.day + Math.floor(total / 1440);
  total %= 1440;
  return formatTime({ day, hour: Math.floor(total / 60), minute: total % 60 });
}

/** Absolute minutes from a "Day N, HH:MM" string (Day 1 00:00 = 0). For comparing scheduled times. */
export function absMinutes(s: string): number {
  const t = parseTime(s);
  return (t.day - 1) * 1440 + t.hour * 60 + t.minute;
}
/** Minutes from a → b (negative if b is before a). */
export function minutesBetween(a: string, b: string): number {
  return absMinutes(b) - absMinutes(a);
}

/** Fallback elapse heuristic when the Simulator omits elapsed_minutes. Reads BOTH the player's
 *  action and the narrator's prose — a scene's real duration is usually described in the narration
 *  (sleeping, hours passing, dawn breaking), not just the terse action line. Ordered from longest
 *  to shortest so the biggest applicable jump wins. */
export function heuristicMinutes(action: string, prose = ""): number {
  const s = `${action}\n${prose}`.toLowerCase();
  // explicit long spans described anywhere in the turn
  if (/\b(sleep|slept|fell asleep|rest for the night|until (morning|dawn|first light)|through the night|next morning|woke|dawn (broke|came)|hours later|the following day)\b/.test(s)) return 8 * 60;
  if (/\b(all afternoon|all morning|for hours|hours passed|the rest of the day|by evening|by nightfall|as the sun set)\b/.test(s)) return 4 * 60;
  if (/\b(travel|journey|rode to|ride to|walked to|walk to|hiked|drove to|made (their|his|her|the) way to|set out for|the trek|the road to)\b/.test(s)) return 90;
  if (/\b(cook|cooked|build|built|craft|repair|mend|forage|hunt|dug|dig|assembled|prepared a meal)\b/.test(s)) return 60;
  if (/\b(a while later|some time later|later that|after a time|eventually)\b/.test(s)) return 45;
  if (/\b(eat|ate|meal|drank|drink|washed|bathed|dressed)\b/.test(s)) return 30;
  // default: scale gently with how much prose was written (a longer scene covers more time), but a
  // pure exchange of a few lines is only a few minutes. Floor 2, cap 30 for an ordinary beat.
  return Math.min(30, 2 + Math.round(prose.length / 320) * 3);
}

/** CALENDAR — layered over the canonical "Day N, HH:MM" clock without changing the stored
 *  format (every parser in the engine depends on it). Given the bible's start_date (Day 1),
 *  returns "Fri 12 Jun 2035" for any time string; empty when no start_date is set. */
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function dateLabel(timeStr: string, startDate?: string): string {
  if (!startDate) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate.trim());
  if (!m) return "";
  const t = parseTime(timeStr);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (t.day - 1)));
  if (isNaN(d.getTime())) return "";
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * WHICH DAY OF THE WEEK "Day N" IS — 0 Sunday … 6 Saturday.
 *
 * `dateLabel` already knows how to do this and returns a formatted string, which is no use to a
 * rule that has to decide whether somebody works today. The same arithmetic, returned as a number.
 *
 * AND IT WORKS WITHOUT A CALENDAR, which is the whole point. `start_date` is optional and most
 * saves do not set one, so keying the week off it would mean the weekday/weekend distinction only
 * existed in stories that had opted into real dates — i.e. almost none of them. A week is not a
 * property of the Gregorian calendar; it is a property of how people organise work and rest, and
 * every setting this engine has ever been pointed at has some version of it. So with no start_date,
 * DAY 1 IS A MONDAY and the week runs from there: Day 6 is a Saturday, Day 7 a Sunday, Day 8 a
 * Monday again. Arbitrary, stated plainly, and stable for the life of the save — which is all a
 * schedule needs from it.
 */
export function weekdayIndex(timeStr: string, startDate?: string): number {
  const t = parseTime(timeStr);
  const m = startDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate.trim()) : null;
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (t.day - 1)));
    if (!isNaN(d.getTime())) return d.getUTCDay();
  }
  // No calendar: Day 1 is a Monday (index 1), and the week counts on from there.
  return ((((t.day - 1) % 7) + 1) % 7 + 7) % 7;
}

/** Saturday or Sunday, by whichever week the world is actually running on. */
export function isWeekend(timeStr: string, startDate?: string): boolean {
  const wd = weekdayIndex(timeStr, startDate);
  return wd === 0 || wd === 6;
}

/** The day number alone. */
export function dayOf(timeStr: string): number {
  return parseTime(timeStr).day;
}

/** "07:30" from minutes since midnight, wrapping past midnight so an overnight end reads right. */
export function clockLabel(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ─────────────────────────── WEATHER CONTINUITY ───────────────────────────
// Weather is an ordered scale from fair to severe. The bookkeeper often jumps it wildly turn to turn;
// this smooths it so it evolves at a believable rate — one step per short turn, more as time passes.
// A big time skip (hours) lets it move freely; a two-minute beat can't go clear→blizzard.
const WEATHER_SCALE: { k: RegExp; level: number; label: string }[] = [
  { k: /\b(clear|sunny|bright|cloudless|fair|blue sky)\b/i, level: 0, label: "clear" },
  { k: /\b(hazy|humid|still|muggy|warm)\b/i, level: 1, label: "hazy and still" },
  { k: /\b(cloud|overcast|grey|gray|dull|leaden)\b/i, level: 2, label: "overcast" },
  { k: /\b(mist|fog|drizzl|damp)\b/i, level: 3, label: "misting" },
  { k: /\b(rain|shower|wet|pour|downpour)\b/i, level: 4, label: "raining" },
  { k: /\b(wind|gust|blustery|gale)\b/i, level: 5, label: "windy" },
  { k: /\b(storm|thunder|lightning|squall|tempest)\b/i, level: 6, label: "storming" },
  { k: /\b(snow|sleet|hail|blizzard|frost|freezing)\b/i, level: 6, label: "snowing" },
];
function weatherLevel(w: string): number {
  const hit = WEATHER_SCALE.find((s) => s.k.test(w || ""));
  return hit ? hit.level : 2; // default overcast if unrecognized
}
/** Return the weather to actually store: the target if it's a believable move from `current` given
 *  `minutes` elapsed, otherwise `current` nudged ONE step toward the target. */
export function advanceWeather(current: string, target: string, minutes: number): string {
  if (!current) return target;
  if (!target || target === current) return current;
  const cur = weatherLevel(current), tgt = weatherLevel(target);
  const gap = Math.abs(tgt - cur);
  // how many steps are believable in this span: ~1 per 30 min, min 1, and a long skip (3h+) is free
  const allowed = minutes >= 180 ? 99 : Math.max(1, Math.round(minutes / 30));
  if (gap <= allowed) return target; // plausible — accept the bookkeeper's weather verbatim
  // too big a jump for the time: step one notch toward it, keeping the target's own phrasing if adjacent
  const dir = tgt > cur ? 1 : -1;
  const nextLevel = cur + dir * allowed;
  const near = WEATHER_SCALE.find((s) => s.level === nextLevel) ?? WEATHER_SCALE.reduce((a, b) => Math.abs(b.level - nextLevel) < Math.abs(a.level - nextLevel) ? b : a);
  return near.label;
}
