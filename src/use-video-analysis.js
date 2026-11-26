import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeVideo, collectShotReferences } from "./video-decode.js";
import { buildVideoTimeline } from "./video-timeline.js";
import { parseSceneGraph } from "./scene-graph.js";
import { createAgentTransport } from "./workflow/agent-client.js";
import { pickImageModel } from "./video-import-model.js";

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
				setState((before) => ({ ...before, busy: false, message: control.signal.aborted ? "已取消；未完成的结果没有写入。" : "" }));
			}
		}
	}, []);
	const selectFile = useCallback((file) => execute(async (signal, publish) => {
		publish({ ...IDLE, busy: true, file, message: "正在按显示顺序解码全部帧…" });
		const analysis = await analyzeVideo(file, { signal, onProgress: ({ frameCount }) => {
			if (frameCount % 12 === 0) publish({ message: `已解码 ${frameCount} 帧…` });
		} });
		publish({ message: "正在提取各镜头的参考帧…" });
		const references = await collectShotReferences(file, analysis, { signal });
		publish({ analysis, references });
	}), [execute]);
	const editCuts = useCallback((indices) => execute(async (signal, publish) => {
		const { analysis, file } = state;
		const timeline = buildVideoTimeline(analysis.frames, { ...analysis.timeline, cuts: indices.map((frameIndex) => ({ frameIndex, kind: "manual", timestamp: analysis.frames[frameIndex]?.timestamp })) });
		const next = { frames: analysis.frames, timeline };
		publish({ message: "正在按新边界重新提取参考帧…" });
		const references = await collectShotReferences(file, next, { signal });
		publish({ analysis: next, references, graphs: {}, poses: null });
	}), [execute, state]);
	const readShot = useCallback((index) => execute(async (signal, publish) => {
		const model = pickImageModel(await transport.models());
		if (!model) throw new Error("请先配置支持图像输入的模型。不会回退到未配置的模型。");
		publish({ message: `正在用 ${model} 分析镜头 ${index + 1}（单次视觉请求）…` });
		const response = await fetch("/agent/video-shot", {
			method: "POST", headers: { "content-type": "application/json" }, signal,
			body: JSON.stringify({ model, frames: state.references[index] }),
		});
		const answer = await response.json();
		if (!response.ok) throw new Error(`${answer.error || "镜头分析失败。"}${answer.retryAfter ? ` 建议 ${answer.retryAfter} 秒后重试。` : ""}`);
		const parsed = parseSceneGraph(answer.text);
		if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.error}`);
		publish({ graphs: { ...state.graphs, [state.analysis.timeline.shots[index].id]: { graph: parsed.graph, fitted: parsed.fitted, model, usage: answer.usage } } });
	}), [execute, state, transport]);
	const trackPeople = useCallback(() => execute(async (signal, publish) => {
		publish({ message: "正在下载人体姿态模型（仅下载模型，视频在本机处理）…" });
		const { trackVideoPoses } = await import("./video-pose-detection.js");
		const poses = await trackVideoPoses(state.file, { signal, timeline: state.analysis.timeline, onProgress: ({ frameCount }) => {
			if (frameCount % 12 === 0) publish({ message: `已检查人物姿态 ${frameCount} / ${state.analysis.timeline.frameCount} 帧…` });
		} });
		publish({ poses });
	}), [execute, state]);
	return { state, selectFile, editCuts, readShot, trackPeople, cancel };
}
