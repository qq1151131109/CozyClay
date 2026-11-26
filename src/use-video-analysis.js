import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeVideo, collectShotReferences } from "./video-decode.js";
import { buildVideoTimeline } from "./video-timeline.js";
import { parseSceneGraph } from "./scene-graph.js";
import { createAgentTransport } from "./workflow/agent-client.js";
import { pickImageModel } from "./video-import-model.js";
import { videoText as text } from "./video-analysis-copy.js";

const IDLE = { busy: false, error: null, message: "", file: null, analysis: null, references: [], graphs: {}, poses: null };

export function useVideoAnalysis() {
	const [state, setState] = useState(IDLE);
	const [transport] = useState(() => createAgentTransport({ surface: "studio" }));
	const current = useRef(null);
	useEffect(() => () => current.current?.abort(), []);
	const cancel = useCallback(() => { current.current?.abort(); }, []);
	const execute = useCallback(async (work) => {
		current.current?.abort();
		const control = new AbortController();
		current.current = control;
		const publish = (patch) => {
			if (current.current === control && !control.signal.aborted) setState((before) => ({ ...before, ...patch }));
		};
		publish({ busy: true, error: null });
		try {
			await work(control.signal, publish);
			return !control.signal.aborted;
		} catch (error) {
			if (error.name !== "AbortError") publish({ error: error.message });
			return false;
		} finally {
			if (current.current === control) {
				current.current = null;
				setState((before) => ({ ...before, busy: false, message: control.signal.aborted ? text.cancelled : "" }));
			}
		}
	}, []);
	const selectFile = useCallback((file) => execute(async (signal, publish) => {
		publish({ ...IDLE, busy: true, file, message: text.decoding });
		const analysis = await analyzeVideo(file, { signal, onProgress: ({ frameCount }) => {
			if (frameCount % 12 === 0) publish({ message: text.decoded(frameCount) });
		} });
		publish({ message: text.references });
		const references = await collectShotReferences(file, analysis, { signal });
		publish({ analysis, references });
	}), [execute]);
	const editCuts = useCallback((indices) => execute(async (signal, publish) => {
		const { analysis, file } = state;
		const timeline = buildVideoTimeline(analysis.frames, { ...analysis.timeline, cuts: indices.map((frameIndex) => ({ frameIndex, kind: "manual", timestamp: analysis.frames[frameIndex]?.timestamp })) });
		const next = { frames: analysis.frames, timeline };
		publish({ message: text.newReferences });
		const references = await collectShotReferences(file, next, { signal });
		publish({ analysis: next, references, graphs: {}, poses: null });
	}), [execute, state]);
	const readShot = useCallback((index) => execute(async (signal, publish) => {
		const model = pickImageModel(await transport.models());
		if (!model) throw new Error(text.noModel);
		publish({ message: text.readingShot(model, index) });
		const response = await fetch("/agent/video-shot", {
			method: "POST", headers: { "content-type": "application/json" }, signal,
			body: JSON.stringify({ model, frames: state.references[index] }),
		});
		const answer = await response.json();
		const failure = { AUTH_REQUIRED: text.authFailed, RATE_LIMITED: text.rateLimited, UPSTREAM_FAILED: text.upstreamFailed }[answer.code];
		if (!response.ok) throw new Error(`${failure || answer.error || text.visionFailed}${answer.retryAfter ? text.retry(answer.retryAfter) : ""}`);
		const parsed = parseSceneGraph(answer.text);
		if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.error}`);
		publish({ graphs: { ...state.graphs, [state.analysis.timeline.shots[index].id]: { graph: parsed.graph, fitted: parsed.fitted, model, usage: answer.usage } } });
	}), [execute, state, transport]);
	const trackPeople = useCallback(() => execute(async (signal, publish) => {
		publish({ message: text.modelDownload });
		const { trackVideoPoses } = await import("./video-pose-detection.js");
		const poses = await trackVideoPoses(state.file, { signal, timeline: state.analysis.timeline, onProgress: ({ frameCount }) => {
			if (frameCount % 12 === 0) publish({ message: text.poseProgress(frameCount, state.analysis.timeline.frameCount) });
		} });
		publish({ poses });
	}), [execute, state]);
	return { state, selectFile, editCuts, readShot, trackPeople, cancel };
}
