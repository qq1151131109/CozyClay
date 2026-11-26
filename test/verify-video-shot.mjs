#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeVideoShot, videoShotFailure } from "../bin/agent/video-shot.mjs";
import { importVideoShot } from "../src/video-shot-import.js";

const picture = { index: 184, time: 7.666667, dataUrl: "data:image/jpeg;base64,YQ==" };
let received;
const models = {
	getProvider: () => ({}),
	getModel: () => ({ id: "vision", provider: "fixture", input: ["text", "image"] }),
	complete: async (...args) => {
		received = args;
		return { stopReason: "stop", content: [{ type: "text", text: '{"version":1}' }], usage: { input: 2, output: 3 } };
	},
};
const control = new AbortController();
const result = await analyzeVideoShot({ model: "fixture/vision", frames: [picture], subject: "a room", models, signal: control.signal });
assert.equal(result.text, '{"version":1}');
assert.deepEqual(received[1].tools, []);
assert.equal(received[2].signal, control.signal);
assert.equal(received[2].maxTokens, 4096);
assert.equal(received[1].messages[0].content[1].type, "image");
assert.equal(received[1].messages[0].content[1].data, "YQ==");
assert.match(received[1].messages[0].content[0].text, /184/);
assert.match(received[1].messages[0].content[0].text, /7\.666667/);
assert.match(received[1].messages[0].content[0].text, /single shot/);
assert.deepEqual(result.usage, { input: 2, output: 3 });
console.log("PASS shot analysis sends exact source frame labels with no agent tools and bounded output");
for (const frames of [[], Array(5).fill(picture), [{ ...picture, index: -1 }], [{ ...picture, dataUrl: "https://example.com/image.jpg" }]]) {
	await assert.rejects(analyzeVideoShot({ model: "fixture/vision", frames, models }), /frames/);
}
await assert.rejects(analyzeVideoShot({ model: "fixture/vision", frames: [picture], models: { ...models, getModel: () => ({ input: ["text"] }) } }), /image/);
control.abort();
await assert.rejects(analyzeVideoShot({ model: "fixture/vision", frames: [picture], models, signal: control.signal }), { name: "AbortError" });
console.log("PASS invalid images, text-only models and cancelled requests never start vision inference");
assert.equal(videoShotFailure(Object.assign(new Error("rate limit"), { status: 429, retryAfter: 30 })).status, 429);
assert.equal(videoShotFailure(Object.assign(new Error("expired credential"), { status: 401 })).code, "AUTH_REQUIRED");
assert.equal(videoShotFailure(new Error("429 too many requests")).status, 429);
assert.equal(videoShotFailure(new TypeError("invalid frames")).status, 400);
assert.equal(videoShotFailure(new Error("transport failed")).status, 502);
assert.equal(videoShotFailure(new DOMException("cancelled", "AbortError")).code, "CANCELLED");
assert.equal(videoShotFailure(Object.assign(new Error("rate limit"), { status: 429, retryAfter: 30 })).retryAfter, 30);
console.log("PASS provider auth, rate limits, invalid input and transport failures remain distinguishable");
const graph = { version: 1, entities: [{ kind: "cube", name: "wall", position: [0, 1, 0], size: [2, 2, 1], rot: 0 }], camera: { position: [0, 2, -3], lookAt: [0, 1, 0], focalMm: 35 } };
const shot = { id: "shot-1", startFrame: 0, endFrameExclusive: 184, startTime: 0, endTime: 184 / 24 };
const calls = [];
const run = async (action, args) => {
	calls.push([action, args]);
	return { ok: true, affectedIds: action === "scene.create" ? ["new-scene"] : action === "shot.create" ? ["new-shot"] : action === "object.add" ? ["new-wall"] : [] };
};
const imported = await importVideoShot({ run, graph, shot, originalSceneId: "original" });
assert.equal(imported.sceneId, "new-scene");
assert.equal(imported.shotId, "new-shot");
assert.ok(calls.some(([action, args]) => action === "shot.setRange" && args.endFrameExclusive === 184));
assert.ok(calls.findIndex(([action]) => action === "shot.setTimeline") < calls.findIndex(([action]) => action === "shot.create"));
for (const failed of ["scene.rename", "object.add", "object.update", "shot.create", "shot.placeCamera", "shot.setRange"]) {
	calls.length = 0;
	await assert.rejects(importVideoShot({ run: async (action, args) => action === failed ? { ok: false, message: `refused ${action}` } : run(action, args), graph, shot, originalSceneId: "original" }), /refused/);
	assert.ok(calls.some(([action, args]) => action === "scene.delete" && args.sceneId === "new-scene"));
	assert.ok(!calls.some(([action, args]) => action === "scene.delete" && args.sceneId === "original"));
	assert.ok(calls.some(([action, args]) => action === "scene.switch" && args.sceneId === "original"));
}
console.log("PASS every refused import operation stops and cleans only its new scene, preserving the original");
console.log("video shot: all checks passed");
