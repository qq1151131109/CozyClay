// The one-open-channel for the video import dialog: the shell renders the
// session once, and anything that offers the command dispatches this event
// (the same pattern the Agent panel toggle uses).
export const VIDEO_IMPORT_OPEN_EVENT = "cozyclay:video-import-open";

/** Ask the Studio to open the video → blockout dialog. */
export function openVideoImport() {
	globalThis.window?.dispatchEvent(new CustomEvent(VIDEO_IMPORT_OPEN_EVENT));
}
