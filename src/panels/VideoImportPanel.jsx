import { useRef, useState } from "react";
import { ko } from "../locale.js";
import "./video-import.css";

/**
 * The video → blockout dialog: pick a clip, optionally say what the shot is,
 * and watch the three stages. The import itself lives in video-import.js; this
 * file only reports what it is doing and offers a cancel. The session remounts
 * it on every open, so the subject never leaks from the last import.
 */
export default function VideoImportPanel({ onClose, state, onStart, onCancel }) {
	const fileRef = useRef(null);
	const [subject, setSubject] = useState("");
	const busy = Boolean(state?.running);
	const done = state?.stage === "done";
	const close = () => { if (!busy) onClose(); };
	return (
		<div className="video-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
			<section className="video-import" role="dialog" aria-modal="true" aria-label={ko("Import a video as a blockout", "비디오를 블록아웃으로 가져오기", "将视频导入为白模")} data-testid="video-import">
				<header className="video-import-head">
					<h2>{ko("Import a video as a blockout", "비디오를 블록아웃으로 가져오기", "将视频导入为白模")}</h2>
					<button type="button" className="video-import-close" onClick={close} disabled={busy} aria-label={ko("Close", "닫기", "关闭")}>×</button>
				</header>
				<p className="video-import-hint">
					{ko("Four stills are read from the clip, and the agent describes the set as a few primitives plus the camera that stood there.",
						"클립에서 스틸 네 장을 읽고, 에이전트가 세트를 몇 개의 도형과 카메라로 설명합니다.",
						"从片段中读取四张静帧，由智能体把场景描述为几个基本体和当时的机位。")}
				</p>
				<label className="video-import-subject">
					<span>{ko("What is the shot? (optional)", "이 샷은 무엇입니까? (선택)", "这个镜头是什么？（可选）")}</span>
					<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} disabled={busy} />
				</label>
				<input
					ref={fileRef}
					type="file"
					accept="video/*"
					hidden
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void onStart(file, { subject });
					}}
				/>
				<div className="video-import-actions">
					<button type="button" className="video-import-run" disabled={busy} onClick={() => fileRef.current?.click()}>
						{ko("Choose a video…", "비디오 선택…", "选择视频…")}
					</button>
					{busy ? <button type="button" onClick={onCancel}>{ko("Cancel", "취소", "取消")}</button> : null}
				</div>
				{busy ? (
					<p className="video-import-status" role="status">{state?.message || ko("Working…", "작업 중…", "处理中…")}</p>
				) : null}
				{!busy && state?.stage === "failed" && state.frames ? (
					<p className="video-import-status" role="status">
						{ko(`Read ${state.frames} stills from the clip.`, `클립에서 스틸 ${state.frames}장을 읽었습니다.`, `已从片段读取 ${state.frames} 张静帧。`)}
					</p>
				) : null}
				{state?.error ? <p className="video-import-error" role="alert">{state.error}</p> : null}
				{done ? (
					<p className="video-import-done">
						{ko(`Placed ${state.entities} set pieces and the camera. One undo removes them.`,
							`도형 ${state.entities}개와 카메라를 배치했습니다. 실행 취소 한 번이면 지워집니다.`,
							`已放置 ${state.entities} 个基本体和机位。撤销一次即可移除。`)}
					</p>
				) : null}
			</section>
		</div>
	);
}
