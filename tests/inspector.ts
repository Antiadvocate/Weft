/* Smoke test: THE SAVE IS EDITABLE WITHOUT READING BASE64.
 *
 * The raw editor is one monospace textarea holding a whole world. To change a belief you scroll
 * past every place description and every edge, and once a portrait exists, past a hundred kilobytes
 * of base64 that cannot be read, edited or usefully seen. Everything is the same size and colour,
 * so finding "beliefs" means reading. And it only ever exposed a slice: characters, memory,
 * condition and traits were not reachable from it at all.
 *
 * These pin the decisions the view renders: what kind of control a value gets, what it is called,
 * how it is found, and that a write lands where it was aimed. */
import { classify, labelFor, getPath, setPath, deletePath, matchesQuery, sectionsFor, fieldOrder, isImageData, approxBytes, humanBytes } from "../src/lib/inspector";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PNG = "data:image/png;base64," + "iVBORw0KGgo".repeat(9000);

/* 1. a portrait is never text */
{
  check("a data URI is image data", isImageData(PNG));
  check("portrait_url classifies as an image", classify("portrait_url", PNG) === "image");
  check("so does a bare enormous blob", classify("thumbnail", "Q".repeat(5000)) === "image");
  check("a normal sentence is not", !isImageData("Bright blonde hair in a single heavy braid."));
  check("and a short url is left as text", classify("source_url", "https://example.com/a.png") !== "image");
  check("its size is reported rather than its contents", humanBytes(approxBytes(PNG)).endsWith("KB"), humanBytes(approxBytes(PNG)));
  check("the search never looks inside one", !matchesQuery(["characters", "c1", "portrait_url"], PNG, "iVBOR"));
  check("but still finds it by name", matchesQuery(["characters", "c1", "portrait_url"], PNG, "portrait"));
}

/* 2. every value gets the right control */
{
  check("a short string is a one-liner", classify("name", "Mable") === "text");
  check("a background is prose however short", classify("background", "A carpenter.") === "prose");
  check("so is anything long", classify("whatever", "x".repeat(120)) === "prose");
  check("a number is a number", classify("warmth", 52) === "number");
  check("a boolean is a toggle", classify("god_mode", true) === "boolean");
  check("core_traits is a list", classify("core_traits", ["a", "b"]) === "list");
  check("an empty array is still a list", classify("values", []) === "list");
  check("skills is a map", classify("skills", { carpentry: "master" }) === "map");
  check("threads is an array of objects", classify("threads", [{ id: "t", title: "x" }]) === "objects");
  check("a nested record is a group", classify("psyche", { relaxation: -1, mood: "even", active_states: [] }) === "group");
  check("a mixed array falls back", classify("odd", ["a", { b: 1 }]) === "unknown");
}

/* 3. labels stop everything looking the same */
{
  check("core_traits reads as words", labelFor("core_traits") === "Core traits");
  check("drive_queue too", labelFor("drive_queue") === "Drive queue");
  check("ids are left alone", labelFor("character_id") === "character_id");
}

/* 4. finding a field is typing its name */
{
  const p = ["memory", "char_mable", "beliefs"];
  check("by key", matchesQuery(p, ["she is waiting"], "beliefs"));
  check("by label", matchesQuery(p, ["x"], "Beliefs"));
  check("by two terms at once", matchesQuery(p, ["x"], "mable beliefs"));
  check("both terms must hit", !matchesQuery(p, ["x"], "mable traits"));
  check("by value", matchesQuery(["world_bible", "tone"], "Historical fiction", "historical"));
  check("an empty query matches everything", matchesQuery(p, ["x"], "   "));
}

/* 5. a write lands where it was aimed, and never mutates the draft in place */
{
  const root = { characters: { c1: { name: "Mable", core_traits: ["Devoted"] } }, world: { threads: [{ title: "a" }, { title: "b" }] } };
  const frozen = JSON.stringify(root);

  const a = setPath(root, ["characters", "c1", "name"], "Mabel");
  check("the value changes", getPath(a, ["characters", "c1", "name"]) === "Mabel");
  check("the original is untouched", JSON.stringify(root) === frozen);
  check("siblings are preserved", JSON.stringify(getPath(a, ["characters", "c1", "core_traits"])) === '["Devoted"]');

  const b = setPath(root, ["world", "threads", 1, "title"], "z");
  check("an array index writes", getPath(b, ["world", "threads", 1, "title"]) === "z");
  check("and its neighbour survives", getPath(b, ["world", "threads", 0, "title"]) === "a");

  const c = deletePath(root, ["world", "threads", 0]);
  check("deleting an entry splices it", (getPath(c, ["world", "threads"]) as unknown[]).length === 1);
  check("the right one is left", getPath(c, ["world", "threads", 0, "title"]) === "b");

  const d = deletePath(root, ["characters", "c1", "core_traits"]);
  check("deleting a key removes it", getPath(d, ["characters", "c1", "core_traits"]) === undefined);
  check("the sibling stays", getPath(d, ["characters", "c1", "name"]) === "Mable");

  const e = setPath(root, ["world", "clocks", 0, "faction"], "new");
  check("a missing branch is created as an array where an index needs one", Array.isArray(getPath(e, ["world", "clocks"])));
  check("with the value in it", getPath(e, ["world", "clocks", 0, "faction"]) === "new");
  check("still no mutation", JSON.stringify(root) === frozen);
}

/* 6. everything is reachable — this is what the old editor did not do */
{
  const save = {
    world_bible: { name: "V" }, world: { threads: [] }, model_settings: {}, history: [],
    characters: { char_player: { name: "Rabi" }, c2: { name: "Mable" } },
    condition: { c2: {} }, memory: { c2: {} }, traits: { c2: [] },
  };
  const secs = sectionsFor(save);
  const ids = secs.map((s) => s.id);
  for (const want of ["bible", "world", "cast", "settings", "history"]) check(`${want} is a section`, ids.includes(want));

  const cast = secs.find((s) => s.id === "cast")!;
  check("every character is its own entry", cast.children!.length === 2, cast.children?.map((c) => c.label));
  check("the player comes first", cast.children![0].label.includes("Rabi"), cast.children![0].label);
  check("and is marked", cast.children![0].label.includes("(you)"));

  const mable = cast.children!.find((c) => c.label.startsWith("Mable"))!;
  const kids = mable.children!.map((k) => k.label);
  check("a character carries identity, condition, memory and traits together",
    ["Identity", "Condition", "Memory", "Traits"].every((k) => kids.includes(k)), kids);
  check("memory points at the memory tree", JSON.stringify(mable.children!.find((k) => k.label === "Memory")!.path) === '["memory","c2"]');
  check("traits point at the traits tree", JSON.stringify(mable.children!.find((k) => k.label === "Traits")!.path) === '["traits","c2"]');
}

/* 7. field order puts the name first and the machinery last */
{
  const order = fieldOrder({ updated_turn: 1, portrait_url: "x", core_traits: [], name: "Mable", character_id: "c2" });
  check("name leads", order[0] === "name", order);
  check("the id is last", order[order.length - 1] === "character_id", order);
  check("an image sinks below the real fields", order.indexOf("portrait_url") > order.indexOf("core_traits"), order);
  check("bookkeeping bulk is hidden entirely", !fieldOrder({ telemetry: [], snapshots: [], name: "x" }).includes("telemetry"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
