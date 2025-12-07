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
    markCommentDeleted,
    restoreComment,
    buildCommentThreads
} from "./comments-service.js";
import { getEditorContent, editor, editorViewCtx } from "./editor.js";
import { escapeHtml } from "./utils.js";
import { getProfile } from "./profile-service.js";

// ============================================================================
// State
// ============================================================================

let commentsCache = [];
let activeTab = "timeline"; // 'timeline' or 'comments'
let currentStatusFilter = null; // null = all, 'unresolved', 'resolved', 'deleted'
let currentHighlightDecoration = null;

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
        <button class="context-menu-item" data-action="bold">
            <span class="icon"><b>B</b></span>
            <span class="label">Bold</span>
            <span class="shortcut">Ctrl+B</span>
        </button>
        <button class="context-menu-item" data-action="italic">
            <span class="icon"><i>I</i></span>
            <span class="label">Italic</span>
            <span class="shortcut">Ctrl+I</span>
        </button>
        <button class="context-menu-item" data-action="strikethrough">
            <span class="icon"><s>S</s></span>
            <span class="label">Strikethrough</span>
        </button>
        <button class="context-menu-item" data-action="inline-code">
            <span class="icon">&lt;/&gt;</span>
            <span class="label">Inline Code</span>
        </button>
        <button class="context-menu-item" data-action="link">
            <span class="icon">🔗</span>
            <span class="label">Add Link</span>
        </button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" data-action="copy">
            <span class="icon">📋</span>
            <span class="label">Copy</span>
            <span class="shortcut">Ctrl+C</span>
        </button>
        <button class="context-menu-item" data-action="search">
            <span class="icon">🔍</span>
            <span class="label">Search in Document</span>
        </button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" data-action="add-comment">
            <span class="icon">💬</span>
            <span class="label">Add Comment</span>
        </button>
    `;

    // Adjust position if too close to edge
    const menuWidth = 200;
    const menuHeight = 320;
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10);
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10);

    contextMenu.style.left = `${adjustedX}px`;
    contextMenu.style.top = `${adjustedY}px`;
    document.body.appendChild(contextMenu);

    // Handle clicks
    contextMenu.addEventListener("click", async (e) => {
        const item = e.target.closest('[data-action]');
        if (!item) return;

        const action = item.dataset.action;
        hideContextMenu();

        switch (action) {
            case 'bold':
                applyMark('strong');
                break;
            case 'italic':
                applyMark('emphasis');
                break;
            case 'strikethrough':
                applyMark('strike_through');
                break;
            case 'inline-code':
                applyMark('inlineCode');
                break;
            case 'link':
                await insertLink();
                break;
            case 'copy':
                await navigator.clipboard.writeText(selection.text);
                break;
            case 'search':
                highlightAllOccurrences(selection.text);
                break;
            case 'add-comment':
                showAddCommentModal(selection);
                break;
        }
    });

    // Close on click outside
    setTimeout(() => {
        document.addEventListener("click", hideContextMenuOnClickOutside);
    }, 10);
}

/**
 * Apply a mark to the current selection
 */
function applyMark(markName) {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;
        const markType = state.schema.marks[markName];

        if (!markType) {
            console.warn(`Mark type not found: ${markName}`);
            return;
        }

        const { from, to } = state.selection;
        if (from === to) return;

        const tr = state.tr.addMark(from, to, markType.create());
        dispatch(tr);
        view.focus();
    });
}

/**
 * Insert a link on the current selection
 */
async function insertLink() {
    if (!editor) return;

    const url = prompt("Enter URL:", "https://");
    if (!url) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;
        const linkMark = state.schema.marks.link;

        if (!linkMark) {
            console.warn("Link mark not found in schema");
            return;
        }

        const { from, to } = state.selection;
        if (from === to) return;

        const tr = state.tr.addMark(from, to, linkMark.create({ href: url }));
        dispatch(tr);
        view.focus();
    });
}

/**
 * Highlight all occurrences of the selected text in the document
 */
function highlightAllOccurrences(searchText) {
    if (!editor || !searchText) return;

    // Clear existing search highlights
    document.querySelectorAll('.search-highlight-overlay').forEach(el => el.remove());

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = view.state.doc;
        const occurrences = [];

        // Find all occurrences
        doc.descendants((node, pos) => {
            if (node.isText) {
                const text = node.text;
                let idx = 0;
                while ((idx = text.indexOf(searchText, idx)) !== -1) {
                    occurrences.push({
                        from: pos + idx,
                        to: pos + idx + searchText.length
                    });
                    idx += searchText.length;
                }
            }
        });

        // Create highlight overlays for each occurrence
        occurrences.forEach((occ, i) => {
            const fromCoords = view.coordsAtPos(occ.from);
            const toCoords = view.coordsAtPos(occ.to);

            const highlight = document.createElement('div');
            highlight.className = 'search-highlight-overlay';
            highlight.style.cssText = `
                position: fixed;
                left: ${fromCoords.left}px;
                top: ${fromCoords.top}px;
                width: ${toCoords.right - fromCoords.left}px;
                height: ${toCoords.bottom - fromCoords.top}px;
                background: rgba(255, 235, 59, 0.4);
                border: 1px solid rgba(255, 193, 7, 0.8);
                pointer-events: none;
                z-index: 45;
                border-radius: 2px;
            `;
            document.body.appendChild(highlight);

            // Auto-remove after 3 seconds
            setTimeout(() => highlight.remove(), 3000);
        });

        // Show count
        if (occurrences.length > 1) {
            showSearchToast(`Found ${occurrences.length} occurrences`);
        }
    });
}

/**
 * Show a temporary toast notification
 */
function showSearchToast(message) {
    const toast = document.createElement('div');
    toast.className = 'search-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 16px;
        background: var(--bg-sidebar);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 12px;
        z-index: 1100;
        box-shadow: var(--shadow-md);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
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
            <div class="comments-filter">
                <select id="comments-status-filter" class="compact-select">
                    <option value="">All Comments</option>
                    <option value="unresolved" selected>Unresolved</option>
                    <option value="resolved">Resolved</option>
                    <option value="deleted">Deleted</option>
                </select>
            </div>
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

        // Status filter handler
        commentsPanel.querySelector("#comments-status-filter").addEventListener("change", (e) => {
            currentStatusFilter = e.target.value || null;
            refreshComments();
        });

        // Set initial filter
        currentStatusFilter = "unresolved";
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
        if (timelineList) timelineList.style.display = "block";
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
        // First check for orphaned comments (run on unresolved only, not on current filter)
        await checkForOrphanedComments();

        // Then fetch with the current filter
        const comments = await listComments(currentStatusFilter);
        commentsCache = comments;

        renderCommentsList(comments);
    } catch (err) {
        console.error("Failed to load comments:", err);
    }
}

/**
 * Check if any comments have become orphaned (text deleted).
 * Mark them as 'deleted' status.
 */
async function checkForOrphanedComments() {
    // Fetch all unresolved comments to check for orphans
    const unresolvedComments = await listComments('unresolved');
    const documentText = getEditorContent();

    if (!documentText) return;

    for (const comment of unresolvedComments) {
        // Skip replies
        if (comment.parent_id !== null) continue;

        // Try fuzzy match (simpler and more reliable than Yjs anchors for now)
        const found = documentText.includes(comment.selected_text);

        // If text not found, mark as deleted
        if (!found) {
            try {
                await markCommentDeleted(comment.id);
            } catch (err) {
                console.warn("Failed to mark orphaned comment as deleted:", err);
            }
        }
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
        const comment = commentsCache.find(c => c.id === commentId);

        // Hover to highlight text in editor
        item.addEventListener("mouseenter", () => {
            highlightCommentInEditor(comment);
        });
        item.addEventListener("mouseleave", () => {
            clearCommentHighlight();
        });

        // Click to scroll to position
        item.addEventListener("click", (e) => {
            if (e.target.closest(".comment-actions")) return;
            scrollToComment(commentId);
        });

        // Resolve button (only for unresolved)
        item.querySelector(".resolve-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            await resolveComment(commentId);
            await refreshComments();
        });

        // Delete button: soft delete for unresolved/resolved, hard delete for already deleted
        item.querySelector(".delete-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (comment && comment.status === 'deleted') {
                // Already deleted → hard delete (permanent removal)
                await deleteComment(commentId);
            } else {
                // Unresolved or resolved → soft delete (move to deleted status)
                await markCommentDeleted(commentId);
            }
            await refreshComments();
        });

        // Restore button (for deleted comments)
        item.querySelector(".restore-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            await restoreComment(commentId);
            await refreshComments();
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
    const isDeleted = thread.status === 'deleted';
    const isResolved = thread.status === 'resolved';

    const statusBadge = isDeleted
        ? '<span class="comment-status deleted">⚠ Text deleted</span>'
        : isResolved
            ? '<span class="comment-status resolved">✓ Resolved</span>'
            : '';

    return `
        <div class="comment-item ${isDeleted ? 'deleted' : ''} ${isResolved ? 'resolved' : ''}" data-comment-id="${thread.id}">
            <div class="comment-header">
                <span class="comment-author" style="color:${color};">${escapeHtml(thread.author)}</span>
                <span class="comment-date">${date}</span>
            </div>
            ${statusBadge}
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
                ${!isDeleted && !isResolved ? '<button class="reply-btn" title="Reply">↩ Reply</button>' : ''}
                ${!isDeleted && !isResolved ? '<button class="resolve-btn" title="Resolve">✓ Resolve</button>' : ''}
                ${isDeleted ? '<button class="restore-btn" title="Restore">↻ Restore</button>' : ''}
                <button class="delete-btn" title="Delete permanently">🗑</button>
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

/**
 * Highlight a comment's text in the editor (on hover).
 */
async function highlightCommentInEditor(comment) {
    if (!comment || !editor) return;

    // Skip if deleted
    if (comment.status === 'deleted') return;

    const searchText = comment.selected_text;
    if (!searchText) return;

    // Use current profile color for highlighting
    const profile = await getProfile();
    const highlightColor = profile.color || '#3498db';

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = view.state.doc;

        // Search for the text in the document
        let found = false;
        let foundFrom = -1;
        let foundTo = -1;

        doc.descendants((node, pos) => {
            if (found) return false; // Stop if already found
            if (node.isText) {
                const text = node.text;
                const idx = text.indexOf(searchText);
                if (idx !== -1) {
                    foundFrom = pos + idx;
                    foundTo = foundFrom + searchText.length;
                    found = true;
                    return false;
                }
            }
        });

        if (!found) return;

        // Get coordinates from ProseMirror positions
        const fromCoords = view.coordsAtPos(foundFrom);
        const toCoords = view.coordsAtPos(foundTo);

        // Handle multi-line selections - use bounding box
        const minLeft = Math.min(fromCoords.left, toCoords.left);
        const maxRight = Math.max(fromCoords.right, toCoords.right);

        // Create highlight overlay
        clearCommentHighlight();

        const highlight = document.createElement('div');
        highlight.className = 'comment-highlight-overlay';
        highlight.style.cssText = `
            position: fixed;
            left: ${minLeft}px;
            top: ${fromCoords.top}px;
            width: ${maxRight - minLeft}px;
            height: ${toCoords.bottom - fromCoords.top}px;
            background: ${highlightColor}33;
            border: 2px solid ${highlightColor};
            pointer-events: none;
            z-index: 50;
            border-radius: 3px;
        `;
        document.body.appendChild(highlight);
        currentHighlightDecoration = highlight;
    });
}

/**
 * Clear the comment highlight overlay.
 */
function clearCommentHighlight() {
    if (currentHighlightDecoration) {
        currentHighlightDecoration.remove();
        currentHighlightDecoration = null;
    }
    // Also remove any stray overlays
    document.querySelectorAll('.comment-highlight-overlay').forEach(el => el.remove());
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
