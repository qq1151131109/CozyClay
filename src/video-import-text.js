// The words a video import sends with its stills. Kept apart from the importer
// so the prompt can be read, tested and changed without touching the pipeline.

import { SCENE_GRAPH_VERSION, SET_PIECE_KINDS } from "./scene-graph.js";

const KINDS = SET_PIECE_KINDS.join(", ");

const EXAMPLE = {
	version: SCENE_GRAPH_VERSION,
	units: "m",
	subject: "a workroom with one long bench",
	entities: [
		{ kind: "cube", name: "bench", position: [0, 0.4, 0.4], size: [1.8, 0.8, 0.7], rot: 0 },
	],
	camera: { position: [0, 1.5, -3.2], lookAt: [0, 0.9, 0.4], focalMm: 32 },
};

/** One line about the shot in the clip, when the operator typed one. */
const subjectLine = subject => (subject && String(subject).trim() ? `\nThe operator says the shot is: ${String(subject).trim().slice(0, 160)}\n` : "");

/**
 * The turn text for a video import: what the stills are, the contract to answer
 * with, and the rules that keep the answer inside the set's own frame.
 */
export function videoImportPrompt({ frames, duration, subject = "" }) {
	const stills = Number(frames) === 1 ? "one still" : `${frames} stills`;
	const length = Number.isFinite(duration) && duration > 0 ? ` from a ${Math.round(duration)}-second clip` : "";
	return `You are looking at ${stills}${length}, in the order they appear in the clip.
Describe this place as a blockout another artist could rebuild: the few primitive
shapes that stand in for what is there, and where the camera stood.${subjectLine(subject)}
Answer with one JSON object and nothing else: no prose, no code fence.

${JSON.stringify(EXAMPLE)}

Rules:
- kind is one of: ${KINDS}
- position is the shape's CENTRE, in metres. The floor is y = 0.
- size is [width, height, depth] in metres. A plane is flat: size [width, 0, depth].
- +z is the direction the camera faces; the camera stands at negative z to look
  at the action.
- rot turns a shape about the vertical axis, in degrees.
- Use 4 to 12 entities. Name each after what it stands in for (bench, doorway,
  window, crate), never after its shape.
- Judge scale from what the stills show. If a person appears, assume 1.7 m.
- Ignore anything that moves: this is a set, not a performance.
- Camera: position is where it stood, lookAt is what it pointed at, and focalMm
  is 18-85 (wide for a room, longer for a close shot).
- If a still is too dark or blurred to read, describe only what the others agree on.`;
}
