import { sceneGraphPlan, validateSceneGraph } from "./scene-graph.js";

/** Import into a disposable new scene. A refused receipt is a failure even
 * when the bus resolves its promise; never silently leave a partial scene. */
export async function importVideoShot({ run, graph, shot, originalSceneId }) {
	const parsed = validateSceneGraph(graph);
	if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.error}`);
	const frameCount = Math.max(1, Math.round((shot.endTime - shot.startTime) * 24));
	if (!Number.isFinite(frameCount) || frameCount > 28800) throw new RangeError("镜头超出编辑器时间范围。");
	const command = async (action, args) => {
		const receipt = await run(action, args);
		if (receipt?.ok !== true) throw new Error(receipt?.message || `命令失败：${action}`);
		return receipt;
	};
	let sceneId;
	try {
		const created = await command("scene.create", {});
		sceneId = created.affectedIds?.[0];
		if (!sceneId) throw new Error("没有取得新场景标识；布景未写入。");
		await command("scene.rename", { sceneId, name: `${shot.id} · 源帧 ${shot.startFrame}–${shot.endFrameExclusive - 1}` });
		await command("timeline.seek", { frame: 0 });
		await command("shot.setTimeline", { frameCount: Math.max(24, frameCount) });
		let shotId;
		for (const op of sceneGraphPlan(parsed.graph)) {
			const receipt = await command(op.action, op.args);
			if (op.action === "shot.create") {
				shotId = receipt.affectedIds?.[0];
				if (!shotId) throw new Error("没有创建镜头。");
			}
			if (op.action === "object.add") {
				const id = receipt.affectedIds?.[0];
				if (!id) throw new Error("基本体没有创建成功。");
				if (op.scale) await command("object.update", { id, patch: { scaleX: op.scale[0], scaleY: op.scale[1], scaleZ: op.scale[2] } });
			}
		}
		await command("shot.setRange", { shotId, startFrame: 0, endFrameExclusive: frameCount });
		return { sceneId, shotId, frameCount, sourceRange: [shot.startFrame, shot.endFrameExclusive] };
	} catch (error) {
		const cleanup = [];
		if (sceneId) {
			try { await command("scene.delete", { sceneId }); } catch (failure) { cleanup.push(failure.message); }
			if (originalSceneId) {
				try { await command("scene.switch", { sceneId: originalSceneId }); } catch (failure) { cleanup.push(failure.message); }
			}
		}
		if (cleanup.length) throw new Error(`${error.message}；部分导入场景可能仍保留：${cleanup.join("；")}`, { cause: error });
		throw error;
	}
}
