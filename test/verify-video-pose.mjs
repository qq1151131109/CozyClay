#!/usr/bin/env node
import assert from "node:assert/strict";
import { poseQuality, assignPoseIds } from "../src/video-pose.js";

const body = (x = 0.5, visibility = 0.9) => Array.from({ length: 33 }, (_, index) => ({ x: x + (index % 2 ? 0.04 : -0.04), y: index / 33, z: 0, visibility }));
const first = assignPoseIds([], [body(0.25), body(0.75)], 0);
assert.equal(new Set(first.map((person) => person.id)).size, 2);
const swapped = assignPoseIds(first, [body(0.74), body(0.26)], 1);
assert.equal(swapped[0].id, first[1].id);
assert.equal(swapped[1].id, first[0].id);
assert.equal(swapped[0].frameIndex, 1);
assert.equal(assignPoseIds([], [body(0.25)], 24)[0].id, "person-24-0");
console.log("PASS nearby poses retain identity when detector order changes; shots can reset tracks");
const rows = [
	{ index: 0, people: first },
	{ index: 1, people: [] },
	{ index: 2, people: assignPoseIds([], [body(0.5, 0.1)], 2) },
];
const quality = poseQuality(rows);
assert.equal(quality.frameCount, 3);
assert.equal(quality.detectedFrames, 2);
assert.equal(quality.usableFrames, 1);
assert.deepEqual(quality.failedFrames, [1, 2]);
assert.equal(quality.readyForFitting, false);
assert.equal(poseQuality([]).readyForFitting, false);
assert.equal(poseQuality([{ index: 0, people: first }]).readyForFitting, true);
const partlyHidden = assignPoseIds([], [body(0.25), body(0.75, 0.1)], 0);
assert.equal(poseQuality([{ index: 0, people: partlyHidden }]).readyForFitting, false, "one good actor must not hide another actor's failed joints");
console.log("PASS missing and occluded poses fail fitting gate instead of being filled with invented motion");
console.log("video pose: all checks passed");
