// Observation quality only: this is not a 2D-to-3D solver or proof that every
// actor in the source was found. Missing observations are never interpolated.
const BODY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const center = (points) => ({ x: (points[23].x + points[24].x) / 2, y: (points[23].y + points[24].y) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function assignPoseIds(previous, poses, frameIndex) {
	const used = new Set();
	return poses.filter((points) => points.length === 33 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).map((landmarks, index) => {
		const position = center(landmarks);
		const matches = previous.filter((person) => !used.has(person.id)).map((person) => ({ person, distance: distance(position, person.center) })).sort((a, b) => a.distance - b.distance);
		const nearest = matches[0];
		const matched = nearest && nearest.distance < 0.2;
		const id = matched ? nearest.person.id : `person-${frameIndex}-${index}`;
		used.add(id);
		const confidentJoints = BODY.filter((joint) => (landmarks[joint].visibility ?? 0) >= 0.5).length;
		return {
			id, frameIndex, center: position, landmarks, confidentJoints,
			usable: confidentJoints >= 8,
			identityUncertain: Boolean(matched && matches[1] && matches[1].distance - nearest.distance < 0.03),
		};
	});
}

export function poseQuality(frames) {
	const detectedFrames = frames.filter((frame) => frame.people.length > 0).length;
	const failedFrames = frames.filter((frame) => !frame.people.length || frame.people.some((person) => !person.usable || person.identityUncertain)).map((frame) => frame.index);
	return {
		frameCount: frames.length, detectedFrames, usableFrames: frames.length - failedFrames.length, failedFrames,
		readyForFitting: frames.length > 0 && failedFrames.length === 0,
	};
}
