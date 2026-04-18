/**
 * Generate an auto-session name in the form
 *   `<word>_<shortHash>_<YYYY-MM-DD>`
 * e.g.  `ember_a8b3_2026-04-18`.
 */

const WORDS = [
  "alpha", "bravo", "cirrus", "delta", "ember", "fjord", "gale",
  "hazel", "ibis", "jade", "kelp", "lark", "mica", "nebula", "otter",
  "plume", "quartz", "raven", "silt", "teak", "umber", "vale",
  "willow", "xylem", "yarrow", "zephyr", "amber", "basalt", "copper",
  "dune", "echo", "flint", "granite", "heron", "iris", "juniper",
  "kite", "linden", "moss", "nectar",
];

function randomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function shortHash(): string {
  // Four hex characters: enough entropy for auto-names, short enough to read.
  const n = Math.floor(Math.random() * 0xffff);
  return n.toString(16).padStart(4, "0");
}

function isoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function autoSessionName(): string {
  return `${randomWord()}_${shortHash()}_${isoDate()}`;
}
