// Which model a video import asks for.
//
// A turn that names no model is resolved as `openai-codex` (bin/agent/providers.mjs
// resolveModel: no slash means that provider), so an import that stayed silent
// failed on whichever provider happened to be unconfigured. The import reads
// pictures, so it asks for the first model the sidecar advertises whose input
// includes an image and whose provider is actually signed in.

/** The `provider/model` key to run a video import on, or null when the list
 * carries nothing that can see. `models` are the transport's flattened list
 * (each `key` is already `provider/model`). */
export function pickImageModel({ providers = [], models = [] } = {}) {
	const list = Array.isArray(models) ? models.filter((model) => model && typeof model.key === "string") : [];
	if (!list.length) return null;
	const signed = new Set(
		(Array.isArray(providers) ? providers : [])
			.filter((provider) => provider?.signedIn && Array.isArray(provider.models) && provider.models.length)
			.map((provider) => provider.id),
	);
	const sees = list.filter((model) => {
		const input = Array.isArray(model.input) ? model.input : [];
		return input.includes("image");
	});
	if (!sees.length) return null;
	// A provider the sidecar did not describe is not evidence of a working key, so
	// a signed-in one wins; with no provider list at all, the flat list is the best
	// the caller has.
	const usable = providers.length ? sees.filter((model) => signed.has(String(model.provider ?? model.key.split("/")[0]))) : sees;
	return (usable[0] ?? null)?.key ?? null;
}
