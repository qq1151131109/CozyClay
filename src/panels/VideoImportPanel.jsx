import { useRef, useState } from "react";
import { ko } from "../locale.js";
import "./video-import.css";

/**
 * The video → blockout dialog: pick a clip, optionally say what the shot is,
 * and watch the three stages. The import itself lives in video-import.js; this
 * file only reports what it is doing and offers a cancel. The session remounts
 * it on every open, so the subject never leaks from the last import.
 */
export default function VideoImportPanel({ onClose, state, clip, onStart, onCancel, onAnalyze }) {
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
{ko("For a single uncut shot: four stills describe a static set and one camera. Use frame-by-frame shot analysis above for edited clips and motion checks.",
							"단일 샷의 스틸 네 장으로 정적 세트와 카메라를 만듭니다. 편집된 영상은 프레임별 샷 분석을 사용하세요.",
							"快速导入仅适合单个未剪辑镜头：四张静帧建立静态布景和一个机位。多镜头素材与动作检查请使用「逐帧分镜与人物检查」。")}
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
						{onAnalyze ? <button type="button" disabled={busy || clip?.phase === "rendering"} onClick={onAnalyze} data-testid="video-analysis-open">{ko("Frame-by-frame shot analysis", "프레임별 샷 분석", "逐帧分镜与人物检查")}</button> : null}
						<button type="button" className="video-import-run" disabled={busy} onClick={() => fileRef.current?.click()}>
						{ko("Static set + 4-second preview…", "정적 세트 + 4초 미리보기…", "静态布景与4秒预览…")}
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
						{ko(`Placed ${state.entities} set pieces and the camera.`,
							`도형 ${state.entities}개와 카메라를 배치했습니다.`,
							`已放置 ${state.entities} 个基本体和机位。`)}
						{state.fitted
							? ko(` ${state.fitted} side${state.fitted === 1 ? "" : "s"} fitted to the stage's limits.`,
								` 스테이지 한계에 맞춘 면 ${state.fitted}개.`,
								` ${state.fitted} 个尺寸已调整到舞台范围内。`)
							: null}
					</p>
				) : null}
				{clip?.phase === "rendering" ? (
					<p className="video-import-status" role="status">
						{ko("Rendering the white-model clip…", "화이트 모델 클립을 렌더링하는 중…", "正在渲染白模视频…")}
					</p>
				) : null}
				{clip?.phase === "ready" ? (
					<div className="video-import-clip">
						<video src={clip.url} controls playsInline data-testid="video-import-clip" />
						<a className="video-import-download" href={clip.url} download={clip.name} data-testid="video-import-download">
							{ko("Download the clip", "클립 내려받기", "下载白模视频")}
						</a>
					</div>
				) : null}
				{clip?.phase === "failed" ? (
					<p className="video-import-status">
						{ko("The clip did not render here. File › Export renders this shot.",
							"이 브라우저에서는 클립을 렌더링하지 못했습니다. 파일 › 내보내기로 이 샷을 렌더링하세요.",
							"此处未能渲染白模视频。可用「文件 › 导出」渲染该镜头。")}
					</p>
				) : null}
			</section>
		</div>
	);
}
