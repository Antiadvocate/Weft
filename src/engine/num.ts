/**
 * The two numeric helpers this engine defines over and over.
 *
 * `clamp` had thirteen identical definitions — one per file that needed it, each a private const
 * with the same body — and `clamp01` had two. That is not a correctness problem on its own; it
 * becomes one the first time somebody fixes a rounding or NaN behaviour in the copy in front of
 * them and leaves the other twelve alone. One definition means there is nothing to drift.
 */

/** `v` held inside [lo, hi]. NaN clamps to `lo`, which is the safe end for every caller here. */
export function clamp(v: number, lo: number, hi: number): number {
  return Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v));
}

/** `v` held inside [0, 1] — the same function at the one range half the engine wants. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
