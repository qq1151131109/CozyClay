import { useCallback, useRef, useState } from "react";
import { createAgentTransport } from "./workflow/agent-client.js";
import { runVideoImport } from "./video-import.js";
import { pickImageModel } from "./video-import-model.js";

/** The model an import runs on: the one the author named, else the first the
 * sidecar advertises that can see a picture. A transport that cannot answer
 * leaves the choice to the sidecar, whose refusal is what the author then reads. */
async function resolveModel(transport, named) {
	if (named) return named;
	try {
		return pickImageModel(await transport.models()) ?? undefined;
	} catch {
		return undefined;
	}
}

const IDLE = Object.freeze({ stage: "idle", message: "", error: null, entities: 0, frames: 0, subject: "", running: false });

/**
 * One reference video -> a blockout in the set.
 *
 * The transport lives here, like Sculpt's, so the import talks to the same
 * sidecar the Agent panel does. Every stage lands in `state` for the panel, and
 * a second import cancels the first rather than racing it.
 */
export function useVideoImport({ run, readContext }) {
	const [transport] = useState(() => createAgentTransport({ surface: "studio" }));
	const [state, setState] = useState(IDLE);
	const controller = useRef(null);

	const start = useCallback(async (file, { subject = "", model, effort } = {}) => {
		controller.current?.abort();
		const control = new AbortController();
		controller.current = control;
		setState({ ...IDLE, stage: "frames", running: true, message: `Reading the clip…` });
		try {
			const chosen = await resolveModel(transport, model);
			const result = await runVideoImport({
				file,
				turn: (request, onEvent, signal) => transport.turn(request, onEvent, signal),
				run: (action, args) => run(action, args),
				context: readContext?.() ?? null,
				subject,
				model: chosen,
				effort,
				signal: control.signal,
				onStage: (stage) => setState((current) => ({
					...current,
					stage: stage.stage,
					message: stage.message ?? current.message,
					entities: stage.entities ?? current.entities,
					frames: stage.frames ?? current.frames,
				})),
			});
			setState({ stage: "done", message: "", error: null, entities: result.ids.length, frames: result.frames, subject: result.graph.subject, running: false });
			return result;
		} catch (error) {
			const cancelled = error?.name === "AbortError";
			// A failure keeps the frame count: it tells the author the clip was read
			// and the answer, not the import, is what went wrong.
			setState((current) => ({ ...IDLE, stage: cancelled ? "idle" : "failed", error: cancelled ? null : error?.message || "The import failed.", frames: current.frames }));
			return null;
		} finally {
			if (controller.current === control) controller.current = null;
		}
	}, [transport, run, readContext]);

	const cancel = useCallback(() => { controller.current?.abort(); }, []);
	const reset = useCallback(() => { setState(IDLE); }, []);

	return { state, start, cancel, reset };
}
