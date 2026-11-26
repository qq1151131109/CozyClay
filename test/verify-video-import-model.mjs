#!/usr/bin/env node
// Which model a video import asks for: only one that can see, only from a
// provider whose key is actually there.
import { pickImageModel } from "../src/video-import-model.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

const vision = (provider, id, input = ["text", "image"]) => ({ id: `${provider}/${id}`, key: `${provider}/${id}`, provider, input });
const signedIn = (id, models) => ({ id, signedIn: true, models: models.map((model) => ({ id: model })) });

// ── The model the import must not pick ─────────────────────────────────────
expect("a text-only model is never picked",
	pickImageModel({ providers: [signedIn("deepseek", ["deepseek-v4-pro"])], models: [vision("deepseek", "deepseek-v4-pro", ["text"])] }) === null);
expect("an image model from a provider without a key is not picked",
	pickImageModel({
		providers: [{ id: "openai-codex", signedIn: false, models: [{ id: "gpt-6-astra" }] }],
		models: [vision("openai-codex", "gpt-6-astra")],
	}) === null);

// ── The one it must ────────────────────────────────────────────────────────
const picked = pickImageModel({
	providers: [signedIn("deepseek", ["deepseek-flash"]), { id: "openai-codex", signedIn: false, models: [{ id: "gpt-6-astra" }] }],
	models: [vision("openai-codex", "gpt-6-astra"), vision("deepseek", "deepseek-flash")],
});
expect("a signed-in provider's image model is picked over an unconfigured one first", picked === "deepseek/deepseek-flash", String(picked));
expect("the answer is the provider/model key a turn understands", /^[a-z-]+\/[a-z0-9.-]+$/.test(String(picked)), String(picked));

const second = pickImageModel({
	providers: [signedIn("a", ["x"]), signedIn("b", ["y"])],
	models: [vision("a", "x", ["text"]), vision("b", "y")],
});
expect("the first signed-in model that sees wins when the earlier ones cannot", second === "b/y", String(second));

// ── Degenerate answers ─────────────────────────────────────────────────────
expect("no models at all is null", pickImageModel({ providers: [], models: [] }) === null);
expect("an empty answer is null", pickImageModel() === null);
expect("a model without an input list is not assumed to see", pickImageModel({ providers: [], models: [{ key: "a/b" }] }) === null);
expect("with no provider list the flat list is used", pickImageModel({ models: [vision("c", "z")] }) === "c/z");
expect("a model whose provider field is missing falls back to the key's prefix",
	pickImageModel({ providers: [signedIn("d", ["w"])], models: [{ key: "d/w", input: ["image"] }] }) === "d/w");

console.log(failures === 0 ? "video import model: all checks passed" : `${failures} video import model check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
