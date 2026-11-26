import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { buildVideoTimeline, shotReferenceIndices } from "./video-timeline.js";

const MAX_FRAMES = 7200;

// Sequential presentation-order decoding, not seeking a <video> clock. Only a
// small decoder pool and the current canvas are live, even for a long clip.
export async function visitVideoFrames(file, { signal, maxWidth = 768, maxFrames = MAX_FRAMES } = {}, visit) {
	if (!(file instanceof Blob) || !file.size) throw new TypeError("Choose a nonempty video file.");
	if (!Number.isInteger(maxFrames) || maxFrames < 1 || !Number.isInteger(maxWidth) || maxWidth < 1) throw new RangeError("Invalid decode limits.");
	signal?.throwIfAborted();
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	const abort = () => input.dispose();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const track = await input.getPrimaryVideoTrack();
		signal?.throwIfAborted();
		if (!track || !(await track.canDecode())) throw new Error("This browser cannot decode the video's codec.");
		const width = track.displayWidth;
		const height = track.displayHeight;
		const sink = new CanvasSink(track, { width: Math.min(maxWidth, width), poolSize: 2 });
		let index = 0;
		for await (const sample of sink.canvases()) {
			signal?.throwIfAborted();
			if (index >= maxFrames) throw new RangeError(`Video analysis limit: ${maxFrames} frames. Choose a shorter clip.`);
			await visit({ ...sample, index, width, height });
			index += 1;
			if (index % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
		}
		signal?.throwIfAborted();
		return { width, height, frameCount: index };
	} catch (error) {
		signal?.throwIfAborted();
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		input.dispose();
	}
}

export async function analyzeVideo(file, { signal, maxFrames = MAX_FRAMES, onProgress, threshold } = {}) {
	const canvas = document.createElement("canvas");
	canvas.width = 96;
	canvas.height = 54;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	const frames = [];
	const size = await visitVideoFrames(file, { signal, maxFrames, maxWidth: 384 }, ({ canvas: decoded, index, timestamp, duration }) => {
		context.drawImage(decoded, 0, 0, 96, 54);
		const rgba = context.getImageData(0, 0, 96, 54).data;
		const signature = new Uint8Array(96 * 54);
		for (let pixel = 0; pixel < signature.length; pixel += 1) {
			const at = pixel * 4;
			signature[pixel] = Math.round(rgba[at] * 0.299 + rgba[at + 1] * 0.587 + rgba[at + 2] * 0.114);
		}
		frames.push({ index, timestamp, duration, signature });
		onProgress?.({ frameCount: frames.length, timestamp });
	});
	const { detectShotBoundaries } = await import("./video-timeline.js");
	const cuts = detectShotBoundaries(frames, { threshold });
	return { frames, timeline: buildVideoTimeline(frames, { ...size, cuts }) };
}

export async function collectShotReferences(file, { frames, timeline }, { signal, onProgress } = {}) {
	const selections = timeline.shots.map((shot) => shotReferenceIndices(frames, shot));
	const requested = new Set(selections.flat());
	const images = new Map();
	const canvas = document.createElement("canvas");
	await visitVideoFrames(file, { signal }, ({ canvas: decoded, index, timestamp }) => {
		if (!requested.has(index)) return;
		canvas.width = decoded.width;
		canvas.height = decoded.height;
		canvas.getContext("2d").drawImage(decoded, 0, 0);
		images.set(index, { index, time: timestamp, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
		onProgress?.({ collected: images.size, total: requested.size });
	});
	if (images.size !== requested.size) throw new Error("The decoded video changed; not all reference frames were found.");
	return selections.map((indices) => indices.map((index) => images.get(index)));
}
