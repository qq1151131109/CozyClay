import { useState } from "react";
import { useVideoAnalysis } from "../use-video-analysis.js";
import VideoFrameReview from "./VideoFrameReview.jsx";
import "./video-import.css";

export default function VideoAnalysisPanel({ onClose, onImportShot }) {
	const { state, selectFile, editCuts, readShot, trackPeople, cancel } = useVideoAnalysis();
	const [frameIndex, setFrameIndex] = useState(0);
	const [cutText, setCutText] = useState("");
	const [cutError, setCutError] = useState(null);
	const [importing, setImporting] = useState(false);
	const [installed, setInstalled] = useState({});
	const { timeline } = state.analysis ?? {};
	const busy = state.busy || importing;
	const frame = timeline?.frames[Math.min(frameIndex, timeline.frameCount - 1)];
	const shot = timeline?.shots.find((entry) => frame.index >= entry.startFrame && frame.index < entry.endFrameExclusive);
	const applyCuts = () => {
		const values = cutText.trim() ? cutText.split(",").map((text) => Number(text.trim())) : [];
		if (values.some((value, index) => !Number.isInteger(value) || value <= (values[index - 1] ?? 0) || value >= timeline.frameCount)) {
			setCutError("切点须为递增帧号，位于 1 和最后一帧之间。使用从 0 开始的帧号。");
			return;
		}
		setCutError(null);
		void editCuts(values).then((ok) => { if (ok) setInstalled({}); });
	};
	const download = () => {
		const blob = new Blob([JSON.stringify({ version: 1, source: { name: state.file.name, size: state.file.size, lastModified: state.file.lastModified }, timeline, graphs: state.graphs, poses: state.poses, installedScenes: installed }, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "cozyclay-frame-analysis.json";
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	const importShot = async (entry) => {
		setImporting(true);
		try {
			const result = await onImportShot(state.graphs[entry.id].graph, entry);
			setInstalled((before) => ({ ...before, [entry.id]: result }));
		}
		catch (error) { setCutError(error.message); }
		finally { setImporting(false); }
	};
	return <div className="video-import-backdrop" role="presentation">
		<section className="video-import video-analysis" role="dialog" aria-modal="true" aria-label="逐帧视频分析" data-testid="video-analysis">
			<header className="video-import-head"><h2>视频 → 逐帧分镜</h2><button type="button" className="video-import-close" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
			<p className="video-import-hint">完整解码每一帧并保留原始时间戳。先检查镜头边界与人物观测，再建立白模；静态布景不代表动作已还原。关闭前可下载分析报告，原视频需自行保留。</p>
			<div className="video-import-actions">
				<label className="video-analysis-picker">选择视频<input type="file" accept="video/*" disabled={busy} data-testid="video-analysis-file" onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) { setFrameIndex(0); setCutError(null); setCutText(""); setInstalled({}); void selectFile(file); }
				}} /></label>
				{state.busy ? <button type="button" onClick={cancel}>取消</button> : null}
			</div>
			{state.message ? <p role="status" className="video-import-status">{state.message}</p> : null}
			{state.error || cutError ? <p role="alert" className="video-import-error">{state.error || cutError}</p> : null}
			{timeline ? <>
				<p data-testid="video-analysis-summary">{timeline.frameCount} 帧 · {timeline.duration.toFixed(6)} 秒 · {timeline.width}×{timeline.height} · {timeline.shots.length} 个镜头区间（候选边界需核对）</p>
				<VideoFrameReview file={state.file} frame={frame} observation={state.poses?.frames[frame.index]} />
				<div className="video-import-actions">
					<button type="button" disabled={busy || frame.index === 0} onClick={() => setFrameIndex(frame.index - 1)}>上一帧</button>
					<label>源帧 <input type="number" min="0" max={timeline.frameCount - 1} value={frame.index} disabled={busy} onChange={(event) => setFrameIndex(Math.max(0, Math.min(timeline.frameCount - 1, Math.round(Number(event.target.value)) || 0)))} /></label>
					<button type="button" disabled={busy || frame.index === timeline.frameCount - 1} onClick={() => setFrameIndex(frame.index + 1)}>下一帧</button>
				</div>
				<p className="video-import-hint">从 0 计数 · PTS {frame.timestamp.toFixed(6)}s · {shot.id} · {state.poses ? (state.poses.frames[frame.index]?.people.length && state.poses.frames[frame.index].people.every((person) => person.usable && !person.identityUncertain) ? "存在可用身体关节观测，仍需检查身份和遗漏" : "身体关节不足：需要修正或专用跟踪") : "尚未检测人物"}</p>
				<label className="video-import-subject">切点帧号（逗号分隔；留空并应用可合成一个镜头）
					<input placeholder={timeline.cuts.map((cut) => cut.frameIndex).join(", ")} value={cutText} disabled={busy} onChange={(event) => setCutText(event.target.value)} />
				</label>
				<div className="video-import-actions"><button type="button" disabled={busy} onClick={applyCuts}>应用切点</button><button type="button" disabled={busy} onClick={trackPeople} data-testid="video-track-people">本机逐帧检查人物</button><button type="button" disabled={busy} onClick={download} data-testid="video-analysis-download">下载逐帧分析 JSON</button></div>
				{state.poses ? <><p data-testid="video-pose-summary">人物观测：{state.poses.quality.usableFrames} / {timeline.frameCount} 帧通过身体关节检查。{state.poses.quality.readyForFitting ? "可进入拟合验证，尚未生成三维动作。" : `${state.poses.quality.failedFrames.length} 帧待修正，未生成三维动作。`}</p><div className="video-import-actions"><button type="button" disabled={busy || !state.poses.quality.failedFrames.some((value) => value > frame.index)} onClick={() => setFrameIndex(state.poses.quality.failedFrames.find((value) => value > frame.index))}>下一个观测不足帧</button><span>青色：可见关节；橙色：关节不足。检测通过仍不代表多人全部找到。</span></div></> : null}
				<p className="video-import-hint">“分析布景”会将该镜头最多 4 张参考帧发给已配置的视觉模型，产生模型用量。只返回场景描述，不授予编辑工具。</p>
				<div className="video-analysis-shots">{timeline.shots.map((entry, index) => <article key={`${entry.startFrame}-${entry.endFrameExclusive}`}>
					<strong>{entry.id} · 帧 {entry.startFrame}–{entry.endFrameExclusive - 1}</strong>
					<div className="video-analysis-stills">{state.references[index]?.map((image) => <button type="button" key={image.index} disabled={busy} onClick={() => setFrameIndex(image.index)} title={`查看源帧 ${image.index}`}><img src={image.dataUrl} alt={`参考帧 ${image.index}`} /><span>{image.index}</span></button>)}</div>
					<div className="video-import-actions"><button type="button" disabled={busy} onClick={() => readShot(index)}>分析此镜头布景</button>{state.graphs[entry.id] ? <button type="button" disabled={busy || Boolean(installed[entry.id])} onClick={() => importShot(entry)}>{installed[entry.id] ? "已建立独立静态场景" : "在独立场景中建立静态布景"}</button> : null}</div>
					{state.graphs[entry.id] ? <p>{state.graphs[entry.id].graph.subject} · {state.graphs[entry.id].graph.entities.length} 个基本体</p> : null}
				</article>)}</div>
			</> : null}
		</section>
	</div>;
}
