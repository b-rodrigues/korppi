import { invoke } from "@tauri-apps/api/core";

/**
 * Scan for conflicts in the patch history
 */
export async function detectConflicts() {
    return await invoke("detect_conflicts");
}

/**
 * Get all unresolved conflicts
 */
export async function getConflicts() {
    return await invoke("get_conflicts");
}

/**
 * Resolve a conflict
 * @param {string} conflictId
 * @param {'ResolvedLocal' | 'ResolvedRemote' | 'ResolvedMerged' | 'ResolvedBoth'} resolution
 * @param {string|null} mergedContent - Required if resolution is 'ResolvedMerged'
 */
export async function resolveConflict(conflictId, resolution, mergedContent = null) {
    return await invoke("resolve_conflict", {
        resolution: {
            conflict_id: conflictId,
            resolution: resolution,
            merged_content: mergedContent,
        }
    });
}

/**
 * Get count of unresolved conflicts
 */
export async function getConflictCount() {
    return await invoke("get_conflict_count");
}
