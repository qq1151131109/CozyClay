#!/usr/bin/env node
// The video import pipeline against fakes: a good answer, a malformed one, an
// agent failure, an empty answer, an unreadable clip, and a cancel. Nothing
// here touches a browser or a model.
import { runVideoImport, askForSceneGraph, VIDEO_IMPORT_STAGES, VideoImportError } from "../src/video-import.js";
import { SCENE_GRAPH_VERSION } from "../src/scene-graph.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

const graph = {
	version: SCENE_GRAPH_VERSION,
	units: "m",
	subject: "a workroom",
	entities: [
		{ kind: "cube", name: "bench", position: [0, 0.4, 0.4], size: [1.6, 0.8, 0.7], rot: 0 },
		{ kind: "cylinder", name: "stool", position: [1.2, 0.25, 0.4], size: [0.4, 0.5, 0.4], rot: 0 },
	],
	camera: { position: [0, 1.6, -3], lookAt: [0, 1, 0], focalMm: 32 },
};
const frames = () => ({ duration: 10, frames: [1, 2, 3, 4].map((index) => ({ index: index - 1, time: index, width: 768, height: 432, dataUrl: `data:image/jpeg;base64,${index}` })) });
const extract = async () => frames();

/** A turn that streams `chunks` then ends, remembering what it was sent. */
function fakeTurn(chunks, { fail = null } = {}) {
	const sent = [];
	return {
		sent,
		turn: async (request, onEvent) => {
			sent.push(request);
			for (const chunk of chunks) onEvent({ type: "text.delta", text: chunk });
			if (fail) onEvent(fail);
		},
	};
}

function fakeRun() {
	const calls = [];
	let made = 0;
	return {
		calls,
		run(action, args) {
			calls.push([action, args]);
			return { affectedIds: action === "object.add" ? [`made-${++made}`] : [] };
		},
	};
}

/** Runs the import and answers the error it threw, so each case is one line. */
async function thrown(options) {
	try {
		await runVideoImport({ file: { name: "clip.mp4" }, extract, run: fakeRun().run, ...options });
		return null;
	} catch (error) {
		return error;
	}
}

// ── A good answer ──────────────────────────────────────────────────────────
const stages = [];
const okTurn = fakeTurn(["Here it is.\n```json\n" + JSON.stringify(graph), "\n```"]);
const okRun = fakeRun();
const result = await runVideoImport({
	file: { name: "clip.mp4" },
	turn: okTurn.turn,
	run: okRun.run,
	extract,
	onStage: (stage) => stages.push(stage.stage),
});
expect("a good answer places every entity and the camera", result.ids.length === 2 && okRun.calls.at(-1)[0] === "shot.placeCamera", JSON.stringify(result.ids));
expect("the import reports the stages in order", JSON.stringify(stages) === JSON.stringify(VIDEO_IMPORT_STAGES), JSON.stringify(stages));
expect("the graph comes back for the panel to summarize", result.graph.subject === "a workroom" && result.graph.entities.length === 2);
expect("the clip's frame count is reported", result.frames === 4 && result.duration === 10);
expect("the turn was sent one request", okTurn.sent.length === 1);
expect("every still rides as an attachment", okTurn.sent[0].attachments.length === 4 && okTurn.sent[0].attachments[0].dataUrl === "data:image/jpeg;base64,1");
expect("an attachment is named after its slice", okTurn.sent[0].attachments.map((entry) => entry.name).join(",") === "frame-1.jpg,frame-2.jpg,frame-3.jpg,frame-4.jpg");
expect("the turn asks for JSON and nothing else", /one JSON object and nothing else/.test(okTurn.sent[0].text));
expect("the turn is a Studio turn", okTurn.sent[0].surface === "studio" && typeof okTurn.sent[0].turnId === "string");

// ── Refusals, each named by its step ───────────────────────────────────────
const malformed = await thrown({ turn: fakeTurn(["I could not read the clip."]).turn });
expect("an answer with no object fails as a contract refusal",
	malformed instanceof VideoImportError && malformed.code === "contract" && /did not fit the scene graph/.test(malformed.message), malformed?.message);

const badShape = await thrown({ turn: fakeTurn([JSON.stringify({ ...graph, entities: [] })]).turn });
expect("an answer that breaks the contract names the field", badShape.code === "contract" && /\$\.entities/.test(badShape.message), badShape?.message);

const agentError = await thrown({ turn: fakeTurn(["partial"], { fail: { type: "error", message: "429 too many requests" } }).turn });
expect("a turn error stops the import with the agent's reason", agentError.code === "agent" && /429/.test(agentError.message), agentError?.message);

const empty = await thrown({ turn: fakeTurn([]).turn });
expect("an empty answer is refused", empty.code === "empty", empty?.message);

const unreadable = await thrown({
	turn: fakeTurn([JSON.stringify(graph)]).turn,
	extract: async () => { throw new Error("that video has no readable length or picture"); },
});
expect("an unreadable clip is refused before any turn", unreadable.code === "frames" && /readable length/.test(unreadable.message), unreadable?.message);

const silentClip = await thrown({ turn: fakeTurn([JSON.stringify(graph)]).turn, extract: async () => ({ duration: 10, frames: [] }) });
expect("a clip that yields no stills is refused", silentClip.code === "frames", silentClip?.message);

const noFile = await thrown({ file: null, turn: fakeTurn([JSON.stringify(graph)]).turn });
expect("importing without a file is refused", noFile.code === "file", noFile?.message);

// ── Cancelling ─────────────────────────────────────────────────────────────
const controller = new AbortController();
const aborting = {
	turn: (request, onEvent, signal) => new Promise((resolve, reject) => {
		signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
		controller.abort();
		onEvent({ type: "text.delta", text: "{" });
	}),
};
let cancelled = null;
try {
	await runVideoImport({ file: { name: "clip.mp4" }, turn: aborting.turn, run: fakeRun().run, extract, signal: controller.signal });
} catch (error) {
	cancelled = error;
}
expect("a cancel surfaces as an abort, not as a contract refusal", cancelled?.name === "AbortError", cancelled?.name ?? "no error");

// ── The reader on its own ──────────────────────────────────────────────────
const reader = fakeTurn(["a", "b", "c"]);
let deltas = "";
const text = await askForSceneGraph({ turn: reader.turn, frames: frames().frames, duration: 10, onDelta: (answer) => { deltas = answer; } });
expect("the reader joins every text frame", text === "abc" && deltas === "abc", `${text} / ${deltas}`);
expect("the reader sends no model or effort when none was chosen", !("model" in reader.sent[0]) && !("effort" in reader.sent[0]));
expect("the reader carries a typed subject into the prompt", (await (async () => {
	const typed = fakeTurn(["not json, but not empty"]);
	await askForSceneGraph({ turn: typed.turn, frames: frames().frames, duration: 10, subject: "a kitchen at night" });
	return /a kitchen at night/.test(typed.sent[0].text);
})()));

console.log(failures === 0 ? "video import: all checks passed" : `${failures} video import check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
