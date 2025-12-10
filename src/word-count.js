// src/word-count.js
// Real-time word, character, and pending items count

import { getEditorContent } from "./editor.js";
import { fetchPatchList, hasSnapshotContent } from "./timeline.js";
import { listComments } from "./comments-service.js";
import { getActiveDocumentId } from "./document-manager.js";
import { showRightSidebar } from "./components/sidebar-controller.js";

let updateTimeout = null;
let pendingUpdateTimeout = null;

/**
 * Initialize word count and status bar functionality
 */
export function initWordCount() {
    // Initial update (may be 0 if no document open yet)
    updateWordCount();
    updatePendingCounts();

    // Setup click handlers for pending badges to open sidebar
    const patchesEl = document.getElementById("pending-patches");
    const commentsEl = document.getElementById("pending-comments");

    if (patchesEl) {
        patchesEl.style.cursor = "pointer";
        patchesEl.addEventListener("click", () => showRightSidebar("timeline"));
    }

    if (commentsEl) {
        commentsEl.style.cursor = "pointer";
        commentsEl.addEventListener("click", () => showRightSidebar("comments"));
    }

    // Listen for content changes (typing)
    window.addEventListener("markdown-updated", () => {
        // Debounce updates
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateWordCount, 300);
    });

    // Listen for document switches AFTER content is loaded (yjs-doc-replaced fires after switchDocument)
    window.addEventListener("yjs-doc-replaced", () => {
        // Small delay to ensure editor state is updated
        setTimeout(() => {
            updateWordCount();
            updatePendingCounts();
        }, 50);
    });

    // Listen for content restored (after patch restore)
    window.addEventListener("yjs-content-restored", () => {
        updateWordCount();
    });

    // Listen for document-changed event (fired after import content is set)
    window.addEventListener("document-changed", () => {
        updateWordCount();
        updatePendingCounts();
    });

    // Listen for timeline/comment updates
    window.addEventListener("patch-status-updated", () => {
        debouncedPendingUpdate();
    });

    window.addEventListener("comments-updated", () => {
        debouncedPendingUpdate();
    });

    // Periodic refresh of pending counts (every 30 seconds)
    setInterval(updatePendingCounts, 30000);
}

function debouncedPendingUpdate() {
    if (pendingUpdateTimeout) clearTimeout(pendingUpdateTimeout);
    pendingUpdateTimeout = setTimeout(updatePendingCounts, 500);
}

/**
 * Update the word count display
 * Recalculates every time for accuracy (fast enough without caching)
 */
function updateWordCount() {
    const content = getEditorContent() || "";

    // Count words
    const trimmed = content.trim();
    let wordCount = 0;
    if (trimmed !== "") {
        wordCount = 1;
        let inWord = true;
        for (let i = 0; i < trimmed.length; i++) {
            const isWs = trimmed.charCodeAt(i) <= 32;
            if (isWs && inWord) {
                inWord = false;
            } else if (!isWs && !inWord) {
                wordCount++;
                inWord = true;
            }
        }
    }

    // Count characters
    const charCount = content.length;

    // Count non-whitespace characters
    let charCountNoSpaces = 0;
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) > 32) {
            charCountNoSpaces++;
        }
    }

    // Update display
    const wordEl = document.getElementById("word-count");
    const charEl = document.getElementById("char-count");

    if (wordEl) {
        wordEl.textContent = `${wordCount.toLocaleString()} word${wordCount !== 1 ? 's' : ''}`;
    }

    if (charEl) {
        charEl.textContent = `${charCount.toLocaleString()} char${charCount !== 1 ? 's' : ''}`;
        charEl.title = `${charCountNoSpaces.toLocaleString()} without spaces`;
    }
}

/**
 * Update pending patches and comments counts
 */
async function updatePendingCounts() {
    const patchesEl = document.getElementById("pending-patches");
    const commentsEl = document.getElementById("pending-comments");

    // Check if there's an active document
    const docId = getActiveDocumentId();

    if (!docId) {
        // No document open - reset counters to 0
        if (patchesEl) {
            patchesEl.textContent = "📋 0 patches";
            patchesEl.classList.remove("has-pending");
            patchesEl.title = "No document open";
        }
        if (commentsEl) {
            commentsEl.textContent = "💬 0 comments";
            commentsEl.classList.remove("has-pending");
            commentsEl.title = "No document open";
        }
        return;
    }

    // Update pending patches
    try {
        // Importing modules dynamically to avoid circular dependencies
        const { invoke } = await import("@tauri-apps/api/core");
        const { getCachedProfile } = await import("./profile-service.js");

        const profile = getCachedProfile();
        const currentUserId = profile?.id || 'local';

        // Use backend to count patches needing MY review
        const patches = await invoke("get_document_patches_needing_review", {
            docId,
            reviewerId: currentUserId
        });

        // Filter out patches without snapshots (metadata-only updates shouldn't be reviewed here)
        // Though get_document_patches_needing_review returns all types,
        // usually we care about content changes (kind=Save/Edit)
        // Let's assume the backend already filtered or we accept all types.
        // But for UI consistency with timeline, check for snapshot if possible.
        // The Patch struct has `data` field.

        const count = patches.filter(p => {
            // Only count Save patches (exclude semantic_group which is too granular)
            // Must also have a snapshot to be reviewable
            return p.kind === "Save" && p.data && typeof p.data.snapshot === 'string';
        }).length;

        if (patchesEl) {
            patchesEl.textContent = `📋 ${count} patch${count !== 1 ? 'es' : ''}`;
            patchesEl.classList.toggle("has-pending", count > 0);
            patchesEl.title = count > 0
                ? `${count} pending patch${count !== 1 ? 'es' : ''} to review`
                : "No pending patches";
        }
    } catch (err) {
        console.warn("Failed to update pending patch count:", err);
        // Ignore errors, keep previous value
    }

    // Update unresolved comments
    try {
        const comments = await listComments();
        const unresolvedComments = comments.filter(c => c.status === "unresolved");
        const count = unresolvedComments.length;

        if (commentsEl) {
            commentsEl.textContent = `💬 ${count} comment${count !== 1 ? 's' : ''}`;
            commentsEl.classList.toggle("has-pending", count > 0);
            commentsEl.title = count > 0
                ? `${count} unresolved comment${count !== 1 ? 's' : ''}`
                : "No unresolved comments";
        }
    } catch (err) {
        // Ignore errors, keep previous value
    }
}

/**
 * Get current word count (for external use)
 */
export function getWordCount() {
    const content = getEditorContent() || "";
    const trimmed = content.trim();
    if (trimmed === "") return 0;

    let wordCount = 1;
    let inWord = true;
    for (let i = 0; i < trimmed.length; i++) {
        const isWs = trimmed.charCodeAt(i) <= 32;
        if (isWs && inWord) {
            inWord = false;
        } else if (!isWs && !inWord) {
            wordCount++;
            inWord = true;
        }
    }
    return wordCount;
}

/**
 * Get current character count (for external use)
 */
export function getCharCount() {
    const content = getEditorContent() || "";
    return content.length;
}
