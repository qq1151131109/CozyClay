import { useCallback, useEffect, useState } from "react";
import { useBus } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { useVideoImport } from "../use-video-import.js";
import { VIDEO_IMPORT_OPEN_EVENT } from "../video-import-events.js";
import VideoImportPanel from "./VideoImportPanel.jsx";
import VideoAnalysisPanel from "./VideoAnalysisPanel.jsx";
import { importVideoShot } from "../video-shot-import.js";

/**
 * The video → blockout session: it owns the dialog's open state, the run, the
 * white-model clip and the listening for the shell's open event, so the
 * Studio's own modules never have to carry any of it.
 */
export default function VideoImportSession() {
	const { run: runBus } = useBus();
	const { buildStudioAgentContext, frameAll, renderBlockoutClip } = useStudioShell();
	const [open, setOpen] = useState(false);
	const [analysisOpen, setAnalysisOpen] = useState(false);
	const [opens, setOpens] = useState(0);
	const [clip, setClip] = useState({ phase: "idle", url: null, name: null });
	const { state, start, cancel, reset } = useVideoImport({
		run: (action, args) => runBus(action, args, { origin: "ui" }),
		readContext: () => buildStudioAgentContext?.() ?? null,
	});
	useEffect(() => {
		const onOpen = () => {
			reset();
			setClip((current) => {
				if (current.url) URL.revokeObjectURL(current.url);
				return { phase: "idle", url: null, name: null };
			});
			setOpens((count) => count + 1);
			setAnalysisOpen(false);
			setOpen(true);
		};
		globalThis.window?.addEventListener(VIDEO_IMPORT_OPEN_EVENT, onOpen);
		return () => globalThis.window?.removeEventListener(VIDEO_IMPORT_OPEN_EVENT, onOpen);
	}, [reset]);
	const onClose = useCallback(() => { cancel(); setOpen(false); }, [cancel]);
	/**
	 * A blockout can land anywhere the video's camera stood, so the view is
	 * framed on the whole set once it is written — an import that left the
	 * viewport looking at empty floor reads as a failure. The clip is then
	 * rendered from the shot the import just made: the video the reference
	 * tool hands back, but here it is a render of real geometry.
	 */
	const startAndFrame = useCallback(async (file, options) => {
		const result = await start(file, options);
		if (!result) return result;
		frameAll?.();
		if (!renderBlockoutClip) return result;
		setClip({ phase: "rendering", url: null, name: null });
		try {
			const rendered = await renderBlockoutClip();
			if (!rendered?.blob) throw new Error("no clip");
			setClip((current) => {
				if (current.url) URL.revokeObjectURL(current.url);
				return { phase: "ready", url: URL.createObjectURL(rendered.blob), name: rendered.fileName ?? "cozyclay-blockout.mp4" };
			});
		} catch {
			// The blockout is placed: a clip that did not render must not read as a
			// failed import. The dialog says so and the File › Export path still works.
			setClip({ phase: "failed", url: null, name: null });
		}
		return result;
	}, [start, frameAll, renderBlockoutClip]);
	const importShot = useCallback(async (graph, shot) => {
		const result = await importVideoShot({
			run: (action, args) => runBus(action, args, { origin: "ui" }), graph, shot,
			originalSceneId: buildStudioAgentContext?.()?.host?.sceneId,
		});
		frameAll?.();
		return result;
	}, [runBus, frameAll, buildStudioAgentContext]);
	if (!open) return null;
	if (analysisOpen) return <VideoAnalysisPanel key={opens} onClose={onClose} onImportShot={importShot} />;
	return <VideoImportPanel key={opens} onClose={onClose} state={state} clip={clip} onStart={startAndFrame} onCancel={cancel} onAnalyze={() => { cancel(); setAnalysisOpen(true); }} />;
}
