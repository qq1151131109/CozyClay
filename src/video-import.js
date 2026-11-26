// Importing a reference video as a blockout: stills out of the file, one Studio
// turn to read them, then the scene graph written through the command bus.
//
// The pipeline owns no DOM and no transport of its own; both arrive as
// arguments, so the whole thing runs in a test against fakes
// (test/verify-video-import.mjs).

import { extractFrames, FRAME_PLAN } from "./video-frames.js";
import { parseSceneGraph, applySceneGraph } from "./scene-graph.js";
import { videoImportPrompt } from "./video-import-text.js";

/** A failure an author can act on: `code` says which step failed. */
export class VideoImportError extends Error {
	constructor(message, { code = "import", cause } = {}) {
		super(message);
		this.name = "VideoImportError";
		this.code = code;
		if (cause) this.cause = cause;
	}
}

export const VIDEO_IMPORT_STAGES = Object.freeze(["frames", "reading", "applying", "done"]);

const STAGE_FALLBACK = "The agent answered with no text.";

/** Collects an agent turn's text and returns it once the stream ends. */
export async function askForSceneGraph({ turn, context, model, effort, signal, frames, duration, subject, onDelta }) {
	let answer = "";
	let failure = null;
	const request = {
		sessionId: globalThis.crypto.randomUUID(),
		turnId: globalThis.crypto.randomUUID(),
		surface: "studio",
		text: videoImportPrompt({ frames: frames.length, duration, subject }),
		attachments: frames.map((frame, index) => ({ dataUrl: frame.dataUrl, name: `frame-${index + 1}.jpg` })),
		...(model ? { model } : {}),
		...(effort ? { effort } : {}),
		...(context ? { context } : {}),
	};
	await turn(request, (event) => {
		if (event?.type === "text.delta" && typeof event.text === "string") {
			answer += event.text;
			onDelta?.(answer);
		}
		if (event?.type === "error") failure = event;
	}, signal);
	if (failure) throw new VideoImportError(failure.message || "The agent turn failed.", { code: "agent" });
	if (!answer.trim()) throw new VideoImportError(STAGE_FALLBACK, { code: "empty" });
	return answer;
}

/**
 * Video file -> stills -> scene graph -> set pieces and camera.
 *
 * `turn` is the agent transport's turn (request, onEvent, signal); `run` is the
 * command bus's run. Every stage is reported through `onStage` so the panel can
 * show where the import is.
 */
export async function runVideoImport({
	file,
	turn,
	run,
	context,
	model,
	effort,
	subject = "",
	signal,
	onStage = () => {},
	onDelta,
	extract = extractFrames,
	plan = FRAME_PLAN,
}) {
	if (!file) throw new VideoImportError("Choose a video file first.", { code: "file" });
	onStage({ stage: "frames", message: "Reading the clip…" });
	let read;
	try {
		read = await extract(file, { count: plan.count, maxWidth: plan.maxWidth, quality: plan.quality });
	} catch (error) {
		throw new VideoImportError(error?.message || "The clip could not be read.", { code: "frames", cause: error });
	}
	const frames = read?.frames ?? [];
	if (!frames.length) throw new VideoImportError("The clip gave no frames to read.", { code: "frames" });
	onStage({ stage: "reading", frames: frames.length, message: `Reading ${frames.length} stills…` });
	const answer = await askForSceneGraph({ turn, context, model, effort, signal, frames, duration: read.duration, subject, onDelta });
	const parsed = parseSceneGraph(answer);
	if (!parsed.ok) {
		throw new VideoImportError(`The answer did not fit the scene graph: ${parsed.path} ${parsed.error}.`, { code: "contract" });
	}
	onStage({ stage: "applying", entities: parsed.graph.entities.length, message: `Placing ${parsed.graph.entities.length}…` });
	const ids = applySceneGraph({ run }, parsed.graph);
	onStage({ stage: "done", entities: ids.length, subject: parsed.graph.subject, message: "Blockout placed." });
	return { graph: parsed.graph, ids, frames: frames.length, duration: read.duration };
}
