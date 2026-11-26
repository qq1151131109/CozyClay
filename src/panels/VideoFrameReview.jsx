import { useEffect, useRef, useState } from "react";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { videoText as text } from "../video-analysis-copy.js";

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

/** Inspect an addressed source frame, not the approximate currentTime of a video. */
export default function VideoFrameReview({ file, frame, observation }) {
	const canvasRef = useRef(null);
	const [error, setError] = useState(null);
	useEffect(() => {
		if (!file || !frame) return;
		let active = true;
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const canvas = canvasRef.current;
		canvas.style.visibility = "hidden";
		void (async () => {
			try {
				const track = await input.getPrimaryVideoTrack();
				const sample = await new CanvasSink(track, { width: Math.min(768, track.displayWidth) }).getCanvas(frame.timestamp + frame.duration / 2);
				if (!active) return;
				if (!sample || Math.abs(sample.timestamp - frame.timestamp) > 0.000002) throw new Error(text.invalidPreview);
				canvas.width = sample.canvas.width;
				canvas.height = sample.canvas.height;
				const context = canvas.getContext("2d");
				context.drawImage(sample.canvas, 0, 0);
				for (const person of observation?.people ?? []) {
					context.strokeStyle = person.usable ? "#38e8ff" : "#ffab40";
					context.lineWidth = 2;
					for (const [a, b] of BONES) {
						const from = person.landmarks[a];
						const to = person.landmarks[b];
						if (Math.min(from.visibility, to.visibility) < 0.5) continue;
						context.beginPath();
						context.moveTo(from.x * canvas.width, from.y * canvas.height);
						context.lineTo(to.x * canvas.width, to.y * canvas.height);
						context.stroke();
					}
				}
				canvas.dataset.frame = String(frame.index);
				canvas.dataset.timestamp = String(sample.timestamp);
				canvas.style.visibility = "visible";
				setError(null);
			} catch (failure) {
				if (active) setError(failure.message);
			} finally {
				input.dispose();
			}
		})();
		return () => { active = false; input.dispose(); };
	}, [file, frame, observation]);
	return <div className="video-frame-review">
		<canvas ref={canvasRef} data-testid="video-source-frame" role="img" aria-label={text.frameLabel(frame?.index ?? 0)} />
		{error ? <p className="video-import-error" role="alert">{error}</p> : null}
	</div>;
}
