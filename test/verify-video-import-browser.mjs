#!/usr/bin/env node
/**
 * The video → blockout dialog, in a real browser.
 *
 * A clip is recorded in the page with MediaRecorder (no fixture file, no
 * ffmpeg), attached to the dialog's own file input, and the import is watched
 * until it either places a blockout or explains why it could not. The turn
 * needs a signed-in provider, so on a bare machine the run is expected to stop
 * at the agent with a readable reason — what this proves is that the clip was
 * read, the four stills were sampled, and the failure is reported instead of
 * hanging.
 *
 * Run: `npm run dev:ui -- --port 5191` then
 * `QA_URL=http://127.0.0.1:5191/app/ CDP_PORT=9322 npm run qa:browser -- node test/verify-video-import-browser.mjs`.
 */
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.CDP_PORT || 9222);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
if (!page) throw new Error("no page target on the QA browser");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
	const id = nextId++;
	pending.set(id, resolve);
	ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
	const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? "the page threw");
	return reply.result?.result?.value;
};

let failures = 0;
const check = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};
const until = async (expression, label, tries = 60) => {
	for (let index = 0; index < tries; index += 1) {
		if (await evalJs(expression)) return true;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`never appeared: ${label}`);
};

await send("Runtime.enable");
await send("DOM.enable");

const workspace = mkdtempSync(join(tmpdir(), "cozyclay-video-import-"));
try {
	// 1. The command is offered, and the dialog it opens is the one we expect.
	await until("Boolean(document.querySelector('[data-testid=\"topbar-video-import\"]'))", "the topbar command");
	check("the topbar offers the video → blockout command", true);
	check("the dialog starts closed", !(await evalJs("Boolean(document.querySelector('[data-testid=\"video-import\"]'))")));
	await evalJs("document.querySelector('[data-testid=\"topbar-video-import\"]').click()");
	await until("Boolean(document.querySelector('[data-testid=\"video-import\"]'))", "the dialog");
	check("clicking the command opens the dialog", true);
	check("the picker accepts video only", await evalJs("document.querySelector('.video-import input[type=file]')?.accept === 'video/*'"));

	// 2. Frame sampling on a real clip: a recorded webm has no length in its
	//    header, so this also covers the seek-past-the-end read.
	const probe = await evalJs(`(async () => {
		const { extractFrames } = await import('/src/video-frames.js');
		const canvas = document.createElement('canvas');
		canvas.width = 640; canvas.height = 360;
		const context = canvas.getContext('2d');
		const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
		const chunks = [];
		recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
		const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
		recorder.start();
		const started = performance.now();
		await new Promise((resolve) => {
			const paint = () => {
				const seconds = (performance.now() - started) / 1000;
				context.fillStyle = seconds < 0.5 ? '#c33' : seconds < 1 ? '#3c3' : '#33c';
				context.fillRect(0, 0, 640, 360);
				if (seconds < 1.6) requestAnimationFrame(paint); else resolve();
			};
			paint();
		});
		recorder.stop();
		await stopped;
		const blob = new Blob(chunks, { type: 'video/webm' });
		const read = await extractFrames(new File([blob], 'probe.webm', { type: 'video/webm' }), { count: 4 });
		const first = read.frames[0];
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return JSON.stringify({
			duration: Math.round(read.duration * 100) / 100,
			frames: read.frames.length,
			width: first && first.width,
			height: first && first.height,
			jpeg: first && first.dataUrl.slice(0, 22),
			paints: new Set(read.frames.map((frame) => frame.dataUrl)).size,
			clip: btoa(binary),
		});
	})()`);
	const read = JSON.parse(probe);
	check("a real clip yields four stills", read.frames === 4, String(read.frames));
	check("a recorded clip's length resolves", read.duration > 1 && read.duration < 4, String(read.duration));
	check("a still keeps the clip's aspect", read.width === 640 && read.height === 360, `${read.width}x${read.height}`);
	check("a still is a JPEG data URL", /^data:image\/jpeg/.test(read.jpeg || ""), String(read.jpeg));
	check("the stills are not one repeated picture", read.paints > 1, String(read.paints));

	// 3. The dialog's own pipeline: attach the clip, watch it to a blockout or a reason.
	const clip = join(workspace, "probe.webm");
	writeFileSync(clip, Buffer.from(read.clip, "base64"));
	const { result } = await send("Runtime.evaluate", { expression: "document.querySelector('.video-import input[type=file]')" });
	if (!result?.result?.objectId) throw new Error("the dialog's file input vanished");
	await send("DOM.setFileInputFiles", { files: [clip], objectId: result.result.objectId });

	const readState = async () => JSON.parse(await evalJs(`(() => {
		const status = document.querySelector('.video-import-status')?.textContent || '';
		const error = document.querySelector('.video-import-error')?.textContent || '';
		const done = document.querySelector('.video-import-done')?.textContent || '';
		return JSON.stringify({ status, error, done });
	})()`) || "{}");
	let state = { status: "", error: "", done: "" };
	for (let index = 0; index < 90; index += 1) {
		state = await readState();
		if (state.done || state.error) break;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	console.log(`  run: ${JSON.stringify(state)}`);
	check("the import reads its stills from the clip", Boolean(state.done) || /4 stills/.test(state.status), state.status);
	check("a turn that cannot run is reported, not left hanging", Boolean(state.done) || Boolean(state.error), state.status);
	// The whole point: a turn that can run places the blockout through the bus.
	const placed = /Placed (\d+) set pieces/.exec(state.done || "");
	check("the agent's answer became set pieces on the stage", Boolean(placed) && Number(placed[1]) > 0, state.done || state.error);

	await evalJs("document.querySelector('.video-import-close')?.click()");
	await new Promise((resolve) => setTimeout(resolve, 300));
	check("closing removes the dialog", !(await evalJs("Boolean(document.querySelector('[data-testid=\"video-import\"]'))")));
} finally {
	rmSync(workspace, { recursive: true, force: true });
	ws.close();
}

console.log(failures === 0 ? "video import browser: all checks passed" : `${failures} video import browser check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
