import { sceneGraphPlan, validateSceneGraph } from "./scene-graph.js";
import { ko } from "./locale.js";

/** Import into a disposable new scene. A refused receipt is a failure even
 * when the bus resolves its promise; never silently leave a partial scene. */
export async function importVideoShot({ run, graph, shot, originalSceneId }) {
	const parsed = validateSceneGraph(graph);
	if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.error}`);
	const frameCount = Math.max(1, Math.round((shot.endTime - shot.startTime) * 24));
	if (!Number.isFinite(frameCount) || frameCount > 28800) throw new RangeError(ko("The shot exceeds the editor timeline limit.", "샷이 편집기 타임라인 제한을 초과합니다.", "镜头超出编辑器时间范围。"));
	const command = async (action, args) => {
		const receipt = await run(action, args);
		if (receipt?.ok !== true) throw new Error(receipt?.message || ko(`Command failed: ${action}`, `명령 실패: ${action}`, `命令失败：${action}`));
		return receipt;
	};
	let sceneId;
	try {
		const created = await command("scene.create", {});
		sceneId = created.affectedIds?.[0];
		if (!sceneId) throw new Error(ko("No new scene ID was returned; the set was not written.", "새 씬 ID가 반환되지 않았습니다. 세트가 기록되지 않았습니다.", "没有取得新场景标识；布景未写入。"));
		await command("scene.rename", { sceneId, name: ko(`${shot.id} · source frames ${shot.startFrame}–${shot.endFrameExclusive - 1}`, `${shot.id} · 원본 프레임 ${shot.startFrame}–${shot.endFrameExclusive - 1}`, `${shot.id} · 源帧 ${shot.startFrame}–${shot.endFrameExclusive - 1}`) });
		await command("timeline.seek", { frame: 0 });
		await command("shot.setTimeline", { frameCount: Math.max(24, frameCount) });
		let shotId;
		for (const op of sceneGraphPlan(parsed.graph)) {
			const receipt = await command(op.action, op.args);
			if (op.action === "shot.create") {
				shotId = receipt.affectedIds?.[0];
				if (!shotId) throw new Error(ko("No shot was created.", "샷이 생성되지 않았습니다.", "没有创建镜头。"));
			}
			if (op.action === "object.add") {
				const id = receipt.affectedIds?.[0];
				if (!id) throw new Error(ko("The primitive was not created.", "도형이 생성되지 않았습니다.", "基本体没有创建成功。"));
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
		if (cleanup.length) throw new Error(ko(`${error.message}; a partial imported scene may remain: ${cleanup.join("; ")}`, `${error.message}; 일부 가져온 씬이 남을 수 있습니다: ${cleanup.join("; ")}`, `${error.message}；部分导入场景可能仍保留：${cleanup.join("；")}`), { cause: error });
		throw error;
	}
}
