import { createProviderRoutes } from "./provider-routes.mjs";

// Keep the legacy sidecar lazy: video analysis needs src/ prompt contracts,
// while provider status and login must still run in a minimal installation.
export function createMediaProviderRoutes(options) {
	const providers = createProviderRoutes(options);
	return async (req, res, path) => {
		if (path !== "/agent/video-shot") return providers(req, res, path);
		const { handleVideoShotRequest } = await import("./video-shot.mjs");
		await handleVideoShotRequest(req, res, options);
		return true;
	};
}
