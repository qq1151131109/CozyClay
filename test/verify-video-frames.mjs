#!/usr/bin/env node
// Frame sampling for a video import, against fake media elements: the timing
// math, the downscale, and the two ways a browser can refuse a clip.
import { extractFrames, frameSize, frameTimes, FRAME_PLAN } from "../src/video-frames.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

/** A <video> stand-in: metadata on src, seeked on every currentTime write.
 * `lateDuration` mimics a header-less clip (a MediaRecorder webm): its length
 * only appears after a seek past the end. */
function fakeMedia({ duration = 10, width = 1920, height = 1080, stalls = false, lateDuration = null } = {}) {
	const listeners = new Map();
	let time = 0;
	let length = lateDuration === null ? duration : Number.POSITIVE_INFINITY;
	return {
		get duration() { return length; },
		videoWidth: width,
		videoHeight: height,
		removed: false,
		loaded: false,
		addEventListener(name, fn) {
			if (!listeners.has(name)) listeners.set(name, new Set());
			listeners.get(name).add(fn);
		},
		removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
		emit(name) { for (const fn of [...(listeners.get(name) ?? [])]) fn({ type: name }); },
		removeAttribute() { this.removed = true; },
		load() { this.loaded = true; },
		get currentTime() { return time; },
		set currentTime(value) {
			time = value;
			if (lateDuration !== null && value > 1e6) {
				length = lateDuration;
				setTimeout(() => this.emit("timeupdate"), 0);
				return;
			}
			if (!stalls) setTimeout(() => this.emit("seeked"), 0);
		},
		set src(value) {
			this.source = value;
			setTimeout(() => this.emit("loadedmetadata"), 0);
		},
		get src() { return this.source; },
	};
}

/** A canvas stand-in that records what was drawn and returns a short data URL. */
function fakeCanvas() {
	const draws = [];
	return {
		draws,
		width: 0,
		height: 0,
		getContext: () => ({ drawImage: (_video, _x, _y, width, height) => { draws.push({ width, height }); } }),
		toDataURL: (type, quality) => `data:${type};base64,${draws.length}@${quality}`,
	};
}

// ── The slice math ─────────────────────────────────────────────────────────
expect("four stills land in the middle of four equal slices", JSON.stringify(frameTimes(10)) === "[1.25,3.75,6.25,8.75]", JSON.stringify(frameTimes(10)));
expect("a one-second clip still spreads its four stills across the second", JSON.stringify(frameTimes(1, 4)) === "[0.125,0.375,0.625,0.875]", JSON.stringify(frameTimes(1, 4)));
expect("a clip with no length yields no stills", frameTimes(0).length === 0 && frameTimes(Number.NaN).length === 0);
expect("the count is clamped to the turn's attachment ceiling", frameTimes(10, 99).length === 8);
expect("the default plan is four stills at the turn's ceiling", FRAME_PLAN.count === 4 && FRAME_PLAN.maxWidth === 768, JSON.stringify(FRAME_PLAN));

// ── The downscale ──────────────────────────────────────────────────────────
const wide = frameSize(1920, 1080);
expect("a 1920-wide still lands at the 768 px ceiling, aspect kept", wide.width === 768 && wide.height === 432, JSON.stringify(wide));
const small = frameSize(640, 360);
expect("a still already under the ceiling is not upscaled", small.width === 640 && small.height === 360, JSON.stringify(small));
const broken = frameSize(0, 0);
expect("a still with no size is refused by the caller", broken.width === 0 && broken.height === 0);

// ── Reading a clip ─────────────────────────────────────────────────────────
const revoked = [];
const url = await extractFrames({ name: "clip.mp4" }, {
	createObjectUrl: () => "blob:clip",
	revokeObjectUrl: (value) => revoked.push(value),
	createVideo: () => fakeMedia({ duration: 10 }),
	createCanvas: fakeCanvas,
});
expect("a clip yields one still per slice", url.frames.length === 4, String(url.frames.length));
expect("each still carries the time it was taken at", JSON.stringify(url.frames.map((frame) => frame.time)) === "[1.25,3.75,6.25,8.75]");
expect("each still is a JPEG data URL", url.frames.every((frame) => frame.dataUrl.startsWith("data:image/jpeg;base64,")));
expect("each still was drawn at the scaled size", url.frames.every((frame) => frame.width === 768 && frame.height === 432));
expect("the clip's own duration comes back", url.duration === 10);
expect("the object URL is revoked", revoked.length === 1 && revoked[0] === "blob:clip", JSON.stringify(revoked));

let stalls = null;
try {
	await extractFrames({ name: "clip.mp4" }, {
		waitMs: 20,
		createObjectUrl: () => "blob:clip",
		revokeObjectUrl: () => {},
		createVideo: () => fakeMedia({ stalls: true }),
		createCanvas: fakeCanvas,
	});
} catch (error) {
	stalls = error;
}
expect("a browser that never reports a seek is reported, not hung", Boolean(stalls) && /seeked/.test(stalls.message), stalls?.message ?? "no error");

let unreadable = null;try {
	await extractFrames({ name: "clip.mp4" }, {
		waitMs: 50,
		createObjectUrl: () => "blob:clip",
		revokeObjectUrl: () => {},
		createVideo: () => fakeMedia({ duration: 0 }),
		createCanvas: fakeCanvas,
	});
} catch (error) {
	unreadable = error;
}
expect("a clip with no length is refused with a reason", Boolean(unreadable) && /no readable length/.test(unreadable.message), unreadable?.message ?? "no error");

const late = await extractFrames({ name: "recorded.webm" }, {
	waitMs: 200,
	createObjectUrl: () => "blob:late",
	revokeObjectUrl: () => {},
	createVideo: () => fakeMedia({ duration: 0, lateDuration: 8 }),
	createCanvas: fakeCanvas,
});
expect("a header-less clip (a recorded webm) still reports its length", late.duration === 8 && late.frames.length === 4, `${late.duration} / ${late.frames.length}`);

console.log(failures === 0 ? "video frames: all checks passed" : `${failures} video frame check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
