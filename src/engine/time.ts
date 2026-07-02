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

/** Fallback elapse heuristic when the Simulator omits elapsed_minutes. */
export function heuristicMinutes(action: string, prose: string): number {
  const a = action.toLowerCase();
  if (/\bsleep|rest for the night|until morning\b/.test(a)) return 8 * 60;
  if (/\btravel|journey|ride to|walk to|hike\b/.test(a)) return 90;
  if (/\bcook|build|craft|repair|mend|forage|hunt\b/.test(a)) return 60;
  if (/\beat|meal|drink\b/.test(a)) return 30;
  return Math.min(45, 8 + Math.round(prose.length / 220) * 4);
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
