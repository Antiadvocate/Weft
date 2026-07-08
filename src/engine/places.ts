// Place-name topology. Kept free of engine imports so both turn.ts and prompts.ts can use it.

/** The parent place of a sub-room name. Sub-rooms get written two ways in the wild:
 *  "Tessa's house - kitchen" and "Tessa's house (kitchen)". Both must reduce to "tessa's house",
 *  or the same building reads as two unrelated places and presence silently breaks. */
export function localeOf(name: string): string {
  return (name || "")
    .split(/\s*\(/)[0]                 // "House (kitchen)" -> "House"
    .split(/\s+[-–—]\s+/)[0]           // "House - kitchen"  -> "House"
    .trim().toLowerCase().replace(/[.,;:]+$/, "");
}

/** Does this place name mark itself as a sub-room of a larger locale? */
export function isSubRoom(name: string): boolean {
  return /\(/.test(name || "") || /\s+[-–—]\s+/.test(name || "");
}
