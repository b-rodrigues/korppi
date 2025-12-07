// src/word-count.js
// Real-time word, character, and pending items count

import { getEditorContent } from "./editor.js";
import { fetchPatchList } from "./timeline.js";
import { listComments } from "./comments-service.js";

let updateTimeout = null;
let pendingUpdateTimeout = null;

/**
 * Initialize word count and status bar functionality
 */
export function initWordCount() {
    // Initial update
    updateWordCount();
    updatePendingCounts();

    // Listen for content changes
    window.addEventListener("markdown-updated", () => {
        // Debounce updates
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateWordCount, 300);
    });

    // Also update on document change
    window.addEventListener("document-changed", () => {
        setTimeout(() => {
            updateWordCount();
            updatePendingCounts();
        }, 100);
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
 */
function updateWordCount() {
    const content = getEditorContent() || "";

    // Count words (split by whitespace, filter empty)
    const words = content.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = content.trim() === "" ? 0 : words.length;

    // Count characters (with and without spaces)
    const charCount = content.length;
    const charCountNoSpaces = content.replace(/\s/g, "").length;

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

    // Update pending patches
    try {
        const patches = await fetchPatchList();
        const pendingPatches = patches.filter(p => p.review_status === "pending");
        const count = pendingPatches.length;

        if (patchesEl) {
            patchesEl.textContent = `📋 ${count} patch${count !== 1 ? 'es' : ''}`;
            patchesEl.classList.toggle("has-pending", count > 0);
            patchesEl.title = count > 0
                ? `${count} pending patch${count !== 1 ? 'es' : ''} to review`
                : "No pending patches";
        }
    } catch (err) {
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
    const words = content.trim().split(/\s+/).filter(w => w.length > 0);
    return content.trim() === "" ? 0 : words.length;
}

/**
 * Get current character count (for external use)
 */
export function getCharCount() {
    const content = getEditorContent() || "";
    return content.length;
}
