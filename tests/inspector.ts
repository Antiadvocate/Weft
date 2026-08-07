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

/* 8. THE EDIT SURVIVES THE ROUND TRIP.
 *
 * A player: "I can't save the edits in the editor, I make the changes and they go away." The write
 * path was never the problem — every field type below survives load → edit → diff → patch → reload
 * intact. The panel had two buttons, "done" in the overlay header and "save" in the footer, and
 * "done" discarded the draft without a word. This pins the half that is testable: that the edit a
 * person makes is the edit that lands, for every shape of value in a save. */
{
  const disk = () => ({
    id: "s1", world_bible: { name: "V", tone: "warm", pressure_palette: ["a", "b"] },
    world: { threads: [{ id: "t1", title: "one", tension: 3 }], canon: ["first"], edges: [{ from: "a", to: "b", warmth: 10 }], places: {} },
    characters: { char_player: { name: "Rabi" }, c2: { name: "Mable", core_traits: ["Devoted"], skills: { vault: "good" }, portrait_url: "data:image/png;base64,AAAA" } },
    memory: { c2: { core: ["made, not born"], beliefs: [] } },
    condition: { c2: { psyche: { mood: "steady", relaxation: -2 } } },
    traits: { c2: [] }, model_settings: { history_window: 6 }, history: [],
  });

  // load → edit → the top-level diff the panel sends → apply → reload
  const roundTrip = (path: (string | number)[], value: unknown) => {
    const before = JSON.parse(JSON.stringify(disk()));
    // exactly what the panel's edit() does: undefined means remove, everything else means write
    const copy = JSON.parse(JSON.stringify(before));
    const drafted = value === undefined ? deletePath(copy, path) : setPath(copy, path, value);
    const patches: { path: (string | number)[]; value: unknown }[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(drafted)])) {
      if (k === "id" || k === "snapshots") continue;
      if (JSON.stringify((before as any)[k]) !== JSON.stringify((drafted as any)[k])) patches.push({ path: [k], value: (drafted as any)[k] });
    }
    const applied: any = JSON.parse(JSON.stringify(before));
    for (const { path: pp, value: vv } of patches) {
      let cur: any = applied;
      for (let i = 0; i < pp.length - 1; i++) {
        const k = pp[i];
        if (cur[k] === null || typeof cur[k] !== "object") cur[k] = typeof pp[i + 1] === "number" ? [] : {};
        cur = cur[k];
      }
      const last = pp[pp.length - 1];
      if (vv === undefined) { if (Array.isArray(cur) && typeof last === "number") cur.splice(last as number, 1); else delete cur[last as any]; }
      else cur[last as any] = vv;
    }
    return { got: getPath(applied, path), patches: patches.length, applied };
  };

  const cases: [string, (string | number)[], unknown][] = [
    ["a bible string", ["world_bible", "tone"], "grim"],
    ["a bible list", ["world_bible", "pressure_palette"], ["x", "y", "z"]],
    ["a character name", ["characters", "c2", "name"], "Mabel"],
    ["a trait list", ["characters", "c2", "core_traits"], ["Devoted", "Perceptive"]],
    ["a skills map", ["characters", "c2", "skills"], { vault: "excellent", nets: "passable" }],
    ["a thread's tension", ["world", "threads", 0, "tension"], 9],
    ["an edge number", ["world", "edges", 0, "warmth"], 77],
    ["a canon line", ["world", "canon", 0], "rewritten"],
    ["memory core", ["memory", "c2", "core"], ["a new line"]],
    ["a nested condition field", ["condition", "c2", "psyche", "mood"], "furious"],
    ["a model setting", ["model_settings", "history_window"], 12],
    ["clearing a portrait", ["characters", "c2", "portrait_url"], ""],
    ["a key that did not exist", ["world_bible", "destination"], "somewhere"],
  ];
  for (const [label, path, v] of cases) {
    const { got, patches } = roundTrip(path, v);
    check(`${label} survives`, JSON.stringify(got) === JSON.stringify(v), { got, patches });
  }

  // one edit produces exactly one patch, not the whole save
  check("an edit sends one branch, not everything", roundTrip(["world_bible", "tone"], "grim").patches === 1);
  // the save's identity is never patched
  const { applied } = roundTrip(["world_bible", "tone"], "grim");
  check("the id is untouched", applied.id === "s1");
  // siblings survive a branch-level patch
  check("a sibling under the same branch survives",
    roundTrip(["characters", "c2", "name"], "Mabel").applied.characters.char_player.name === "Rabi");
  check("and the rest of the edited record survives",
    JSON.stringify(roundTrip(["characters", "c2", "name"], "Mabel").applied.characters.c2.core_traits) === '["Devoted"]');

  // deletion is an edit too
  const del = roundTrip(["world", "threads", 0], undefined);
  check("removing an array entry sticks", (del.applied.world.threads as unknown[]).length === 0, del.applied.world.threads);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
