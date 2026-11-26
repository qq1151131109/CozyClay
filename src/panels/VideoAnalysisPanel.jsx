import { useState } from "react";
import { useVideoAnalysis } from "../use-video-analysis.js";
import { videoText as text } from "../video-analysis-copy.js";
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
	const observation = state.poses?.frames[frame?.index];
	const observed = observation?.people.length && observation.people.every((person) => person.usable && !person.identityUncertain);
	const applyCuts = () => {
		const values = cutText.trim() ? cutText.split(",").map((value) => Number(value.trim())) : [];
		if (values.some((value, index) => !Number.isInteger(value) || value <= (values[index - 1] ?? 0) || value >= timeline.frameCount)) {
			setCutError(text.cutError);
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
		} catch (error) { setCutError(error.message); }
		finally { setImporting(false); }
	};
	return <div className="video-import-backdrop" role="presentation">
		<section className="video-import video-analysis" role="dialog" aria-modal="true" aria-label={text.title} data-testid="video-analysis">
			<header className="video-import-head"><h2>{text.title}</h2><button type="button" className="video-import-close" aria-label={text.close} disabled={busy} onClick={onClose}>×</button></header>
			<p className="video-import-hint">{text.hint}</p>
			<div className="video-import-actions">
				<label className="video-analysis-picker">{text.choose}<input type="file" accept="video/*" disabled={busy} data-testid="video-analysis-file" onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) { setFrameIndex(0); setCutError(null); setCutText(""); setInstalled({}); void selectFile(file); }
				}} /></label>
				{state.busy ? <button type="button" onClick={cancel}>{text.cancel}</button> : null}
			</div>
			{state.message ? <p role="status" className="video-import-status">{state.message}</p> : null}
			{state.error || cutError ? <p role="alert" className="video-import-error">{state.error || cutError}</p> : null}
			{timeline ? <>
				<p data-testid="video-analysis-summary">{text.summary(timeline)}</p>
				<VideoFrameReview file={state.file} frame={frame} observation={observation} />
				<div className="video-import-actions">
					<button type="button" disabled={busy || frame.index === 0} onClick={() => setFrameIndex(frame.index - 1)}>{text.previous}</button>
					<label>{text.frame} <input type="number" min="0" max={timeline.frameCount - 1} value={frame.index} disabled={busy} onChange={(event) => setFrameIndex(Math.max(0, Math.min(timeline.frameCount - 1, Math.round(Number(event.target.value)) || 0)))} /></label>
					<button type="button" disabled={busy || frame.index === timeline.frameCount - 1} onClick={() => setFrameIndex(frame.index + 1)}>{text.next}</button>
				</div>
				<p className="video-import-hint">{text.frameTime(frame, shot.id)} · {state.poses ? (observed ? text.goodObservation : text.badObservation) : text.noObservation}</p>
				<label className="video-import-subject">{text.cutLabel}<input placeholder={timeline.cuts.map((cut) => cut.frameIndex).join(", ")} value={cutText} disabled={busy} onChange={(event) => setCutText(event.target.value)} /></label>
				<div className="video-import-actions"><button type="button" disabled={busy} onClick={applyCuts}>{text.applyCuts}</button><button type="button" disabled={busy} onClick={trackPeople} data-testid="video-track-people">{text.trackPeople}</button><button type="button" disabled={busy} onClick={download} data-testid="video-analysis-download">{text.download}</button></div>
				{state.poses ? <><p data-testid="video-pose-summary">{text.poseSummary(state.poses.quality)} {state.poses.quality.readyForFitting ? text.fitReady : text.incomplete(state.poses.quality.failedFrames.length)}</p><div className="video-import-actions"><button type="button" disabled={busy || !state.poses.quality.failedFrames.some((value) => value > frame.index)} onClick={() => setFrameIndex(state.poses.quality.failedFrames.find((value) => value > frame.index))}>{text.nextFailure}</button><span>{text.legend}</span></div></> : null}
				<p className="video-import-hint">{text.visionHint}</p>
				<div className="video-analysis-shots">{timeline.shots.map((entry, index) => <article key={`${entry.startFrame}-${entry.endFrameExclusive}`}>
					<strong>{text.shotRange(entry)}</strong>
					<div className="video-analysis-stills">{state.references[index]?.map((image) => <button type="button" key={image.index} disabled={busy} onClick={() => setFrameIndex(image.index)} title={text.viewFrame(image.index)}><img src={image.dataUrl} alt={text.frameLabel(image.index)} /><span>{image.index}</span></button>)}</div>
					<div className="video-import-actions"><button type="button" disabled={busy} onClick={() => readShot(index)}>{text.analyzeSet}</button>{state.graphs[entry.id] ? <button type="button" disabled={busy || Boolean(installed[entry.id])} onClick={() => importShot(entry)}>{installed[entry.id] ? text.importedSet : text.importSet}</button> : null}</div>
					{state.graphs[entry.id] ? <p>{state.graphs[entry.id].graph.subject} · {text.pieces(state.graphs[entry.id].graph.entities.length)}</p> : null}
				</article>)}</div>
			</> : null}
		</section>
	</div>;
}
