import { createModels, resolveModel } from "./providers.mjs";
import { videoImportPrompt } from "../../src/video-import-text.js";

// A single vision completion, deliberately not a Studio agent turn: the model
// has no tools and cannot mutate a room while the author is inspecting cuts.
export async function analyzeVideoShot({ model: key, frames, subject = "", signal, models }) {
	signal?.throwIfAborted();
	if (!Array.isArray(frames) || !frames.length || frames.length > 4 || frames.some((frame) =>
		!Number.isInteger(frame.index) || frame.index < 0 || !Number.isFinite(frame.time)
		|| typeof frame.dataUrl !== "string" || frame.dataUrl.length > 4_000_000
		|| !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(frame.dataUrl))) throw new TypeError("Invalid source frames (1–4 inline images required).");
	if (typeof subject !== "string" || subject.length > 160) throw new TypeError("Invalid shot subject.");
	const registry = models ?? await createModels();
	const { model } = await resolveModel(key, { models: registry });
	if (!model.input?.includes("image")) throw new Error("Choose a model with image input.");
	const labels = frames.map((frame) => `Source frame ${frame.index}, PTS ${frame.time.toFixed(6)} seconds`).join("\n");
	const prompt = `These images belong to a single shot, never combine them with another shot.\n${labels}\n`
		+ videoImportPrompt({ frames: frames.length, duration: frames.at(-1).time - frames[0].time, subject });
	const result = await registry.complete(model, {
		messages: [{ role: "user", timestamp: Date.now(), content: [
			{ type: "text", text: prompt },
			...frames.map((frame) => ({ type: "image", data: frame.dataUrl.split(",")[1], mimeType: frame.dataUrl.slice(5, frame.dataUrl.indexOf(";")) })),
		] }], tools: [],
	}, { signal, maxTokens: 4096 });
	signal?.throwIfAborted();
	if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error(result.errorMessage || result.stopReason);
	const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	if (!text.trim()) throw new Error("The model returned no scene description.");
	return { text, usage: result.usage ?? null };
}

export function videoShotFailure(error) {
	const message = String(error.message || error);
	if (error.name === "AbortError") return { status: 408, code: "CANCELLED", error: "Video analysis cancelled or timed out." };
	if ([401, 403].includes(error.status) || /\b40[13]\b|not configured|invalid.*key|expired.*credential/i.test(message)) return { status: 401, code: "AUTH_REQUIRED", error: "视觉模型认证失败，请重新配置或登录。" };
	if (error.status === 429 || /\b429\b|rate.?limit|too many requests/i.test(message)) return { status: 429, code: "RATE_LIMITED", error: "视觉模型当前限流，请稍后重试。", ...(Number.isFinite(Number(error.retryAfter)) && Number(error.retryAfter) > 0 ? { retryAfter: Number(error.retryAfter) } : {}) };
	if (error instanceof TypeError || error instanceof RangeError || error.code === "UNKNOWN_MODEL") return { status: 400, code: "INVALID_REQUEST", error: message };
	return { status: 502, code: "UPSTREAM_FAILED", error: "视觉模型请求失败，请稍后重试。" };
}

export async function handleVideoShotRequest(req, res, { getModels, json, readBody }) {
	const control = new AbortController();
	const abort = () => { if (!res.writableEnded) control.abort(); };
	req.once("aborted", abort);
	res.once("close", abort);
	const timer = setTimeout(() => control.abort(), 180_000);
	try {
		if (req.method !== "POST" || !String(req.headers["content-type"]).startsWith("application/json")) { json(res, 405, { error: "POST JSON required." }); return; }
		const body = await readBody(req, 17_000_000);
		const result = await analyzeVideoShot({ ...body, models: await getModels(), signal: control.signal });
		json(res, 200, result);
	} catch (error) {
		const failure = videoShotFailure(control.signal.aborted ? new DOMException("Cancelled", "AbortError") : error);
		if (!res.destroyed) json(res, failure.status, failure);
	} finally {
		clearTimeout(timer);
		req.off("aborted", abort);
		res.off("close", abort);
	}
}
