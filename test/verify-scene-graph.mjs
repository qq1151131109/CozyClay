#!/usr/bin/env node
// The scene graph contract: the parse, every refusal, and the command plan a
// vision model's answer becomes. No DOM, no bus, no three.
import { readFileSync } from "node:fs";
import {
	applySceneGraph,
	parseSceneGraph,
	sceneGraphBaseY,
	sceneGraphPlan,
	sceneGraphScale,
	SCENE_GRAPH_VERSION,
	SET_PIECE_BASE,
	SET_PIECE_KINDS,
	validateSceneGraph,
} from "../src/scene-graph.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

const good = () => ({
	version: SCENE_GRAPH_VERSION,
	units: "m",
	subject: "a workroom",
	entities: [
		{ kind: "cube", name: "bench", position: [0, 0.4, 0.4], size: [1.6, 0.8, 0.7], rot: 0 },
		{ kind: "plane", name: "floor", position: [0, 0, 0], size: [6, 0, 6], rot: 0 },
	],
	camera: { position: [0, 1.6, -3], lookAt: [0, 1, 0], focalMm: 35 },
});
const refusal = (value) => validateSceneGraph(value);

// ── The contract matches the catalogue it writes into ──────────────────────
const source = readFileSync(new URL("../src/scene-objects.js", import.meta.url), "utf8");
const library = [...source.matchAll(/\{ kind: "([a-z]+)", label: "/g)].map((match) => match[1]);
expect("the allowed kinds are exactly the catalogue primitives", JSON.stringify(library) === JSON.stringify(SET_PIECE_KINDS), `${library} vs ${SET_PIECE_KINDS}`);
const bases = [...source.matchAll(/\{ kind: "([a-z]+)",[^\n]*footprint: \{ width: ([\d.]+), depth: ([\d.]+) \}, height: ([\d.]+)/g)]
	.map(([, kind, width, depth, height]) => [kind, [Number(width), Number(height), Number(depth)]]);
expect("every base size is the catalogue's own footprint and height",
	bases.length === SET_PIECE_KINDS.length && bases.every(([kind, size]) => JSON.stringify(size) === JSON.stringify(SET_PIECE_BASE[kind])),
	bases.map(([kind, size]) => `${kind}=${size}`).join(" "));

// ── Parsing what a model actually answers ──────────────────────────────────
const fenced = "Here is the blockout:\n```json\n" + JSON.stringify(good()) + "\n```\nThat is all.";
expect("a fenced JSON block is read", parseSceneGraph(fenced).ok);

const wrapped = "I read the stills. " + JSON.stringify(good()) + " Let me know if you want changes.";
expect("a JSON object wrapped in prose is read", parseSceneGraph(wrapped).ok);

const nested = JSON.stringify({ ...good(), note: "brace in a string: { not json" });
expect("a brace inside a string does not stop the read", parseSceneGraph(nested).ok);

expect("an empty answer is refused", !parseSceneGraph("   ").ok);
expect("an answer with no object is refused", !parseSceneGraph("I could not read the clip.").ok);
const broken = parseSceneGraph('{"version": 1, "entities": [,]}');
expect("an unparsable answer is refused", !broken.ok && broken.path === "$" && /did not parse/.test(broken.error), JSON.stringify(broken));

// ── Refusals name the field that broke ─────────────────────────────────────
const cases = [
	["a list instead of an object", [good()], "$"],
	["a version from another contract", { ...good(), version: 2 }, "$.version"],
	["units other than metres", { ...good(), units: "cm" }, "$.units"],
	["no entities", { ...good(), entities: [] }, "$.entities"],
	["too many entities", { ...good(), entities: Array.from({ length: 25 }, () => good().entities[0]) }, "$.entities"],
	["an unknown kind", { ...good(), entities: [{ ...good().entities[0], kind: "torus" }] }, "$.entities[0].kind"],
	["a position that is not three numbers", { ...good(), entities: [{ ...good().entities[0], position: [0, 1] }] }, "$.entities[0].position"],
	["a position outside the set", { ...good(), entities: [{ ...good().entities[0], position: [0, 0, 5000] }] }, "$.entities[0].position"],
	["a zero width", { ...good(), entities: [{ ...good().entities[0], size: [0, 1, 1] }] }, "$.entities[0].size"],
	["a negative height on a solid", { ...good(), entities: [{ ...good().entities[0], size: [1, -1, 1] }] }, "$.entities[0].size"],
	["a rot that is not a number", { ...good(), entities: [{ ...good().entities[0], rot: "left" }] }, "$.entities[0].rot"],
	["a shape centred below the floor", { ...good(), entities: [{ ...good().entities[0], position: [0, 0.1, 0], size: [1, 1, 1] }] }, "$.entities[0].position"],
	["a missing camera", { ...good(), camera: undefined }, "$.camera"],
	["a camera with no lookAt", { ...good(), camera: { position: [0, 1, 0] } }, "$.camera.lookAt"],
	["a focal outside the lens range", { ...good(), camera: { ...good().camera, focalMm: 300 } }, "$.camera.focalMm"],
	["a camera looking at itself", { ...good(), camera: { position: [1, 1, 1], lookAt: [1, 1, 1] } }, "$.camera.lookAt"],
];
for (const [name, value, path] of cases) {
	const result = refusal(value);
	expect(`${name} is refused`, !result.ok && result.path === path, JSON.stringify(result));
}

// ── Normalization ──────────────────────────────────────────────────────────
const normalized = refusal(good());
expect("a good graph validates", normalized.ok, JSON.stringify(normalized));
expect("a plane keeps its height at 0", normalized.graph.entities[1].size[1] === 0);
expect("a negative rot wraps into 0-360", refusal({ ...good(), entities: [{ ...good().entities[0], rot: -90 }] }).graph.entities[0].rot === 270);
expect("a missing rot reads as 0", refusal({ ...good(), entities: [{ ...good().entities[0], rot: undefined }] }).graph.entities[0].rot === 0);
expect("a missing name falls back to the kind", refusal({ ...good(), entities: [{ ...good().entities[0], name: "  " }] }).graph.entities[0].name === "cube");
expect("a missing focal reads as 35 mm", refusal({ ...good(), camera: { position: [0, 1, 0], lookAt: [0, 0, 0] } }).graph.camera.focalMm === 35);

// ── Scale: the base size is never assumed to be 1 m ────────────────────────
const cubeScale = sceneGraphScale({ kind: "cube", size: [1.6, 0.8, 0.7] });
expect("a cube scales by its own 1 m base", JSON.stringify(cubeScale) === "[1.6,0.8,0.7]", JSON.stringify(cubeScale));
expect("a cube already at 1 m needs no scale", sceneGraphScale({ kind: "cube", size: [1, 1, 1] }) === null);
const capsuleScale = sceneGraphScale({ kind: "capsule", size: [0.35, 2.8, 0.35] });
expect("a capsule scales by its 0.7 x 1.4 base", JSON.stringify(capsuleScale) === "[0.5,2,0.5]", JSON.stringify(capsuleScale));
const planeScale = sceneGraphScale({ kind: "plane", size: [6, 0, 4] });
expect("a plane scales width and depth but never its height", JSON.stringify(planeScale) === "[3,1,2]", JSON.stringify(planeScale));

// ── The plan, and writing it ───────────────────────────────────────────────
const plan = sceneGraphPlan(normalized.graph);
expect("the plan is one add per entity then the camera", plan.length === 3 && plan[2].action === "shot.placeCamera", plan.map((op) => op.action).join(","));
expect("an add carries the catalogue kind, its name and its placement",
	plan[0].args.kind === "cube" && plan[0].args.name === "bench" && plan[0].args.placement.z === 0.4);
expect("the contract's centre becomes the base the bus places by",
	sceneGraphBaseY({ position: [0, 1.5, 0], size: [1, 1, 1] }) === 1 && plan[0].args.placement.y === 0,
	`base=${sceneGraphBaseY({ position: [0, 1.5, 0], size: [1, 1, 1] })} bench=${plan[0].args.placement.y}`);
expect("a plane's centre is already its base", plan[1].args.placement.y === 0);
expect("the camera op carries position, aim and lens",
	plan[2].args.lookAtY === 1 && plan[2].args.focalMm === 35 && plan[2].args.z === -3);

const calls = [];
let made = 0;
const ids = applySceneGraph({
	run: (action, args) => {
		calls.push([action, args]);
		return { affectedIds: action === "object.add" ? [`made-${++made}`] : [] };
	},
}, normalized.graph);
expect("every add lands and its id comes back", JSON.stringify(ids) === '["made-1","made-2"]', JSON.stringify(ids));
expect("a size that differs from the base is applied as a scale",
	calls.some(([action, args]) => action === "object.update" && args.id === "made-1" && args.patch.scaleZ === 0.7));
expect("the camera is placed last", calls[calls.length - 1][0] === "shot.placeCamera");

console.log(failures === 0 ? "scene graph: all checks passed" : `${failures} scene graph check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
