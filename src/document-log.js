// src/document-log.js
// Full document history log viewer - shows all events in chronological order

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { getCachedProfile } from "./profile-service.js";
import { escapeHtml, stripMarkdown } from "./utils.js";
import { calculateCharDiff } from "./diff-highlighter.js";

// Event types for the log
const EVENT_TYPES = {
    SAVE: 'save',
    EXPORT_MD: 'export_md',
    EXPORT_DOCX: 'export_docx',
    IMPORT: 'import',
    ACCEPT: 'accept',
    REJECT: 'reject',
    RESTORE: 'restore',
    COMMENT: 'comment',
    COMMENT_RESOLVED: 'comment_resolved'
};

// Store logged events in memory (supplemental to patches)
// Map<docId, Array<{type, timestamp, details}>>
const documentEvents = new Map();

// Cache for patch data (for hover previews)
let patchCache = new Map();

/**
 * Log an event for the current document
 * @param {string} type - Event type from EVENT_TYPES
 * @param {object} details - Event details
 */
export function logEvent(type, details = {}) {
    const docId = getActiveDocumentId();
    if (!docId) return;

    if (!documentEvents.has(docId)) {
        documentEvents.set(docId, []);
    }

    const profile = getCachedProfile();
    const event = {
        type,
        timestamp: Date.now(),
        author: profile?.name || 'Local User',
        authorId: profile?.id || 'local',
        authorColor: profile?.color || '#3498db',
        ...details
    };

    documentEvents.get(docId).push(event);

    // Also persist to localStorage for session recovery
    persistEvents(docId);
}

/**
 * Persist events to localStorage
 */
function persistEvents(docId) {
    const events = documentEvents.get(docId) || [];
    try {
        localStorage.setItem(`document-events-${docId}`, JSON.stringify(events));
    } catch (e) {
        console.warn("Failed to persist events:", e);
    }
}

/**
 * Load persisted events from localStorage
 */
function loadPersistedEvents(docId) {
    try {
        const stored = localStorage.getItem(`document-events-${docId}`);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.warn("Failed to load persisted events:", e);
    }
    return [];
}

/**
 * Get all log entries for the current document
 * Combines patches, reviews, and logged events
 */
async function getAllLogEntries() {
    const docId = getActiveDocumentId();
    if (!docId) return [];

    const entries = [];

    // Clear and rebuild patch cache
    patchCache = new Map();

    // 1. Get all patches
    let patches = [];
    try {
        patches = await invoke("list_document_patches", { id: docId });

        // Build patch cache for hover previews
        for (const patch of patches) {
            patchCache.set(patch.id, patch);
        }

        for (const patch of patches) {
            if (patch.kind === "Save") {
                entries.push({
                    type: EVENT_TYPES.SAVE,
                    timestamp: patch.timestamp,
                    author: patch.data?.authorName || patch.author,
                    authorColor: patch.data?.authorColor || '#808080',
                    details: {
                        patchId: patch.id,
                        uuid: patch.uuid,
                        snapshotLength: patch.data?.snapshot?.length || 0
                    }
                });
            }
        }

        // 2. Get all reviews
        const reviewerMap = new Map(); // Track unique patch reviews

        for (const patch of patches) {
            if (patch.uuid) {
                try {
                    const reviews = await invoke("get_document_patch_reviews", {
                        docId,
                        patchUuid: patch.uuid
                    });

                    for (const review of reviews) {
                        const key = `${review.patch_uuid}-${review.reviewer_id}`;
                        if (!reviewerMap.has(key)) {
                            reviewerMap.set(key, true);
                            entries.push({
                                type: review.decision === 'accepted' ? EVENT_TYPES.ACCEPT : EVENT_TYPES.REJECT,
                                timestamp: review.reviewed_at,
                                author: review.reviewer_name || review.reviewer_id,
                                authorColor: '#808080',
                                details: {
                                    patchId: patch.id,
                                    patchUuid: patch.uuid,
                                    patchAuthor: patch.data?.authorName || patch.author,
                                    patchAuthorColor: patch.data?.authorColor || '#808080',
                                    decision: review.decision
                                }
                            });
                        }
                    }
                } catch (e) {
                    // Ignore errors for individual patches
                }
            }
        }
    } catch (e) {
        console.warn("Failed to fetch patches:", e);
    }

    // 3. Get comments
    try {
        const comments = await invoke("list_document_comments", { docId });
        for (const comment of comments) {
            entries.push({
                type: comment.status === 'resolved' ? EVENT_TYPES.COMMENT_RESOLVED : EVENT_TYPES.COMMENT,
                timestamp: comment.timestamp,
                author: comment.author,
                authorColor: comment.author_color || '#808080',
                details: {
                    commentId: comment.id,
                    content: comment.content?.substring(0, 100) + (comment.content?.length > 100 ? '...' : ''),
                    selectedText: comment.selected_text?.substring(0, 50) + (comment.selected_text?.length > 50 ? '...' : ''),
                    status: comment.status
                }
            });
        }
    } catch (e) {
        // Comments might not exist
    }

    // 4. Add memory/persisted events (exports, imports, restores)
    const persistedEvents = loadPersistedEvents(docId);
    const memoryEvents = documentEvents.get(docId) || [];

    // Merge persisted and memory events, deduplicate by timestamp
    const eventMap = new Map();
    for (const event of [...persistedEvents, ...memoryEvents]) {
        eventMap.set(event.timestamp, event);
    }

    for (const event of eventMap.values()) {
        entries.push(event);
    }

    // Sort all entries by timestamp (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    return entries;
}

/**
 * Get icon for event type
 */
function getEventIcon(type) {
    switch (type) {
        case EVENT_TYPES.SAVE: return '💾';
        case EVENT_TYPES.EXPORT_MD: return '📝';
        case EVENT_TYPES.EXPORT_DOCX: return '📄';
        case EVENT_TYPES.IMPORT: return '📥';
        case EVENT_TYPES.ACCEPT: return '✓';
        case EVENT_TYPES.REJECT: return '✗';
        case EVENT_TYPES.RESTORE: return '↺';
        case EVENT_TYPES.COMMENT: return '💬';
        case EVENT_TYPES.COMMENT_RESOLVED: return '✅';
        default: return '•';
    }
}

/**
 * Get CSS class for event type
 */
function getEventClass(type) {
    switch (type) {
        case EVENT_TYPES.ACCEPT: return 'event-accept';
        case EVENT_TYPES.REJECT: return 'event-reject';
        case EVENT_TYPES.EXPORT_MD:
        case EVENT_TYPES.EXPORT_DOCX: return 'event-export';
        case EVENT_TYPES.IMPORT: return 'event-import';
        case EVENT_TYPES.RESTORE: return 'event-restore';
        case EVENT_TYPES.COMMENT:
        case EVENT_TYPES.COMMENT_RESOLVED: return 'event-comment';
        default: return 'event-save';
    }
}

/**
 * Generate diff preview HTML for a patch
 */
function generatePatchDiffPreview(patch, allPatches) {
    if (!patch || !patch.data?.snapshot) {
        return '<div class="patch-preview-empty">No preview available</div>';
    }

    // Find the previous Save patch to compare against
    const sortedPatches = allPatches
        .filter(p => p.kind === "Save" && p.data?.snapshot && p.timestamp < patch.timestamp)
        .sort((a, b) => b.timestamp - a.timestamp);

    const previousPatch = sortedPatches[0];
    const oldText = previousPatch?.data?.snapshot || '';
    const newText = patch.data.snapshot;

    // Calculate diff
    const diffOps = calculateCharDiff(oldText, newText);

    // Limit preview size
    const maxPreviewLength = 500;
    let totalLength = 0;
    let truncated = false;

    let html = '<div class="patch-preview-diff">';

    for (const op of diffOps) {
        if (totalLength >= maxPreviewLength) {
            truncated = true;
            break;
        }

        let text = op.text;
        if (totalLength + text.length > maxPreviewLength) {
            text = text.substring(0, maxPreviewLength - totalLength);
            truncated = true;
        }

        const escaped = escapeHtml(text).replace(/\n/g, '↵<br>');

        if (op.type === 'delete') {
            html += `<span class="diff-delete">${escaped}</span>`;
        } else if (op.type === 'add') {
            html += `<span class="diff-add">${escaped}</span>`;
        } else {
            html += `<span class="diff-equal">${escaped}</span>`;
        }

        totalLength += text.length;
    }

    if (truncated) {
        html += '<span class="diff-truncated">...</span>';
    }

    html += '</div>';

    return html;
}

/**
 * Render entry HTML for accept/reject events
 */
function renderAcceptRejectEntry(entry, time) {
    const details = entry.details || {};
    const action = entry.type === EVENT_TYPES.ACCEPT ? 'accepted' : 'rejected';
    const actionClass = entry.type === EVENT_TYPES.ACCEPT ? 'action-accepted' : 'action-rejected';
    const icon = entry.type === EVENT_TYPES.ACCEPT ? '✓' : '✗';
    const eventClass = getEventClass(entry.type);

    return `
        <div class="log-entry ${eventClass}">
            <div class="log-entry-icon">${icon}</div>
            <div class="log-entry-content">
                <div class="log-entry-header">
                    <span class="log-entry-time">${time}</span>
                </div>
                <div class="log-entry-description">
                    <span class="log-author-name">${escapeHtml(entry.author)}</span>
                    <span class="${actionClass}">${action}</span>
                    <span class="patch-link" data-patch-id="${details.patchId}">patch #${details.patchId}</span>
                    <span>from</span>
                    <span class="log-patch-author" style="color: ${details.patchAuthorColor || '#808080'}">${escapeHtml(details.patchAuthor || 'Unknown')}</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render entry HTML for other event types
 */
function renderGenericEntry(entry, time) {
    const icon = getEventIcon(entry.type);
    const eventClass = getEventClass(entry.type);
    const details = entry.details || {};

    let label = '';
    let extraDetails = '';

    switch (entry.type) {
        case EVENT_TYPES.SAVE:
            label = 'saved the document';
            if (details.snapshotLength) {
                extraDetails = `${Math.round(details.snapshotLength / 1024 * 10) / 10} KB`;
            }
            break;
        case EVENT_TYPES.EXPORT_MD:
            label = 'exported as Markdown';
            if (details.filename) extraDetails = details.filename;
            break;
        case EVENT_TYPES.EXPORT_DOCX:
            label = 'exported as DOCX';
            if (details.filename) extraDetails = details.filename;
            break;
        case EVENT_TYPES.IMPORT:
            label = 'imported patches';
            if (details.count) extraDetails = `${details.count} file(s)`;
            break;
        case EVENT_TYPES.RESTORE:
            label = `restored to patch #${details.patchId || '?'}`;
            break;
        case EVENT_TYPES.COMMENT:
            label = 'added a comment';
            if (details.content) extraDetails = `"${details.content}"`;
            break;
        case EVENT_TYPES.COMMENT_RESOLVED:
            label = 'resolved a comment';
            break;
        default:
            label = 'performed an action';
    }

    return `
        <div class="log-entry ${eventClass}">
            <div class="log-entry-icon">${icon}</div>
            <div class="log-entry-content">
                <div class="log-entry-header">
                    <span class="log-entry-time">${time}</span>
                </div>
                <div class="log-entry-description">
                    <span class="log-author-name" style="color: ${entry.authorColor}">${escapeHtml(entry.author)}</span>
                    <span>${label}</span>
                    ${extraDetails ? `<span class="log-extra-details">${escapeHtml(extraDetails)}</span>` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Render the log modal
 */
async function renderLogModal() {
    const entries = await getAllLogEntries();

    // Group entries by date
    const groupedByDate = new Map();
    for (const entry of entries) {
        const date = new Date(entry.timestamp).toLocaleDateString();
        if (!groupedByDate.has(date)) {
            groupedByDate.set(date, []);
        }
        groupedByDate.get(date).push(entry);
    }

    let html = '';

    for (const [date, dateEntries] of groupedByDate) {
        html += `<div class="log-date-group">
            <div class="log-date-header">${date}</div>
            <div class="log-entries">`;

        for (const entry of dateEntries) {
            const time = new Date(entry.timestamp).toLocaleTimeString();

            if (entry.type === EVENT_TYPES.ACCEPT || entry.type === EVENT_TYPES.REJECT) {
                html += renderAcceptRejectEntry(entry, time);
            } else {
                html += renderGenericEntry(entry, time);
            }
        }

        html += `</div></div>`;
    }

    if (entries.length === 0) {
        html = `<div class="log-empty">
            <div class="log-empty-icon">📋</div>
            <p>No events recorded yet</p>
            <p class="log-empty-hint">Events will appear here as you work on the document</p>
        </div>`;
    }

    return html;
}

/**
 * Setup hover previews for patch links
 */
function setupPatchHoverPreviews() {
    const modal = document.getElementById('document-log-modal');
    if (!modal) return;

    // Create tooltip element
    let tooltip = document.getElementById('patch-preview-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'patch-preview-tooltip';
        tooltip.className = 'patch-preview-tooltip';
        document.body.appendChild(tooltip);
    }

    // Get all patches as array for diff comparison
    const allPatches = Array.from(patchCache.values());

    // Add hover listeners to patch links
    modal.querySelectorAll('.patch-link').forEach(link => {
        link.addEventListener('mouseenter', (e) => {
            const patchId = parseInt(link.dataset.patchId);
            const patch = patchCache.get(patchId);

            if (!patch) {
                tooltip.innerHTML = '<div class="patch-preview-empty">Patch not found</div>';
            } else {
                const authorName = patch.data?.authorName || patch.author;
                const authorColor = patch.data?.authorColor || '#808080';
                const timestamp = new Date(patch.timestamp).toLocaleString();

                tooltip.innerHTML = `
                    <div class="patch-preview-header">
                        <span class="patch-preview-id">#${patch.id}</span>
                        <span class="patch-preview-author" style="background: ${authorColor}">${escapeHtml(authorName)}</span>
                    </div>
                    <div class="patch-preview-time">${timestamp}</div>
                    ${generatePatchDiffPreview(patch, allPatches)}
                `;
            }

            // Position tooltip
            const rect = link.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            // Position to the right of the link, or left if not enough space
            let left = rect.right + 10;
            if (left + 350 > window.innerWidth) {
                left = rect.left - 360;
            }

            // Keep in viewport vertically
            let top = rect.top;
            if (top + 300 > window.innerHeight) {
                top = window.innerHeight - 310;
            }
            if (top < 10) top = 10;

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.style.display = 'block';
        });

        link.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

/**
 * Show the document log modal
 */
export async function showDocumentLog() {
    // Remove existing modal if any
    let modal = document.getElementById('document-log-modal');
    if (modal) {
        modal.remove();
    }

    // Remove existing tooltip
    const existingTooltip = document.getElementById('patch-preview-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    // Create modal
    modal = document.createElement('div');
    modal.id = 'document-log-modal';
    modal.className = 'modal document-log-modal';
    modal.innerHTML = `
        <div class="modal-content document-log-content">
            <div class="modal-header">
                <h2>📋 Document History Log</h2>
                <button class="modal-close" id="log-modal-close">&times;</button>
            </div>
            <div class="modal-body document-log-body">
                <div class="log-loading">Loading history...</div>
            </div>
            <div class="modal-footer">
                <div class="log-legend">
                    <span class="legend-item"><span class="legend-icon">💾</span> Save</span>
                    <span class="legend-item"><span class="legend-icon">✓</span> Accept</span>
                    <span class="legend-item"><span class="legend-icon">✗</span> Reject</span>
                    <span class="legend-item"><span class="legend-icon">📥</span> Import</span>
                    <span class="legend-item"><span class="legend-icon">📝</span> Export</span>
                    <span class="legend-item"><span class="legend-icon">↺</span> Restore</span>
                    <span class="legend-item"><span class="legend-icon">💬</span> Comment</span>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'flex';

    // Wire up close button
    const closeModal = () => {
        modal.style.display = 'none';
        modal.remove();
        const tooltip = document.getElementById('patch-preview-tooltip');
        if (tooltip) tooltip.remove();
    };

    document.getElementById('log-modal-close').addEventListener('click', closeModal);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Close on Escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);

    // Load and render entries
    const logBody = modal.querySelector('.document-log-body');
    try {
        const html = await renderLogModal();
        logBody.innerHTML = html;

        // Setup hover previews after content is rendered
        setupPatchHoverPreviews();
    } catch (e) {
        console.error("Failed to load log:", e);
        logBody.innerHTML = `<div class="log-error">Failed to load history: ${e.message}</div>`;
    }
}

/**
 * Initialize the document log module
 */
export function initDocumentLog() {
    // Load persisted events for current document
    const docId = getActiveDocumentId();
    if (docId) {
        const persisted = loadPersistedEvents(docId);
        if (persisted.length > 0) {
            documentEvents.set(docId, persisted);
        }
    }
}

// Export event types for use by other modules
export { EVENT_TYPES };
