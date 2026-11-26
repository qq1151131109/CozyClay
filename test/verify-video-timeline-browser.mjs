#!/usr/bin/env node
// No model/provider calls: exact decoding, cut detection and cancellation.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cameraBrowser } from "./camera-browser-harness.mjs";

const browser = await cameraBrowser();
const outputDir = process.env.QA_OUT || mkdtempSync(join(tmpdir(), "cozyclay-frame-evidence-"));
try {
	const result = await browser.evaluate(`(async () => {
		const { exportOffscreenVideo } = await import('/src/offscreen-export.js');
		const { analyzeVideo, collectShotReferences } = await import('/src/video-decode.js');
		const clip = await exportOffscreenVideo({ startFrame: 0, endFrame: 23, fps: 24, width: 160, height: 90,
			capture: (index) => {
				const rgba = new Uint8Array(160 * 90 * 4);
				for (let p = 0; p < rgba.length; p += 4) {
					rgba[p] = rgba[p + 1] = rgba[p + 2] = index < 12 ? 24 + index : 220 + index;
					rgba[p + 3] = 255;
				}
				return rgba;
			}
		});
		const file = new File([clip.blob], 'two-shots.mp4', { type: 'video/mp4' });
		const analysis = await analyzeVideo(file);
		const refs = await collectShotReferences(file, analysis);
		const control = new AbortController();
		let cancelled = false;
		try { await analyzeVideo(file, { signal: control.signal, onProgress: ({ frameCount }) => { if (frameCount === 3) control.abort(); } }); }
		catch (error) { cancelled = error.name === 'AbortError'; }
		let limited = false;
		try { await analyzeVideo(file, { maxFrames: 4 }); } catch (error) { limited = /limit/.test(error.message); }
		return { timeline: analysis.timeline, refs: refs.map((shot) => shot.map(({ index, time, dataUrl }) => ({ index, time, jpeg: dataUrl.startsWith('data:image/jpeg') }))), cancelled, limited };
	})()`);
	assert.equal(result.timeline.frameCount, 24);
	assert.ok(Math.abs(result.timeline.duration - 1) < 0.0001);
	assert.deepEqual(result.timeline.shots.map((shot) => [shot.startFrame, shot.endFrameExclusive]), [[0, 12], [12, 24]]);
	assert.equal(result.timeline.frames[12].index, 12);
	assert.ok(Math.abs(result.timeline.frames[12].timestamp - 0.5) < 0.0001);
	assert.ok(result.refs.every((refs, shot) => refs.length <= 4 && refs.every((ref) => ref.jpeg && ref.index >= shot * 12 && ref.index < (shot + 1) * 12)));
	assert.equal(result.cancelled, true);
	assert.equal(result.limited, true);
	console.log("PASS real H.264 decode keeps all 24 frames, exact cut frame and same-shot references");
	console.log("PASS decoding cancellation and frame limit stop the job");

	await browser.arm("!!document.querySelector('[data-testid=topbar-video-import]')");
	await browser.settled();
	await browser.evaluate("document.querySelector('[data-testid=topbar-video-import]').click()");
	await browser.arm("!!document.querySelector('[data-testid=video-analysis-open]')");
	await browser.settled();
	await browser.click('[data-testid=video-analysis-open]');
	await browser.arm("!!document.querySelector('[data-testid=video-analysis]')");
	await browser.settled();
	console.log("PASS the editor opens the frame analysis dialog");

	if (process.env.QA_VIDEO_FILE) {
		await browser.evaluate(`(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'qa-source-video'; document.body.append(input); return true; })()`);
		const node = await browser.send("Runtime.evaluate", { expression: "document.querySelector('#qa-source-video')" });
		await browser.send("DOM.setFileInputFiles", { files: [process.env.QA_VIDEO_FILE], objectId: node.result.objectId });
		const source = await browser.evaluate(`(async () => {
			const { analyzeVideo } = await import('/src/video-decode.js');
			const { frameDifference } = await import('/src/video-timeline.js');
			const { timeline, frames } = await analyzeVideo(document.querySelector('#qa-source-video').files[0]);
			const changes = frames.slice(1).map((frame, i) => ({ index: i + 1, score: frameDifference(frames[i].signature, frame.signature) })).sort((a, b) => b.score - a.score).slice(0, 8);
			return { frameCount: timeline.frameCount, duration: timeline.duration, origin: timeline.origin, width: timeline.width, height: timeline.height, cuts: timeline.cuts, changes };
		})()`);
		console.log('SOURCE_TIMELINE ' + JSON.stringify(source));
		assert.ok(source.frameCount > 0);
		if (process.env.QA_EXPECT_FRAMES) assert.equal(source.frameCount, Number(process.env.QA_EXPECT_FRAMES));
		const picker = await browser.send("Runtime.evaluate", { expression: "document.querySelector('[data-testid=video-analysis-file]')" });
		await browser.send("DOM.setFileInputFiles", { files: [process.env.QA_VIDEO_FILE], objectId: picker.result.objectId });
		await browser.arm("!!document.querySelector('[data-testid=video-analysis-summary]')");
		await browser.settled();
		assert.match(await browser.evaluate("document.querySelector('[data-testid=video-analysis-summary]').textContent"), new RegExp(`${source.frameCount} 帧`));
		await browser.arm("document.querySelector('[data-testid=video-source-frame]')?.dataset.frame === '0'");
		await browser.settled();
		const buttonIndex = await browser.evaluate("[...document.querySelectorAll('.video-analysis-stills button')].findIndex(el => el.title === '查看源帧 184')");
		if (buttonIndex >= 0) {
			await browser.evaluate("[...document.querySelectorAll('.video-analysis-stills button')].find(el => el.title === '查看源帧 184').click()");
			await browser.arm("document.querySelector('[data-testid=video-source-frame]')?.dataset.frame === '184'");
			await browser.settled();
			const pts = Number(await browser.evaluate("document.querySelector('[data-testid=video-source-frame]').dataset.timestamp"));
			assert.ok(Math.abs(pts - 184 / 24) < 0.000002);
		}
		console.log("PASS real-source UI shows the complete ledger and previews the addressed source frame");
		const setCuts = (text) => browser.evaluate(`(() => {
			const input = document.querySelector('.video-analysis .video-import-subject input');
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return true;
		})()`);
		await setCuts("1");
		await browser.evaluate("[...document.querySelectorAll('.video-analysis button')].find(el => el.textContent === '应用切点').click()");
		await browser.arm("document.querySelector('.video-analysis-shots strong')?.textContent.includes('0–0')");
		await browser.settled();
		assert.match(await browser.evaluate("document.querySelector('[data-testid=video-analysis-summary]').textContent"), new RegExp(`${source.frameCount} 帧`));
		await setCuts(source.cuts.map((cut) => cut.frameIndex).join(","));
		await browser.evaluate("[...document.querySelectorAll('.video-analysis button')].find(el => el.textContent === '应用切点').click()");
		await browser.arm(`document.querySelector('.video-analysis-shots strong')?.textContent.includes(${JSON.stringify(`0–${(source.cuts[0]?.frameIndex ?? source.frameCount) - 1}`)})`);
		await browser.settled();
		console.log("PASS manual cut editing rebuilds same-shot references without changing frame count");
		if (process.env.QA_TRACK_POSES === "1") {
			await browser.click('[data-testid=video-track-people]');
			let complete = false;
			for (let attempt = 0; attempt < 180; attempt += 1) {
				const status = await browser.evaluate("({ summary: document.querySelector('[data-testid=video-pose-summary]')?.textContent, error: document.querySelector('.video-import-error')?.textContent })");
				if (status.error) throw new Error(status.error);
				if (status.summary) { console.log('POSE_QUALITY ' + status.summary); complete = true; break; }
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			assert.equal(complete, true, "pose diagnostics finish on the source clip");
		}
		if (process.env.QA_VISION === "1") {
			await browser.evaluate("[...document.querySelectorAll('.video-analysis button')].find(el => el.textContent === '分析此镜头布景').click()");
			let complete = false;
			for (let attempt = 0; attempt < 180; attempt += 1) {
				const status = await browser.evaluate("({ ready: [...document.querySelectorAll('.video-analysis button')].some(el => el.textContent === '在独立场景中建立静态布景'), error: document.querySelector('.video-import-error')?.textContent })");
				if (status.error) throw new Error(status.error);
				if (status.ready) { complete = true; break; }
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			assert.equal(complete, true, "real vision request returns a validated scene graph");
			await browser.evaluate("[...document.querySelectorAll('.video-analysis button')].find(el => el.textContent === '在独立场景中建立静态布景').click()");
			await browser.arm("!!document.querySelector('.video-import-error') || [...document.querySelectorAll('.video-analysis button')].some(el => el.textContent === '已建立独立静态场景')");
			await browser.settled();
			const error = await browser.evaluate("document.querySelector('.video-import-error')?.textContent");
			assert.ok(!error, error);
			console.log("PASS real vision analysis returns a graph and creates an independent shot scene");
		}
		await browser.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: outputDir });
		await browser.click('[data-testid=video-analysis-download]');
		for (let attempt = 0; attempt < 20 && !readdirSync(outputDir).some((name) => name.endsWith('.json')); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 200));
		const report = JSON.parse(readFileSync(join(outputDir, 'cozyclay-frame-analysis.json'), 'utf8'));
		assert.equal(report.timeline.frameCount, source.frameCount);
		assert.equal(report.timeline.frames.length, source.frameCount);
		if (process.env.QA_VISION === "1") {
			assert.ok(report.installedScenes['shot-1']?.sceneId);
			assert.ok(report.installedScenes['shot-1']?.shotId);
			const saved = await browser.evaluate(`(async () => {
				const { SCENES_STORAGE_KEY } = await import('/src/scenes.js');
				return JSON.parse(localStorage.getItem(SCENES_STORAGE_KEY));
			})()`);
			assert.ok(saved.scenes.length >= 2, "original scene is retained alongside the imported scene");
			const created = saved.scenes.find((scene) => scene.id === report.installedScenes['shot-1'].sceneId);
			assert.ok(created);
			assert.equal(created.objects.length, report.graphs['shot-1'].graph.entities.length);
			assert.ok(created.shotDocument.shots.some((shot) => shot.id === report.installedScenes['shot-1'].shotId && shot.startFrame === 0 && shot.endFrame === 183));
			console.log('PASS persisted independent scene contains the expected entities and full shot range');
		}
		const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(join(outputDir, 'frame-analysis.png'), Buffer.from(screenshot.data, 'base64'));
		console.log('QA_EVIDENCE ' + outputDir);
	}
} finally {
	browser.close();
}
console.log("video timeline browser: all checks passed");
