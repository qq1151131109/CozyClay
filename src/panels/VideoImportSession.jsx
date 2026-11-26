import { useCallback, useEffect, useState } from "react";
import { useBus } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { useVideoImport } from "../use-video-import.js";
import { VIDEO_IMPORT_OPEN_EVENT } from "../video-import-events.js";
import VideoImportPanel from "./VideoImportPanel.jsx";

/**
 * The video → blockout session: it owns the dialog's open state, the run and
 * the listening for the shell's open event, so the Studio's own modules never
 * have to carry any of it.
 */
export default function VideoImportSession() {
	const { run: runBus } = useBus();
	const { buildStudioAgentContext, frameAll } = useStudioShell();
	const [open, setOpen] = useState(false);
	const [opens, setOpens] = useState(0);
	const { state, start, cancel, reset } = useVideoImport({
		run: (action, args) => runBus(action, args, { origin: "ui" }),
		readContext: () => buildStudioAgentContext?.() ?? null,
	});
	useEffect(() => {
		const onOpen = () => {
			reset();
			setOpens((count) => count + 1);
			setOpen(true);
		};
		globalThis.window?.addEventListener(VIDEO_IMPORT_OPEN_EVENT, onOpen);
		return () => globalThis.window?.removeEventListener(VIDEO_IMPORT_OPEN_EVENT, onOpen);
	}, [reset]);
	const onClose = useCallback(() => { cancel(); setOpen(false); }, [cancel]);
	// A blockout can land anywhere the video's camera stood, so the view is
	// framed on the whole set once it is written: an import that left the
	// viewport looking at empty floor reads as a failure.
	const startAndFrame = useCallback(async (file, options) => {
		const result = await start(file, options);
		if (result) frameAll?.();
		return result;
	}, [start, frameAll]);
	if (!open) return null;
	return <VideoImportPanel key={opens} onClose={onClose} state={state} onStart={startAndFrame} onCancel={cancel} />;
}
