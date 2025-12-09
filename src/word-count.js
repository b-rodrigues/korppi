// src/word-count.js
// Real-time word, character, and pending items count

import { getEditorContent } from "./editor.js";
import { fetchPatchList, hasSnapshotContent } from "./timeline.js";
import { listComments } from "./comments-service.js";
import { getActiveDocumentId, onDocumentChange } from "./document-manager.js";

let updateTimeout = null;
let pendingUpdateTimeout = null;

// Content cache to avoid redundant calculations
let cachedContent = null;
let cachedWordCount = 0;
let cachedCharCount = 0;
let cachedCharCountNoSpaces = 0;

/**
 * Initialize word count and status bar functionality
 */
export function initWordCount() {
    // Initial update (may be 0 if no document open yet)
    updateWordCount();
    updatePendingCounts();

    // Listen for content changes (typing)
    window.addEventListener("markdown-updated", () => {
        // Debounce updates
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateWordCount, 300);
    });

    // Listen for document changes via document-manager (most reliable)
    onDocumentChange((event, doc) => {
        // Update immediately when a document is opened or switched
        if (event === "open" || event === "activeChange" || event === "new") {
            updateWordCount();
            updatePendingCounts();
        }
    });

    // Also listen for window event as backup
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
 * Uses caching to avoid redundant string operations
 */
function updateWordCount() {
    const content = getEditorContent() || "";

    // Only recalculate if content changed
    if (content !== cachedContent) {
        cachedContent = content;

        // Count words (split by whitespace, filter empty)
        const trimmed = content.trim();
        if (trimmed === "") {
            cachedWordCount = 0;
        } else {
            // Faster word counting without creating an array
            cachedWordCount = 1;
            let inWord = true;
            for (let i = 0; i < trimmed.length; i++) {
                const isWs = trimmed.charCodeAt(i) <= 32;
                if (isWs && inWord) {
                    inWord = false;
                } else if (!isWs && !inWord) {
                    cachedWordCount++;
                    inWord = true;
                }
            }
        }

        // Count characters
        cachedCharCount = content.length;

        // Count non-whitespace characters without creating a new string
        cachedCharCountNoSpaces = 0;
        for (let i = 0; i < content.length; i++) {
            if (content.charCodeAt(i) > 32) {
                cachedCharCountNoSpaces++;
            }
        }
    }

    // Update display
    const wordEl = document.getElementById("word-count");
    const charEl = document.getElementById("char-count");

    if (wordEl) {
        wordEl.textContent = `${cachedWordCount.toLocaleString()} word${cachedWordCount !== 1 ? 's' : ''}`;
    }

    if (charEl) {
        charEl.textContent = `${cachedCharCount.toLocaleString()} char${cachedCharCount !== 1 ? 's' : ''}`;
        charEl.title = `${cachedCharCountNoSpaces.toLocaleString()} without spaces`;
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
             // Basic check if it has data.snapshot
             return p.data && typeof p.data.snapshot === 'string';
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
 * Uses cached value if available, otherwise calculates
 */
export function getWordCount() {
    const content = getEditorContent() || "";
    if (content === cachedContent) {
        return cachedWordCount;
    }
    // Update cache and return
    updateWordCount();
    return cachedWordCount;
}

/**
 * Get current character count (for external use)
 * Uses cached value if available, otherwise calculates
 */
export function getCharCount() {
    const content = getEditorContent() || "";
    if (content === cachedContent) {
        return cachedCharCount;
    }
    // Update cache and return
    updateWordCount();
    return cachedCharCount;
}
