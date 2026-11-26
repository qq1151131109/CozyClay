#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildVideoTimeline, detectShotBoundaries, frameDifference, shotReferenceIndices } from "../src/video-timeline.js";

const frames = [0, 4, 8, 200, 204, 208].map((value, index) => ({
	index, timestamp: 3 + index / 24, duration: 1 / 24, signature: new Uint8Array(16).fill(value),
}));
const timeline = buildVideoTimeline(frames, { width: 1280, height: 720 });
assert.equal(timeline.frameCount, 6);
assert.equal(timeline.origin, 3);
assert.ok(Math.abs(timeline.duration - 6 / 24) < 1e-8);
assert.deepEqual(timeline.shots.map(({ startFrame, endFrameExclusive }) => [startFrame, endFrameExclusive]), [[0, 3], [3, 6]]);
assert.equal(timeline.shots[1].startTime, frames[3].timestamp);
assert.equal(timeline.shots[0].endTime, frames[2].timestamp + frames[2].duration);
assert.ok(!("signature" in timeline.frames[0]), "portable ledger does not retain pixel buffers");
console.log("PASS source PTS and half-open shot ranges cover every frame exactly once");

const variable = [
	{ timestamp: -0.1, duration: 0.04 },
	{ timestamp: -0.06, duration: 0.08 },
	{ timestamp: 0.02, duration: 0.1 },
];
const vfr = buildVideoTimeline(variable, { width: 640, height: 360, cuts: [] });
assert.equal(vfr.origin, -0.1);
assert.deepEqual(vfr.frames.map((frame) => frame.timestamp), [-0.1, -0.06, 0.02]);
assert.ok(Math.abs(vfr.duration - 0.22) < 1e-9);
assert.equal(vfr.frameCount, 3);
console.log("PASS variable frame duration and negative origin are not resampled to 24 fps");

for (const bad of [NaN, Infinity, 0, -1]) {
	assert.throws(() => buildVideoTimeline([{ timestamp: 0, duration: bad }], { width: 10, height: 10, cuts: [] }), /timing/);
}
assert.throws(() => buildVideoTimeline([], { width: 10, height: 10 }), /no decoded frames/);
assert.throws(() => buildVideoTimeline([{ timestamp: NaN, duration: 1 }], { width: 10, height: 10, cuts: [] }), /timing/);
assert.throws(() => buildVideoTimeline([variable[0], variable[0]], { width: 10, height: 10, cuts: [] }), /presentation order/);
assert.throws(() => buildVideoTimeline(frames, { width: 0, height: 1 }), /dimensions/);
for (const boundary of [0, 6, -1, 1.5]) {
	assert.throws(() => buildVideoTimeline(frames, { width: 1, height: 1, cuts: [{ frameIndex: boundary }] }), /cuts/);
}
assert.throws(() => buildVideoTimeline(frames, { width: 1, height: 1, cuts: [{ frameIndex: 3 }, { frameIndex: 2 }] }), /cuts/);
assert.throws(() => detectShotBoundaries(frames, { threshold: 0 }), /settings/);
assert.throws(() => frameDifference(new Uint8Array(), new Uint8Array()), /signatures/);
console.log("PASS malformed timing, boundaries and detection settings are refused");

const edited = buildVideoTimeline(frames, { width: 1280, height: 720, cuts: [{ frameIndex: 2, kind: "manual" }, { frameIndex: 4, kind: "manual" }] });
assert.deepEqual(edited.shots.map((shot) => [shot.startFrame, shot.endFrameExclusive]), [[0, 2], [2, 4], [4, 6]]);
assert.deepEqual(edited.frames, timeline.frames);
assert.equal(edited.duration, timeline.duration);
console.log("PASS manual cuts only change shot partition, never source frame timing");

assert.deepEqual(shotReferenceIndices(frames, timeline.shots[0]), [0, 1, 2]);
assert.deepEqual(shotReferenceIndices(frames, timeline.shots[1]), [3, 4, 5]);
assert.deepEqual(shotReferenceIndices(frames, { startFrame: 2, endFrameExclusive: 3 }), [2]);
assert.deepEqual(shotReferenceIndices(frames, timeline.shots[0], 1), [0]);
assert.throws(() => shotReferenceIndices(frames, timeline.shots[0], 8), /reference/);
assert.throws(() => shotReferenceIndices(frames, { startFrame: 4, endFrameExclusive: 4 }), /range/);
const changing = [0, 0, 0, 100, 0, 0].map((value, index) => ({ ...frames[index], signature: new Uint8Array(16).fill(value) }));
assert.ok(shotReferenceIndices(changing, { startFrame: 0, endFrameExclusive: 6 }, 3).includes(3));
console.log("PASS reference selection covers endpoints and content changes without crossing cuts");
console.log("video timeline: all checks passed");
