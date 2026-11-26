// Source frames, never timeline seconds, own cuts and reference images.
export function frameDifference(before, after) {
	if (!before?.length || before.length !== after?.length) throw new RangeError("frame signatures must have the same nonzero size");
	let sum = 0;
	for (let index = 0; index < before.length; index += 1) sum += Math.abs(before[index] - after[index]);
	return sum / (255 * before.length);
}

export function detectShotBoundaries(frames, { threshold = 0.1, minShotFrames = 1 } = {}) {
	if (!(threshold > 0 && threshold <= 1) || !Number.isInteger(minShotFrames) || minShotFrames < 1) throw new RangeError("invalid shot detection settings");
	const cuts = [];
	let start = 0;
	for (let index = 1; index < frames.length; index += 1) {
		const score = frameDifference(frames[index - 1].signature, frames[index].signature);
		if (score < threshold || index - start < minShotFrames) continue;
		cuts.push({ frameIndex: index, timestamp: frames[index].timestamp, score, kind: "candidate" });
		start = index;
	}
	return cuts;
}

export function buildVideoTimeline(frames, { width, height, cuts = detectShotBoundaries(frames) } = {}) {
	if (!frames.length) throw new RangeError("the video contains no decoded frames");
	if (!(width > 0 && height > 0)) throw new RangeError("the video has no display dimensions");
	const ledger = frames.map(({ timestamp, duration }, index) => {
		if (!Number.isFinite(timestamp) || !Number.isFinite(duration) || duration <= 0) throw new RangeError(`frame ${index} has invalid timing`);
		if (index && timestamp <= frames[index - 1].timestamp) throw new RangeError(`frame ${index} is not in presentation order`);
		return { index, timestamp, duration };
	});
	const boundaries = cuts.map((cut) => cut.frameIndex);
	if (boundaries.some((value, index) => !Number.isInteger(value) || value <= (boundaries[index - 1] ?? 0) || value >= frames.length)) throw new RangeError("cuts must be ordered source frame indices inside the video");
	const origin = ledger[0].timestamp;
	const duration = ledger.at(-1).timestamp + ledger.at(-1).duration - origin;
	const starts = [0, ...boundaries];
	return {
		version: 1, width, height, origin, duration, frameCount: ledger.length, frames: ledger,
		shots: starts.map((startFrame, index) => ({
			id: `shot-${index + 1}`, startFrame, endFrameExclusive: starts[index + 1] ?? ledger.length,
			startTime: ledger[startFrame].timestamp,
			endTime: ledger[(starts[index + 1] ?? ledger.length) - 1].timestamp + ledger[(starts[index + 1] ?? ledger.length) - 1].duration,
		})),
		cuts,
	};
}

// Keep endpoints and moments of greatest visual change, not every nth second.
export function shotReferenceIndices(frames, shot, count = 4) {
	if (!Number.isInteger(count) || count < 1 || count > 4) throw new RangeError("a shot can carry 1–4 reference images");
	const { startFrame, endFrameExclusive } = shot;
	if (!Number.isInteger(startFrame) || !Number.isInteger(endFrameExclusive) || startFrame < 0 || endFrameExclusive > frames.length || endFrameExclusive <= startFrame) throw new RangeError("invalid shot range");
	const chosen = new Set([startFrame]);
	if (count > 1) chosen.add(endFrameExclusive - 1);
	while (chosen.size < Math.min(count, endFrameExclusive - startFrame)) {
		let best = -1;
		let score = -1;
		for (let index = startFrame; index < endFrameExclusive; index += 1) {
			if (chosen.has(index)) continue;
			const novelty = Math.min(...[...chosen].map((other) => frameDifference(frames[index].signature, frames[other].signature)));
			if (novelty > score) { best = index; score = novelty; }
		}
		chosen.add(best);
	}
	return [...chosen].sort((a, b) => a - b);
}
