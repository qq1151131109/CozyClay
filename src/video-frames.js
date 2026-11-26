// Sampling stills out of a reference video, in the browser: no ffmpeg, no
// upload, no server. The Studio's turn envelope accepts at most four
// attachments (bin/agent/agent-routes.mjs ATTACHMENTS_MAX), so a clip is read
// as four stills, one from the middle of each equal slice.

export const FRAME_PLAN = Object.freeze({ count: 4, maxWidth: 768, quality: 0.82, waitMs: 15000 });

/** The middle of each of `count` equal slices of the clip. The first and last
 * frames are the ones most likely to be black or a fade, so neither is used. */
export function frameTimes(durationSeconds, count = FRAME_PLAN.count) {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
	const frames = Math.max(1, Math.min(Math.floor(count), 8));
	return Array.from({ length: frames }, (_, index) => Math.round(((index + 0.5) * durationSeconds * 1000) / frames) / 1000);
}

/** The still's pixel size: at most `maxWidth` wide, the video's aspect kept. */
export function frameSize(width, height, maxWidth = FRAME_PLAN.maxWidth) {
	if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
	const scale = Math.min(1, maxWidth / width);
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const once = (target, name, waitMs) => new Promise((resolve, reject) => {
	const timer = setTimeout(() => { cleanup(); reject(new Error(`the video never fired ${name}`)); }, waitMs);
	const done = (event) => { cleanup(); resolve(event); };
	const failed = () => { cleanup(); reject(new Error("the browser could not read that video")); };
	function cleanup() {
		clearTimeout(timer);
		target.removeEventListener?.(name, done);
		target.removeEventListener?.("error", failed);
	}
	target.addEventListener?.(name, done);
	target.addEventListener?.("error", failed);
});

const seekTo = async (video, time, waitMs) => {
	if (Math.abs(Number(video.currentTime) - time) < 1e-3) return;
	const arrived = once(video, "seeked", waitMs);
	video.currentTime = time;
	await arrived;
};

/** The clip's length. Some files (a MediaRecorder webm, for one) carry no
 * duration in their header until the browser seeks past the end, so that seek
 * is the only way to make it answer; a clip that still will not say is 0. */
const readDuration = async (video, waitMs) => {
	const stated = Number(video.duration);
	if (Number.isFinite(stated) && stated > 0) return stated;
	const heard = once(video, "timeupdate", waitMs);
	video.currentTime = Number.MAX_SAFE_INTEGER;
	await heard.catch(() => {});
	const resolved = Number(video.duration);
	if (Number.isFinite(resolved) && resolved > 0) {
		await seekTo(video, 0, waitMs).catch(() => {});
		return resolved;
	}
	return 0;
};

/**
 * Still frames from a video File, as JPEG data URLs.
 *
 * Every browser handle is injectable so the sampling can be tested without a
 * DOM: `createVideo`/`createCanvas`/`createObjectUrl` stand in for the real
 * element factories.
 */
export async function extractFrames(file, {
	count = FRAME_PLAN.count,
	maxWidth = FRAME_PLAN.maxWidth,
	quality = FRAME_PLAN.quality,
	waitMs = FRAME_PLAN.waitMs,
	createObjectUrl = (blob) => URL.createObjectURL(blob),
	revokeObjectUrl = (url) => URL.revokeObjectURL(url),
	createVideo = () => document.createElement("video"),
	createCanvas = () => document.createElement("canvas"),
} = {}) {
	if (!file) throw new Error("no video file was given");
	const url = createObjectUrl(file);
	const video = createVideo();
	video.preload = "auto";
	video.muted = true;
	video.playsInline = true;
	video.src = url;
	try {
		await once(video, "loadedmetadata", waitMs);
		const duration = await readDuration(video, waitMs);
		const times = frameTimes(duration, count);
		const size = frameSize(Number(video.videoWidth), Number(video.videoHeight), maxWidth);
		if (!times.length || !size.width) throw new Error("that video has no readable length or picture");
		const canvas = createCanvas();
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("this browser gave no 2D canvas to read the frames with");
		const frames = [];
		for (const [index, time] of times.entries()) {
			await seekTo(video, time, waitMs);
			context.drawImage(video, 0, 0, size.width, size.height);
			frames.push({ index, time, width: size.width, height: size.height, dataUrl: canvas.toDataURL("image/jpeg", quality) });
		}
		return { duration, frames };
	} finally {
		video.removeAttribute?.("src");
		video.load?.();
		revokeObjectUrl(url);
	}
}
