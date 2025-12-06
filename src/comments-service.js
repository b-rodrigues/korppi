// src/comments-service.js
// Comments service with Yjs relative position anchoring

import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";
import { ydoc, yXmlFragment } from "./yjs-setup.js";
import { getActiveDocumentId } from "./document-manager.js";
import { getProfile } from "./profile-service.js";

// ============================================================================
// Yjs Position Utilities
// ============================================================================

/**
 * Get the Yjs text type for position tracking.
 * We use the yXmlFragment which syncs with ProseMirror.
 */
function getYjsType() {
    return yXmlFragment;
}

/**
 * Create comment anchors from editor selection positions.
 * @param {number} fromPos - Start position (ProseMirror absolute)
 * @param {number} toPos - End position (ProseMirror absolute)
 * @param {string} selectedText - The selected text content
 * @returns {Object} { startAnchor, endAnchor, selectedText }
 */
export function createCommentAnchor(fromPos, toPos, selectedText) {
    const yType = getYjsType();

    // Create Yjs relative positions that survive edits
    const startRelPos = Y.createRelativePositionFromTypeIndex(yType, fromPos);
    const endRelPos = Y.createRelativePositionFromTypeIndex(yType, toPos);

    // Serialize to JSON strings for SQLite storage
    const startAnchor = JSON.stringify(Y.relativePositionToJSON(startRelPos));
    const endAnchor = JSON.stringify(Y.relativePositionToJSON(endRelPos));

    return { startAnchor, endAnchor, selectedText };
}

/**
 * Resolve a stored anchor back to absolute positions.
 * @param {string} startAnchor - JSON string of start RelativePosition
 * @param {string} endAnchor - JSON string of end RelativePosition
 * @returns {Object|null} { from, to } or null if anchor is invalid
 */
export function resolveAnchor(startAnchor, endAnchor) {
    try {
        const startRelPos = Y.createRelativePositionFromJSON(JSON.parse(startAnchor));
        const endRelPos = Y.createRelativePositionFromJSON(JSON.parse(endAnchor));

        const startAbsPos = Y.createAbsolutePositionFromRelativePosition(startRelPos, ydoc);
        const endAbsPos = Y.createAbsolutePositionFromRelativePosition(endRelPos, ydoc);

        if (!startAbsPos || !endAbsPos) {
            return null;
        }

        return {
            from: startAbsPos.index,
            to: endAbsPos.index
        };
    } catch (e) {
        console.warn("Failed to resolve comment anchor:", e);
        return null;
    }
}

/**
 * Fallback: fuzzy match selected text in document.
 * Used when Yjs anchors fail (e.g., text was deleted).
 * @param {string} selectedText - Original selected text
 * @param {string} documentText - Current document content
 * @returns {Object|null} { from, to } or null if not found
 */
export function fallbackFuzzyMatch(selectedText, documentText) {
    if (!selectedText || !documentText) return null;

    const index = documentText.indexOf(selectedText);
    if (index === -1) return null;

    return {
        from: index,
        to: index + selectedText.length
    };
}

// ============================================================================
// Tauri API Layer
// ============================================================================

/**
 * Add a new comment.
 * @param {Object} anchor - { startAnchor, endAnchor, selectedText }
 * @param {string} content - Comment text
 * @returns {Promise<number>} Comment ID
 */
export async function addComment(anchor, content) {
    const docId = getActiveDocumentId();
    if (!docId) throw new Error("No active document");

    const profile = await getProfile();

    return await invoke("add_comment", {
        docId,
        comment: {
            author: profile.name || "Unknown",
            author_color: profile.authorColor || "#3498db",
            start_anchor: anchor.startAnchor,
            end_anchor: anchor.endAnchor,
            selected_text: anchor.selectedText,
            content,
            parent_id: null,
        }
    });
}

/**
 * List all comments for the active document.
 * @param {string} [statusFilter] - Optional: 'active', 'resolved'
 * @returns {Promise<Array>} List of comments
 */
export async function listComments(statusFilter = null) {
    const docId = getActiveDocumentId();
    if (!docId) return [];

    return await invoke("list_comments", {
        docId,
        statusFilter
    });
}

/**
 * Add a reply to an existing comment.
 * @param {number} parentId - Parent comment ID
 * @param {string} content - Reply content
 * @returns {Promise<number>} New reply ID
 */
export async function addReply(parentId, content) {
    const docId = getActiveDocumentId();
    if (!docId) throw new Error("No active document");

    const profile = await getProfile();

    return await invoke("add_reply", {
        docId,
        parentId,
        content,
        author: profile.name || "Unknown",
        authorColor: profile.authorColor || "#3498db",
    });
}

/**
 * Resolve a comment.
 * @param {number} commentId - Comment ID to resolve
 */
export async function resolveComment(commentId) {
    const docId = getActiveDocumentId();
    if (!docId) throw new Error("No active document");

    await invoke("resolve_comment", {
        docId,
        commentId
    });
}

/**
 * Delete a comment and its replies.
 * @param {number} commentId - Comment ID to delete
 */
export async function deleteComment(commentId) {
    const docId = getActiveDocumentId();
    if (!docId) throw new Error("No active document");

    await invoke("delete_comment", {
        docId,
        commentId
    });
}

/**
 * Mark a comment as deleted (soft delete - still visible with 'deleted' status).
 * @param {number} commentId - Comment ID to mark as deleted
 */
export async function markCommentDeleted(commentId) {
    const docId = getActiveDocumentId();
    if (!docId) throw new Error("No active document");

    await invoke("mark_comment_deleted", {
        docId,
        commentId
    });
}

/**
 * Restore a deleted comment (set status back to 'unresolved').
 * @param {number} commentId - Comment ID to restore
 */
export async function restoreComment(commentId) {
    const docId = getActiveDocumentId();
    if (!docId) throw new Error("No active document");

    await invoke("restore_comment", {
        docId,
        commentId
    });
}

// ============================================================================
// Helper: Build thread structure from flat list
// ============================================================================

/**
 * Organize flat comment list into threads.
 * @param {Array} comments - Flat list of comments
 * @returns {Array} Root comments with replies nested
 */
export function buildCommentThreads(comments) {
    const rootComments = [];
    const repliesMap = new Map();

    // Separate root comments from replies
    for (const comment of comments) {
        if (comment.parent_id === null) {
            rootComments.push({ ...comment, replies: [] });
        } else {
            if (!repliesMap.has(comment.parent_id)) {
                repliesMap.set(comment.parent_id, []);
            }
            repliesMap.get(comment.parent_id).push(comment);
        }
    }

    // Attach replies to parents
    for (const root of rootComments) {
        root.replies = repliesMap.get(root.id) || [];
        // Sort replies by timestamp
        root.replies.sort((a, b) => a.timestamp - b.timestamp);
    }

    // Sort root comments by timestamp (newest first for sidebar)
    rootComments.sort((a, b) => b.timestamp - a.timestamp);

    return rootComments;
}
