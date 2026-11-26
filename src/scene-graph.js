// Scene graph: the contract between a reference video's stills and the set.
//
// A video is read as a handful of frames and described back as a small list of
// set-piece primitives plus the camera that stood there. Nothing in this module
// touches the DOM, three.js or the command bus, so the parse, every refusal and
// the command plan are all testable on their own (test/verify-scene-graph.mjs).
//
// Version 1, every length in metres:
//   {
//     version: 1,
//     units: "m",
//     subject: "one line about the shot",
//     entities: [{ kind, name, position: [x, y, z], size: [x, y, z], rot }],
//     camera: { position: [x, y, z], lookAt: [x, y, z], focalMm }
//   }
//
// `position` is the shape's centre. The floor is y = 0 and +z is the direction
// the camera faces, the frame the stage and SHOT already use.

export const SCENE_GRAPH_VERSION = 1;

/** The catalogue kinds a blockout stands in with (OBJECT_LIBRARY in
 * src/scene-objects.js). Kept here so this module stays free of three.js;
 * test/verify-scene-graph.mjs keeps the two lists equal. */
export const SET_PIECE_KINDS = Object.freeze(["cube", "sphere", "capsule", "cylinder", "cone", "plane"]);

/** What one unscaled unit of each kind measures: [width, height, depth] in
 * metres. A plane has no thickness, so its height stands for "ignore y". */
export const SET_PIECE_BASE = Object.freeze({
	cube: [1, 1, 1],
	sphere: [1, 1, 1],
	capsule: [0.7, 1.4, 0.7],
	cylinder: [1, 1, 1],
	cone: [1, 1, 1],
	plane: [2, 0, 2],
});

const SCENE_GRAPH_LIMITS = Object.freeze({
	entities: 24,
	nameLength: 40,
	subjectLength: 160,
	extentM: 80,
	minSideM: 0.02,
	focalMm: [14, 85],
});

const refuse = (path, error) => ({ ok: false, path, error });
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isTriple = (value) => Array.isArray(value) && value.length === 3 && value.every(isNumber);
const round = (value, digits = 3) => {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
};

/** The JSON object a model's answer carries, or a refusal that names where it
 * broke. A fenced block is preferred; otherwise the widest {...} span, so a
 * sentence wrapped around the object does not stop the read. */
export function parseSceneGraph(text) {
	if (typeof text !== "string" || !text.trim()) return refuse("$", "the answer was empty");
	const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].pop();
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) return refuse("$", "the answer held no JSON object");
	let value;
	try {
		value = JSON.parse(body.slice(start, end + 1));
	} catch (error) {
		return refuse("$", `the JSON did not parse: ${error.message}`);
	}
	return validateSceneGraph(value);
}

/** A validated, normalized graph, or a refusal with the field path. Nothing is
 * clamped into a different scene: a value that breaks a rule is refused. */
export function validateSceneGraph(value) {
	if (!isRecord(value)) return refuse("$", "the answer was not one object");
	if (value.version !== SCENE_GRAPH_VERSION) return refuse("$.version", `version must be ${SCENE_GRAPH_VERSION}`);
	if (value.units !== undefined && value.units !== "m") return refuse("$.units", 'units must be "m"');
	const { entities: cap, extentM, minSideM, nameLength, subjectLength } = SCENE_GRAPH_LIMITS;
	if (!Array.isArray(value.entities) || !value.entities.length) return refuse("$.entities", "entities must be a non-empty list");
	if (value.entities.length > cap) return refuse("$.entities", `at most ${cap} entities`);
	const entities = [];
	for (const [index, raw] of value.entities.entries()) {
		const at = `$.entities[${index}]`;
		if (!isRecord(raw)) return refuse(at, "must be an object");
		if (!SET_PIECE_KINDS.includes(raw.kind)) return refuse(`${at}.kind`, `kind must be one of ${SET_PIECE_KINDS.join(", ")}`);
		if (!isTriple(raw.position)) return refuse(`${at}.position`, "must be three numbers");
		if (raw.position.some((axis) => Math.abs(axis) > extentM)) return refuse(`${at}.position`, `every axis must stay inside ${extentM} m`);
		if (!isTriple(raw.size)) return refuse(`${at}.size`, "must be three numbers [width, height, depth]");
		const flat = raw.kind === "plane";
		const [width, height, depth] = raw.size;
		if (!(width >= minSideM) || !(depth >= minSideM)) return refuse(`${at}.size`, `width and depth must be at least ${minSideM} m`);
		if (!flat && !(height >= minSideM)) return refuse(`${at}.size`, `height must be at least ${minSideM} m`);
		if (!flat && height > extentM) return refuse(`${at}.size`, `height must stay inside ${extentM} m`);
		if (raw.rot !== undefined && !isNumber(raw.rot)) return refuse(`${at}.rot`, "must be a number of degrees");
		// The stage places an object by its base, but the contract speaks in
		// centres: a shape whose centre is lower than its half-height would sink
		// through the floor, so it is refused rather than clamped up.
		if (raw.position[1] - height / 2 < -1e-6) return refuse(`${at}.position`, "the shape would stand below the floor");
		const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, nameLength) : raw.kind;
		entities.push({
			kind: raw.kind,
			name,
			position: raw.position.map((axis) => round(axis)),
			size: [round(width), flat ? 0 : round(height), round(depth)],
			rot: round(((Number(raw.rot) || 0) % 360 + 360) % 360),
		});
	}
	const camera = value.camera;
	if (!isRecord(camera)) return refuse("$.camera", "must be an object");
	if (!isTriple(camera.position)) return refuse("$.camera.position", "must be three numbers");
	if (!isTriple(camera.lookAt)) return refuse("$.camera.lookAt", "must be three numbers");
	const [minFocal, maxFocal] = SCENE_GRAPH_LIMITS.focalMm;
	const focalMm = camera.focalMm === undefined ? 35 : camera.focalMm;
	if (!isNumber(focalMm) || focalMm < minFocal || focalMm > maxFocal) return refuse("$.camera.focalMm", `must be ${minFocal}-${maxFocal} mm`);
	const samePlace = camera.position.every((axis, index) => round(axis, 2) === round(camera.lookAt[index], 2));
	if (samePlace) return refuse("$.camera.lookAt", "the camera would look at its own position");
	return {
		ok: true,
		graph: {
			version: SCENE_GRAPH_VERSION,
			units: "m",
			subject: typeof value.subject === "string" ? value.subject.trim().slice(0, subjectLength) : "",
			entities,
			camera: { position: camera.position.map((axis) => round(axis)), lookAt: camera.lookAt.map((axis) => round(axis)), focalMm },
		},
	};
}

/** The object.update scale that turns a kind's base size into the asked one,
 * or null when the base already matches. A plane keeps its height. */
export function sceneGraphScale(entity) {
	const base = SET_PIECE_BASE[entity.kind];
	const [width, height, depth] = entity.size;
	const scaleX = width / base[0];
	const scaleY = base[1] > 0 ? height / base[1] : 1;
	const scaleZ = depth / base[2];
	const same = (left, right) => Math.abs(left - right) < 1e-6;
	if (same(scaleX, 1) && same(scaleY, 1) && same(scaleZ, 1)) return null;
	return [round(scaleX), round(scaleY), round(scaleZ)];
}

/** The bus places an object by its base (y = 0 rests on the floor), so the
 * contract's centre becomes `centre - height / 2`. A plane has no height. */
export function sceneGraphBaseY(entity) {
	return round(Math.max(0, entity.position[1] - entity.size[1] / 2));
}

/** The bus commands a graph becomes, in order. Object ids are only known once
 * an add has run, so the plan carries the scale the importer applies next. */
export function sceneGraphPlan(graph) {
	const plan = graph.entities.map((entity) => ({
		action: "object.add",
		args: {
			kind: entity.kind,
			name: entity.name,
			placement: { x: entity.position[0], y: sceneGraphBaseY(entity), z: entity.position[2], rot: entity.rot },
		},
		scale: sceneGraphScale(entity),
	}));
	const { position, lookAt, focalMm } = graph.camera;
	plan.push({
		action: "shot.placeCamera",
		args: { x: position[0], y: position[1], z: position[2], lookAtX: lookAt[0], lookAtY: lookAt[1], lookAtZ: lookAt[2], focalMm },
		scale: null,
	});
	return plan;
}

/** Writes a graph through the command bus: one add per entity, a scale only
 * when the base size disagrees, then the camera. Answers the created ids. */
export function applySceneGraph({ run }, graph) {
	const created = [];
	for (const op of sceneGraphPlan(graph)) {
		const receipt = run(op.action, op.args);
		if (op.action !== "object.add") continue;
		const id = receipt?.affectedIds?.[0];
		if (!id) continue;
		created.push(id);
		if (op.scale) run("object.update", { id, patch: { scaleX: op.scale[0], scaleY: op.scale[1], scaleZ: op.scale[2] } });
	}
	return created;
}
