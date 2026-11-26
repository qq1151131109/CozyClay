import { PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoader from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinary from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { visitVideoFrames } from "./video-decode.js";
import { assignPoseIds, poseQuality } from "./video-pose.js";

const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
let modelBytes;

async function loadModel(signal) {
	if (modelBytes) return modelBytes;
	const response = await fetch(POSE_MODEL, { signal });
	if (!response.ok) throw new Error(`Pose model download failed (${response.status}).`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	signal?.throwIfAborted();
	modelBytes = bytes;
	return bytes;
}

export async function trackVideoPoses(file, { signal, onProgress, timeline, maxFrames = 7200 } = {}) {
	const modelAssetBuffer = await loadModel(signal);
	signal?.throwIfAborted();
	const createDetector = () => PoseLandmarker.createFromOptions({ wasmLoaderPath: wasmLoader, wasmBinaryPath: wasmBinary }, {
		baseOptions: { modelAssetBuffer, delegate: "GPU" },
		runningMode: "VIDEO", numPoses: 4, minPoseDetectionConfidence: 0.45,
		minPosePresenceConfidence: 0.45, minTrackingConfidence: 0.45,
	});
	let detector = await createDetector();
	const boundaries = new Set(timeline?.shots.slice(1).map((shot) => shot.startFrame) ?? []);
	const frames = [];
	let previous = [];
	let origin;
	try {
		await visitVideoFrames(file, { signal, maxFrames }, async ({ canvas, index, timestamp, duration }) => {
			if (boundaries.has(index)) {
				detector.close();
				detector = await createDetector();
				previous = [];
			}
			signal?.throwIfAborted();
			origin ??= timestamp;
			const result = detector.detectForVideo(canvas, (timestamp - origin) * 1000);
			const poses = (result.landmarks ?? []).map((landmarks) => landmarks.map((point) => ({
				x: point.x, y: point.y, z: point.z, visibility: point.visibility ?? 0,
			})));
			const people = assignPoseIds(previous, poses, index);
			previous = people;
			frames.push({ index, timestamp, duration, people });
			onProgress?.({ frameCount: frames.length, timestamp, people: people.length });
		});
		return { frames, quality: poseQuality(frames) };
	} finally {
		detector.close();
	}
}
