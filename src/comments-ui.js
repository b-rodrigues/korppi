// src/comments-ui.js
// UI components for comments: context menu, modal, sidebar panel

import {
    createCommentAnchor,
    resolveAnchor,
    fallbackFuzzyMatch,
    addComment,
    listComments,
    addReply,
    resolveComment,
    deleteComment,
    buildCommentThreads
} from "./comments-service.js";
import { getEditorContent, editor, editorViewCtx } from "./editor.js";
import { escapeHtml } from "./utils.js";

// ============================================================================
// State
// ============================================================================

let commentsCache = [];
let activeTab = "timeline"; // 'timeline' or 'comments'

// ============================================================================
// Context Menu
// ============================================================================

let contextMenu = null;
let currentSelection = null;

/**
 * Show the context menu for adding a comment.
 * @param {number} x - Mouse X position
 * @param {number} y - Mouse Y position
 * @param {Object} selection - { from, to, text }
 */
export function showContextMenu(x, y, selection) {
    hideContextMenu();
    currentSelection = selection;

    contextMenu = document.createElement("div");
    contextMenu.className = "comment-context-menu";
    contextMenu.innerHTML = `
        <button class="context-menu-item" data-action="add-comment">
            <span class="icon">💬</span>
            <span class="label">Add Comment</span>
        </button>
    `;

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    document.body.appendChild(contextMenu);

    // Handle click
    contextMenu.querySelector('[data-action="add-comment"]').addEventListener("click", () => {
        hideContextMenu();
        showAddCommentModal(selection);
    });

    // Close on click outside
    setTimeout(() => {
        document.addEventListener("click", hideContextMenuOnClickOutside);
    }, 10);
}

function hideContextMenuOnClickOutside(e) {
    if (contextMenu && !contextMenu.contains(e.target)) {
        hideContextMenu();
    }
}

/**
 * Hide the context menu.
 */
export function hideContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
    document.removeEventListener("click", hideContextMenuOnClickOutside);
}

// ============================================================================
// Add Comment Modal
// ============================================================================

let commentModal = null;

/**
 * Show the add comment modal.
 * @param {Object} selection - { from, to, text }
 */
function showAddCommentModal(selection) {
    hideCommentModal();

    const excerpt = selection.text.length > 100
        ? selection.text.substring(0, 100) + "..."
        : selection.text;

    commentModal = document.createElement("div");
    commentModal.id = "add-comment-modal";
    commentModal.className = "modal";
    commentModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Add Comment</h2>
                <span class="modal-close">&times;</span>
            </div>
            <div class="modal-body">
                <div class="comment-excerpt">
                    <label>Selected text:</label>
                    <blockquote>${escapeHtml(excerpt)}</blockquote>
                </div>
                <div class="form-group">
                    <label for="comment-input">Your comment:</label>
                    <textarea id="comment-input" rows="4" placeholder="Enter your comment..."></textarea>
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-cancel-btn">Cancel</button>
                <button class="modal-save-btn primary">Save Comment</button>
            </div>
        </div>
    `;

    commentModal.style.display = "block";
    document.body.appendChild(commentModal);

    // Focus the textarea
    const textarea = commentModal.querySelector("#comment-input");
    setTimeout(() => textarea.focus(), 100);

    // Event handlers
    commentModal.querySelector(".modal-close").onclick = hideCommentModal;
    commentModal.querySelector(".modal-cancel-btn").onclick = hideCommentModal;
    commentModal.addEventListener("click", (e) => {
        if (e.target === commentModal) hideCommentModal();
    });

    commentModal.querySelector(".modal-save-btn").onclick = async () => {
        const content = textarea.value.trim();
        if (!content) {
            alert("Please enter a comment");
            return;
        }

        try {
            const anchor = createCommentAnchor(selection.from, selection.to, selection.text);
            await addComment(anchor, content);
            hideCommentModal();
            await refreshComments();

            // Switch to comments tab
            switchToTab("comments");
        } catch (err) {
            console.error("Failed to add comment:", err);
            alert("Failed to add comment: " + err);
        }
    };

    // Keyboard shortcut: Ctrl+Enter to submit
    textarea.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key === "Enter") {
            commentModal.querySelector(".modal-save-btn").click();
        }
    });
}

function hideCommentModal() {
    if (commentModal) {
        commentModal.remove();
        commentModal = null;
    }
}

// ============================================================================
// Sidebar Panel
// ============================================================================

/**
 * Initialize the comments panel in the sidebar.
 */
export function initCommentsPanel() {
    // Add tab switcher to timeline header
    const timelineHeader = document.querySelector(".timeline-header h3");
    if (timelineHeader) {
        const tabContainer = document.createElement("div");
        tabContainer.className = "sidebar-tabs";
        tabContainer.innerHTML = `
            <button class="sidebar-tab active" data-tab="timeline">Timeline</button>
            <button class="sidebar-tab" data-tab="comments">Comments</button>
        `;
        timelineHeader.replaceWith(tabContainer);

        // Tab click handlers
        tabContainer.querySelectorAll(".sidebar-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                switchToTab(btn.dataset.tab);
            });
        });
    }

    // Create comments panel (hidden initially)
    const rightSidebar = document.querySelector(".right-sidebar");
    if (rightSidebar) {
        const commentsPanel = document.createElement("div");
        commentsPanel.id = "comments-panel";
        commentsPanel.className = "comments-panel";
        commentsPanel.style.display = "none";
        commentsPanel.innerHTML = `
            <div class="comments-list" id="comments-list">
                <p class="empty-message">No comments yet</p>
            </div>
        `;

        // Insert before timeline-actions
        const timelineActions = rightSidebar.querySelector(".timeline-actions");
        if (timelineActions) {
            rightSidebar.insertBefore(commentsPanel, timelineActions);
        } else {
            rightSidebar.appendChild(commentsPanel);
        }
    }

    // Listen for document changes to refresh comments
    window.addEventListener("document-changed", refreshComments);
}

/**
 * Switch between timeline and comments tabs.
 * @param {string} tab - 'timeline' or 'comments'
 */
function switchToTab(tab) {
    activeTab = tab;

    // Update tab buttons
    document.querySelectorAll(".sidebar-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    // Toggle panels
    const timelineList = document.getElementById("timeline-list");
    const timelineControls = document.querySelector(".timeline-header .timeline-controls");
    const commentsPanel = document.getElementById("comments-panel");

    if (tab === "timeline") {
        if (timelineList) timelineList.style.display = "flex";
        if (timelineControls) timelineControls.style.display = "flex";
        if (commentsPanel) commentsPanel.style.display = "none";
    } else {
        if (timelineList) timelineList.style.display = "none";
        if (timelineControls) timelineControls.style.display = "none";
        if (commentsPanel) commentsPanel.style.display = "flex";
        refreshComments();
    }
}

/**
 * Refresh the comments list.
 */
export async function refreshComments() {
    try {
        const comments = await listComments("active");
        commentsCache = comments;
        renderCommentsList(comments);
    } catch (err) {
        console.error("Failed to load comments:", err);
    }
}

/**
 * Render the comments list in the sidebar.
 * @param {Array} comments - List of comments
 */
function renderCommentsList(comments) {
    const container = document.getElementById("comments-list");
    if (!container) return;

    if (!comments || comments.length === 0) {
        container.innerHTML = '<p class="empty-message">No comments yet. Select text and right-click to add a comment.</p>';
        return;
    }

    const threads = buildCommentThreads(comments);
    const documentText = getEditorContent();

    container.innerHTML = threads.map(thread => renderCommentThread(thread, documentText)).join("");

    // Add event handlers
    container.querySelectorAll(".comment-item").forEach(item => {
        const commentId = parseInt(item.dataset.commentId);

        // Click to scroll to position
        item.addEventListener("click", (e) => {
            if (e.target.closest(".comment-actions")) return;
            scrollToComment(commentId);
        });

        // Resolve button
        item.querySelector(".resolve-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            await resolveComment(commentId);
            await refreshComments();
        });

        // Delete button
        item.querySelector(".delete-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (confirm("Delete this comment and all replies?")) {
                await deleteComment(commentId);
                await refreshComments();
            }
        });

        // Reply button
        item.querySelector(".reply-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            showReplyInput(commentId, item);
        });
    });
}

/**
 * Render a single comment thread.
 */
function renderCommentThread(thread, documentText) {
    const color = thread.author_color || "#3498db";
    const excerpt = thread.selected_text.length > 50
        ? thread.selected_text.substring(0, 50) + "..."
        : thread.selected_text;
    const date = new Date(thread.timestamp).toLocaleDateString();
    const repliesCount = thread.replies?.length || 0;

    return `
        <div class="comment-item" data-comment-id="${thread.id}">
            <div class="comment-header">
                <span class="comment-author" style="color:${color};">${escapeHtml(thread.author)}</span>
                <span class="comment-date">${date}</span>
            </div>
            <div class="comment-excerpt">"${escapeHtml(excerpt)}"</div>
            <div class="comment-content">${escapeHtml(thread.content)}</div>
            ${repliesCount > 0 ? `
                <div class="comment-replies">
                    ${thread.replies.map(r => `
                        <div class="reply-item">
                            <span class="reply-author" style="color:${r.author_color || '#999'};">${escapeHtml(r.author)}</span>
                            <span class="reply-content">${escapeHtml(r.content)}</span>
                        </div>
                    `).join("")}
                </div>
            ` : ""}
            <div class="comment-actions">
                <button class="reply-btn" title="Reply">↩ Reply</button>
                <button class="resolve-btn" title="Resolve">✓ Resolve</button>
                <button class="delete-btn" title="Delete">🗑</button>
            </div>
        </div>
    `;
}

/**
 * Show reply input for a comment.
 */
function showReplyInput(parentId, commentItem) {
    // Remove existing reply inputs
    document.querySelectorAll(".reply-input-container").forEach(el => el.remove());

    const container = document.createElement("div");
    container.className = "reply-input-container";
    container.innerHTML = `
        <textarea class="reply-textarea" placeholder="Write a reply..." rows="2"></textarea>
        <div class="reply-input-actions">
            <button class="cancel-reply-btn">Cancel</button>
            <button class="submit-reply-btn primary">Reply</button>
        </div>
    `;

    commentItem.appendChild(container);
    const textarea = container.querySelector(".reply-textarea");
    textarea.focus();

    container.querySelector(".cancel-reply-btn").onclick = () => container.remove();
    container.querySelector(".submit-reply-btn").onclick = async () => {
        const content = textarea.value.trim();
        if (!content) return;

        try {
            await addReply(parentId, content);
            container.remove();
            await refreshComments();
        } catch (err) {
            console.error("Failed to add reply:", err);
            alert("Failed to add reply: " + err);
        }
    };
}

/**
 * Scroll to a comment's position in the editor.
 */
function scrollToComment(commentId) {
    const comment = commentsCache.find(c => c.id === commentId);
    if (!comment) return;

    // Try to resolve anchor
    let position = resolveAnchor(comment.start_anchor, comment.end_anchor);

    // Fallback to fuzzy match
    if (!position) {
        const documentText = getEditorContent();
        position = fallbackFuzzyMatch(comment.selected_text, documentText);
    }

    if (position && editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);

            // Set selection to the comment range
            const tr = view.state.tr.setSelection(
                view.state.selection.constructor.create(view.state.doc, position.from, position.to)
            );
            view.dispatch(tr);

            // Scroll into view
            view.focus();
        });
    }
}

// ============================================================================
// Editor Integration
// ============================================================================

/**
 * Initialize editor context menu for comments.
 */
export function initEditorContextMenu() {
    const editorEl = document.getElementById("editor");
    if (!editorEl) return;

    editorEl.addEventListener("contextmenu", (e) => {
        // Check if there's a selection
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();

        if (selectedText && selectedText.length > 0 && editor) {
            e.preventDefault();

            // Get ProseMirror selection positions
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const { from, to } = view.state.selection;

                showContextMenu(e.clientX, e.clientY, {
                    from,
                    to,
                    text: selectedText
                });
            });
        }
    });
}

/**
 * Get comments for highlighting (exported for use by highlighting decorator).
 */
export function getCommentsForHighlighting() {
    return commentsCache;
}
