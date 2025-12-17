// src/document-log.js
// Full document history log viewer - shows all events in chronological order

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { getCachedProfile } from "./profile-service.js";
import { escapeHtml } from "./utils.js";

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

    // 1. Get all patches
    try {
        const patches = await invoke("list_document_patches", { id: docId });
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
        const currentUser = getCachedProfile();
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
                                    patchAuthor: patch.data?.authorName || patch.author,
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
 * Get label for event type
 */
function getEventLabel(type) {
    switch (type) {
        case EVENT_TYPES.SAVE: return 'Document Saved';
        case EVENT_TYPES.EXPORT_MD: return 'Exported as Markdown';
        case EVENT_TYPES.EXPORT_DOCX: return 'Exported as DOCX';
        case EVENT_TYPES.IMPORT: return 'Patches Imported';
        case EVENT_TYPES.ACCEPT: return 'Patch Accepted';
        case EVENT_TYPES.REJECT: return 'Patch Rejected';
        case EVENT_TYPES.RESTORE: return 'Restored to Version';
        case EVENT_TYPES.COMMENT: return 'Comment Added';
        case EVENT_TYPES.COMMENT_RESOLVED: return 'Comment Resolved';
        default: return 'Event';
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
 * Format event details for display
 */
function formatEventDetails(entry) {
    const details = entry.details || {};

    switch (entry.type) {
        case EVENT_TYPES.SAVE:
            return details.snapshotLength
                ? `${Math.round(details.snapshotLength / 1024 * 10) / 10} KB saved`
                : '';
        case EVENT_TYPES.EXPORT_MD:
        case EVENT_TYPES.EXPORT_DOCX:
            return details.filename ? `File: ${details.filename}` : '';
        case EVENT_TYPES.IMPORT:
            return details.count ? `${details.count} patch(es) imported` : '';
        case EVENT_TYPES.ACCEPT:
        case EVENT_TYPES.REJECT:
            return details.patchAuthor ? `Patch by ${details.patchAuthor}` : '';
        case EVENT_TYPES.RESTORE:
            return details.patchId ? `Restored to patch #${details.patchId}` : '';
        case EVENT_TYPES.COMMENT:
        case EVENT_TYPES.COMMENT_RESOLVED:
            return details.content || '';
        default:
            return '';
    }
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
            const icon = getEventIcon(entry.type);
            const label = getEventLabel(entry.type);
            const eventClass = getEventClass(entry.type);
            const details = formatEventDetails(entry);

            html += `
                <div class="log-entry ${eventClass}">
                    <div class="log-entry-icon">${icon}</div>
                    <div class="log-entry-content">
                        <div class="log-entry-header">
                            <span class="log-entry-label">${label}</span>
                            <span class="log-entry-time">${time}</span>
                        </div>
                        <div class="log-entry-author" style="color: ${entry.authorColor}">
                            ${escapeHtml(entry.author)}
                        </div>
                        ${details ? `<div class="log-entry-details">${escapeHtml(details)}</div>` : ''}
                    </div>
                </div>
            `;
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
 * Show the document log modal
 */
export async function showDocumentLog() {
    // Remove existing modal if any
    let modal = document.getElementById('document-log-modal');
    if (modal) {
        modal.remove();
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
    document.getElementById('log-modal-close').addEventListener('click', () => {
        modal.style.display = 'none';
        modal.remove();
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modal.remove();
        }
    });

    // Close on Escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            modal.style.display = 'none';
            modal.remove();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);

    // Load and render entries
    const logBody = modal.querySelector('.document-log-body');
    try {
        const html = await renderLogModal();
        logBody.innerHTML = html;
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
