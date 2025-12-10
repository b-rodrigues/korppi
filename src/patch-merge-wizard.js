// src/patch-merge-wizard.js
// Three-way patch merge wizard UI

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { fetchPatchList, hasSnapshotContent, refreshTimeline } from "./timeline.js";
import { mergeWithConflicts, parseConflicts, resolveConflict, hasUnresolvedConflicts, countConflicts } from "./patch-merge.js";
import { setMarkdownContent, getMarkdown } from "./editor.js";
import { getCachedProfile, getCurrentUserInfo } from "./profile-service.js";

let wizardState = {
    isOpen: false,
    step: 1, // 1: select patches, 2: review/edit merge, 3: confirm
    patchA: null,
    patchB: null,
    baseSnapshot: null,
    mergedContent: '',
    hasConflicts: false,
    conflictCount: 0
};

/**
 * Open the patch merge wizard
 */
export function openPatchMergeWizard() {
    wizardState = {
        isOpen: true,
        step: 1,
        patchA: null,
        patchB: null,
        baseSnapshot: null,
        mergedContent: '',
        hasConflicts: false,
        conflictCount: 0
    };

    showWizard();
}

/**
 * Close the patch merge wizard
 */
export function closePatchMergeWizard() {
    wizardState.isOpen = false;
    hideWizard();
}

/**
 * Show the wizard modal
 */
async function showWizard() {
    let modal = document.getElementById('patch-merge-wizard-modal');

    if (!modal) {
        modal = createWizardModal();
        document.body.appendChild(modal);
    }

    modal.style.display = 'block';
    await renderWizardContent();
}

/**
 * Hide the wizard modal
 */
function hideWizard() {
    const modal = document.getElementById('patch-merge-wizard-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Create the wizard modal element
 */
function createWizardModal() {
    const modal = document.createElement('div');
    modal.id = 'patch-merge-wizard-modal';
    modal.className = 'modal patch-merge-wizard-modal';

    modal.innerHTML = `
        <div class="modal-content patch-merge-wizard-content">
            <div class="modal-header patch-merge-wizard-header">
                <h2>Merge Patches</h2>
                <span class="wizard-step-indicator">Step <span id="wizard-step-num">1</span> of 3</span>
                <span class="modal-close">&times;</span>
            </div>
            <div class="modal-body patch-merge-wizard-body" id="patch-merge-wizard-body">
                <!-- Content rendered dynamically -->
            </div>
            <div class="modal-footer patch-merge-wizard-footer" id="patch-merge-wizard-footer">
                <!-- Buttons rendered dynamically -->
            </div>
        </div>
    `;

    // Close handlers
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.addEventListener('click', closePatchMergeWizard);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closePatchMergeWizard();
        }
    });

    return modal;
}

/**
 * Render wizard content based on current step
 */
async function renderWizardContent() {
    const body = document.getElementById('patch-merge-wizard-body');
    const footer = document.getElementById('patch-merge-wizard-footer');
    const stepNum = document.getElementById('wizard-step-num');

    if (!body || !footer) return;

    stepNum.textContent = wizardState.step;

    switch (wizardState.step) {
        case 1:
            await renderStep1(body, footer);
            break;
        case 2:
            await renderStep2(body, footer);
            break;
        case 3:
            await renderStep3(body, footer);
            break;
    }
}

/**
 * Step 1: Select two patches to merge
 */
async function renderStep1(body, footer) {
    const patches = await fetchPatchList();

    // Filter to only Save patches with snapshots, from different authors
    const savePatches = patches
        .filter(p => p.kind === 'Save' && hasSnapshotContent(p))
        .sort((a, b) => b.timestamp - a.timestamp);

    // Get unique authors
    const authorMap = new Map();
    savePatches.forEach(p => {
        if (!authorMap.has(p.author)) {
            authorMap.set(p.author, p.data?.authorName || p.author);
        }
    });

    // Find base snapshot (earliest patch)
    const sortedByTime = [...savePatches].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedByTime.length > 0) {
        wizardState.baseSnapshot = sortedByTime[0].data.snapshot;
    }

    body.innerHTML = `
        <div class="wizard-step-content">
            <p class="wizard-description">
                Select two patches to merge. The wizard will combine them and show
                any conflicts that need to be resolved.
            </p>

            <div class="patch-selection-grid">
                <div class="patch-selection-column">
                    <h3>First Patch</h3>
                    <div class="patch-selection-list" id="patch-list-a">
                        ${savePatches.map(p => `
                            <div class="patch-selection-item ${wizardState.patchA?.id === p.id ? 'selected' : ''}"
                                 data-patch-id="${p.id}" data-list="a">
                                <div class="patch-selection-info">
                                    <strong>#${p.id}</strong>
                                    <span class="author-badge" style="background-color:${p.data?.authorColor || '#808080'}">
                                        ${p.data?.authorName || p.author}
                                    </span>
                                </div>
                                <div class="patch-selection-time">
                                    ${new Date(p.timestamp).toLocaleString()}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="patch-selection-column">
                    <h3>Second Patch</h3>
                    <div class="patch-selection-list" id="patch-list-b">
                        ${savePatches.map(p => `
                            <div class="patch-selection-item ${wizardState.patchB?.id === p.id ? 'selected' : ''}"
                                 data-patch-id="${p.id}" data-list="b">
                                <div class="patch-selection-info">
                                    <strong>#${p.id}</strong>
                                    <span class="author-badge" style="background-color:${p.data?.authorColor || '#808080'}">
                                        ${p.data?.authorName || p.author}
                                    </span>
                                </div>
                                <div class="patch-selection-time">
                                    ${new Date(p.timestamp).toLocaleString()}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            ${wizardState.patchA && wizardState.patchB ? `
                <div class="selection-summary">
                    <strong>Selected:</strong>
                    Patch #${wizardState.patchA.id} (${wizardState.patchA.data?.authorName || wizardState.patchA.author})
                    + Patch #${wizardState.patchB.id} (${wizardState.patchB.data?.authorName || wizardState.patchB.author})
                </div>
            ` : ''}
        </div>
    `;

    // Add click handlers for patch selection
    body.querySelectorAll('.patch-selection-item').forEach(item => {
        item.addEventListener('click', async () => {
            const patchId = parseInt(item.dataset.patchId);
            const list = item.dataset.list;
            const patch = savePatches.find(p => p.id === patchId);

            if (list === 'a') {
                wizardState.patchA = patch;
                body.querySelectorAll('#patch-list-a .patch-selection-item').forEach(el => {
                    el.classList.toggle('selected', el.dataset.patchId === String(patchId));
                });
            } else {
                wizardState.patchB = patch;
                body.querySelectorAll('#patch-list-b .patch-selection-item').forEach(el => {
                    el.classList.toggle('selected', el.dataset.patchId === String(patchId));
                });
            }

            // Update summary and buttons
            await renderWizardContent();
        });
    });

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-cancel-btn">Cancel</button>
        <button class="btn-primary" id="wizard-next-btn" ${!wizardState.patchA || !wizardState.patchB ? 'disabled' : ''}>
            Next: Preview Merge
        </button>
    `;

    footer.querySelector('#wizard-cancel-btn').addEventListener('click', closePatchMergeWizard);
    footer.querySelector('#wizard-next-btn').addEventListener('click', async () => {
        if (wizardState.patchA && wizardState.patchB) {
            await performMerge();
            wizardState.step = 2;
            await renderWizardContent();
        }
    });
}

/**
 * Perform the three-way merge
 */
async function performMerge() {
    const base = wizardState.baseSnapshot || '';
    const contentA = wizardState.patchA.data?.snapshot || '';
    const contentB = wizardState.patchB.data?.snapshot || '';

    const labelA = wizardState.patchA.data?.authorName || `Patch #${wizardState.patchA.id}`;
    const labelB = wizardState.patchB.data?.authorName || `Patch #${wizardState.patchB.id}`;

    const result = mergeWithConflicts(base, contentA, contentB, labelA, labelB);

    wizardState.mergedContent = result.merged;
    wizardState.hasConflicts = result.hasConflicts;
    wizardState.conflictCount = result.conflictCount;
}

/**
 * Step 2: Review and edit the merged content
 */
async function renderStep2(body, footer) {
    const conflicts = parseConflicts(wizardState.mergedContent);
    const currentConflictCount = countConflicts(wizardState.mergedContent);

    body.innerHTML = `
        <div class="wizard-step-content merge-editor-step">
            <div class="merge-status-bar">
                ${currentConflictCount > 0 ? `
                    <span class="conflict-indicator-text">
                        <span class="conflict-icon">&#9888;</span>
                        ${currentConflictCount} conflict${currentConflictCount !== 1 ? 's' : ''} remaining
                    </span>
                    <span class="conflict-help">
                        Look for <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> markers and resolve manually
                    </span>
                ` : `
                    <span class="no-conflict-indicator">
                        <span class="success-icon">&#10003;</span>
                        No conflicts - merge is clean!
                    </span>
                `}
            </div>

            <div class="merge-editor-container">
                <div class="merge-editor-toolbar">
                    <span class="toolbar-label">Merged Result:</span>
                    ${conflicts.length > 0 ? `
                        <div class="quick-resolve-buttons">
                            <button class="resolve-all-btn" data-resolution="A">
                                Accept All from ${wizardState.patchA.data?.authorName || 'Patch A'}
                            </button>
                            <button class="resolve-all-btn" data-resolution="B">
                                Accept All from ${wizardState.patchB.data?.authorName || 'Patch B'}
                            </button>
                        </div>
                    ` : ''}
                </div>
                <textarea id="merge-editor" class="merge-editor-textarea">${escapeHtml(wizardState.mergedContent)}</textarea>
            </div>

            ${conflicts.length > 0 ? `
                <div class="conflict-navigator">
                    <h4>Conflicts</h4>
                    <div class="conflict-list">
                        ${conflicts.map((c, idx) => `
                            <div class="conflict-nav-item" data-conflict-idx="${idx}">
                                <span class="conflict-num">#${idx + 1}</span>
                                <div class="conflict-preview">
                                    <div class="conflict-side side-a">
                                        <span class="side-label">${c.labelA || 'A'}:</span>
                                        <span class="side-content">${escapeHtml(c.contentA.slice(0, 2).join(' ').substring(0, 40))}${c.contentA.join('').length > 40 ? '...' : ''}</span>
                                    </div>
                                    <div class="conflict-side side-b">
                                        <span class="side-label">${c.labelB || 'B'}:</span>
                                        <span class="side-content">${escapeHtml(c.contentB.slice(0, 2).join(' ').substring(0, 40))}${c.contentB.join('').length > 40 ? '...' : ''}</span>
                                    </div>
                                </div>
                                <div class="conflict-actions">
                                    <button class="conflict-resolve-btn" data-idx="${idx}" data-resolution="A">Use ${c.labelA || 'A'}</button>
                                    <button class="conflict-resolve-btn" data-idx="${idx}" data-resolution="B">Use ${c.labelB || 'B'}</button>
                                    <button class="conflict-resolve-btn" data-idx="${idx}" data-resolution="both">Keep Both</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;

    // Bind editor changes
    const editor = body.querySelector('#merge-editor');
    editor.addEventListener('input', () => {
        wizardState.mergedContent = editor.value;
        updateConflictStatus();
    });

    // Bind conflict resolution buttons
    body.querySelectorAll('.conflict-resolve-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            const resolution = btn.dataset.resolution;
            wizardState.mergedContent = resolveConflict(wizardState.mergedContent, idx, resolution);
            renderWizardContent();
        });
    });

    // Bind "resolve all" buttons
    body.querySelectorAll('.resolve-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const resolution = btn.dataset.resolution;
            // Resolve all conflicts with the same resolution
            while (hasUnresolvedConflicts(wizardState.mergedContent)) {
                wizardState.mergedContent = resolveConflict(wizardState.mergedContent, 0, resolution);
            }
            renderWizardContent();
        });
    });

    // Bind conflict navigator clicks to scroll to conflict
    body.querySelectorAll('.conflict-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.conflict-actions')) return;

            const idx = parseInt(item.dataset.conflictIdx);
            scrollToConflict(editor, idx);
        });
    });

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-back-btn">Back</button>
        <button class="btn-primary" id="wizard-next-btn" ${hasUnresolvedConflicts(wizardState.mergedContent) ? 'disabled' : ''}>
            ${hasUnresolvedConflicts(wizardState.mergedContent) ? 'Resolve Conflicts First' : 'Next: Apply Merge'}
        </button>
    `;

    footer.querySelector('#wizard-back-btn').addEventListener('click', async () => {
        wizardState.step = 1;
        await renderWizardContent();
    });

    footer.querySelector('#wizard-next-btn').addEventListener('click', async () => {
        if (!hasUnresolvedConflicts(wizardState.mergedContent)) {
            wizardState.step = 3;
            await renderWizardContent();
        }
    });
}

/**
 * Update the conflict status indicator
 */
function updateConflictStatus() {
    const statusBar = document.querySelector('.merge-status-bar');
    if (!statusBar) return;

    const currentConflictCount = countConflicts(wizardState.mergedContent);

    if (currentConflictCount > 0) {
        statusBar.innerHTML = `
            <span class="conflict-indicator-text">
                <span class="conflict-icon">&#9888;</span>
                ${currentConflictCount} conflict${currentConflictCount !== 1 ? 's' : ''} remaining
            </span>
            <span class="conflict-help">
                Look for <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> markers and resolve manually
            </span>
        `;
    } else {
        statusBar.innerHTML = `
            <span class="no-conflict-indicator">
                <span class="success-icon">&#10003;</span>
                No conflicts - merge is clean!
            </span>
        `;
    }

    // Update next button state
    const nextBtn = document.getElementById('wizard-next-btn');
    if (nextBtn) {
        nextBtn.disabled = currentConflictCount > 0;
        nextBtn.textContent = currentConflictCount > 0 ? 'Resolve Conflicts First' : 'Next: Apply Merge';
    }
}

/**
 * Scroll to a specific conflict in the editor
 */
function scrollToConflict(editor, conflictIndex) {
    const text = editor.value;
    const lines = text.split('\n');
    let conflictCount = 0;
    let charOffset = 0;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('<<<<<<<')) {
            if (conflictCount === conflictIndex) {
                editor.focus();
                editor.setSelectionRange(charOffset, charOffset);
                // Scroll to position
                const lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 20;
                editor.scrollTop = Math.max(0, i * lineHeight - 100);
                return;
            }
            conflictCount++;
        }
        charOffset += lines[i].length + 1; // +1 for newline
    }
}

/**
 * Step 3: Confirm and apply the merge
 */
async function renderStep3(body, footer) {
    body.innerHTML = `
        <div class="wizard-step-content confirm-step">
            <div class="confirm-icon">&#10003;</div>
            <h3>Ready to Apply Merge</h3>
            <p class="confirm-description">
                The merged content is ready to be applied. This will:
            </p>
            <ul class="confirm-list">
                <li>Replace the current document content with the merged result</li>
                <li>Create a new patch that combines changes from both:
                    <ul>
                        <li><strong>${wizardState.patchA.data?.authorName || 'Patch A'}</strong> (Patch #${wizardState.patchA.id})</li>
                        <li><strong>${wizardState.patchB.data?.authorName || 'Patch B'}</strong> (Patch #${wizardState.patchB.id})</li>
                    </ul>
                </li>
            </ul>

            <div class="confirm-preview">
                <h4>Preview of merged content:</h4>
                <pre class="confirm-preview-content">${escapeHtml(wizardState.mergedContent.substring(0, 500))}${wizardState.mergedContent.length > 500 ? '\n...' : ''}</pre>
            </div>
        </div>
    `;

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-back-btn">Back to Edit</button>
        <button class="btn-primary" id="wizard-apply-btn">Apply Merge</button>
    `;

    footer.querySelector('#wizard-back-btn').addEventListener('click', async () => {
        wizardState.step = 2;
        await renderWizardContent();
    });

    footer.querySelector('#wizard-apply-btn').addEventListener('click', async () => {
        await applyMerge();
    });
}

/**
 * Apply the merged content to the document
 */
async function applyMerge() {
    try {
        // Apply the merged content to the editor
        const success = setMarkdownContent(wizardState.mergedContent);

        if (!success) {
            alert('Failed to apply merged content to the editor.');
            return;
        }

        // Close the wizard
        closePatchMergeWizard();

        // Refresh the timeline
        await refreshTimeline();

        // Show success message
        const message = `Merge applied successfully!\n\nCombined patches from:\n- ${wizardState.patchA.data?.authorName || 'Patch A'} (#${wizardState.patchA.id})\n- ${wizardState.patchB.data?.authorName || 'Patch B'} (#${wizardState.patchB.id})`;
        alert(message);

    } catch (err) {
        console.error('Failed to apply merge:', err);
        alert(`Error applying merge: ${err.message || err}`);
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Initialize the patch merge wizard (add button to UI)
 */
export function initPatchMergeWizard() {
    // Add the CSS styles
    addWizardStyles();

    // The merge button will be added to the timeline by the timeline.js integration
}

/**
 * Add CSS styles for the wizard
 */
function addWizardStyles() {
    if (document.getElementById('patch-merge-wizard-styles')) return;

    const style = document.createElement('style');
    style.id = 'patch-merge-wizard-styles';
    style.textContent = `
        /* Patch Merge Wizard Modal */
        .patch-merge-wizard-modal {
            z-index: 1100;
        }

        .patch-merge-wizard-content {
            max-width: 900px;
            width: 95%;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
        }

        .patch-merge-wizard-header {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .patch-merge-wizard-header h2 {
            flex: 1;
        }

        .wizard-step-indicator {
            font-size: 12px;
            color: var(--text-muted);
            background: var(--bg-panel);
            padding: 4px 12px;
            border-radius: 12px;
        }

        .patch-merge-wizard-body {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }

        .patch-merge-wizard-footer {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            padding: 16px 20px;
            border-top: 1px solid var(--border-color);
        }

        /* Step 1: Patch Selection */
        .wizard-description {
            color: var(--text-secondary);
            margin-bottom: 20px;
            line-height: 1.5;
        }

        .patch-selection-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .patch-selection-column h3 {
            font-size: 14px;
            margin-bottom: 12px;
            color: var(--text-primary);
        }

        .patch-selection-list {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-panel);
        }

        .patch-selection-item {
            padding: 12px;
            border-bottom: 1px solid var(--border-light);
            cursor: pointer;
            transition: background 0.1s;
        }

        .patch-selection-item:last-child {
            border-bottom: none;
        }

        .patch-selection-item:hover {
            background: var(--btn-bg-hover);
        }

        .patch-selection-item.selected {
            background: var(--accent-bg);
            border-left: 3px solid var(--accent);
        }

        .patch-selection-info {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }

        .patch-selection-time {
            font-size: 11px;
            color: var(--text-muted);
        }

        .selection-summary {
            padding: 12px;
            background: var(--accent-bg);
            border-radius: 6px;
            border: 1px solid var(--accent);
            font-size: 13px;
        }

        /* Step 2: Merge Editor */
        .merge-editor-step {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .merge-status-bar {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 16px;
            background: var(--bg-panel);
            border-radius: 6px;
            border: 1px solid var(--border-color);
        }

        .conflict-indicator-text {
            color: #f44336;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .conflict-icon {
            font-size: 18px;
        }

        .conflict-help {
            font-size: 12px;
            color: var(--text-muted);
        }

        .conflict-help code {
            background: var(--bg-sidebar);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
        }

        .no-conflict-indicator {
            color: #4caf50;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .success-icon {
            font-size: 18px;
        }

        .merge-editor-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .merge-editor-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: var(--bg-sidebar);
            border: 1px solid var(--border-color);
            border-bottom: none;
            border-radius: 6px 6px 0 0;
        }

        .toolbar-label {
            font-weight: 600;
            font-size: 12px;
        }

        .quick-resolve-buttons {
            display: flex;
            gap: 8px;
        }

        .resolve-all-btn {
            padding: 4px 10px;
            font-size: 11px;
            background: var(--btn-bg);
            border: 1px solid var(--btn-border);
            border-radius: 4px;
            cursor: pointer;
        }

        .resolve-all-btn:hover {
            background: var(--btn-bg-hover);
        }

        .merge-editor-textarea {
            flex: 1;
            min-height: 250px;
            padding: 16px;
            font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
            font-size: 13px;
            line-height: 1.5;
            background: var(--bg-page);
            border: 1px solid var(--border-color);
            border-radius: 0 0 6px 6px;
            color: var(--text-primary);
            resize: vertical;
        }

        .merge-editor-textarea:focus {
            outline: none;
            border-color: var(--accent);
        }

        /* Conflict Navigator */
        .conflict-navigator {
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-panel);
        }

        .conflict-navigator h4 {
            padding: 10px 16px;
            margin: 0;
            font-size: 13px;
            border-bottom: 1px solid var(--border-light);
            background: var(--bg-sidebar);
            border-radius: 6px 6px 0 0;
        }

        .conflict-list {
            max-height: 200px;
            overflow-y: auto;
        }

        .conflict-nav-item {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-light);
            cursor: pointer;
            transition: background 0.1s;
        }

        .conflict-nav-item:last-child {
            border-bottom: none;
        }

        .conflict-nav-item:hover {
            background: var(--btn-bg-hover);
        }

        .conflict-num {
            font-weight: 600;
            color: #f44336;
            margin-right: 12px;
        }

        .conflict-preview {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 8px 0;
            font-size: 12px;
        }

        .conflict-side {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }

        .side-label {
            font-weight: 600;
            min-width: 80px;
            color: var(--text-secondary);
        }

        .side-content {
            color: var(--text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .side-a .side-label {
            color: #4fc3f7;
        }

        .side-b .side-label {
            color: #ff9800;
        }

        .conflict-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }

        .conflict-resolve-btn {
            padding: 4px 10px;
            font-size: 11px;
            background: var(--btn-bg);
            border: 1px solid var(--btn-border);
            border-radius: 4px;
            cursor: pointer;
        }

        .conflict-resolve-btn:hover {
            background: var(--accent);
            color: #000;
            border-color: var(--accent);
        }

        /* Step 3: Confirmation */
        .confirm-step {
            text-align: center;
            padding: 20px;
        }

        .confirm-icon {
            font-size: 48px;
            color: #4caf50;
            margin-bottom: 16px;
        }

        .confirm-step h3 {
            font-size: 20px;
            margin-bottom: 12px;
        }

        .confirm-description {
            color: var(--text-secondary);
            margin-bottom: 16px;
        }

        .confirm-list {
            text-align: left;
            max-width: 500px;
            margin: 0 auto 20px;
            color: var(--text-secondary);
        }

        .confirm-list li {
            margin-bottom: 8px;
        }

        .confirm-list ul {
            margin-top: 8px;
        }

        .confirm-preview {
            text-align: left;
            background: var(--bg-panel);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 16px;
            margin-top: 20px;
        }

        .confirm-preview h4 {
            font-size: 13px;
            margin-bottom: 12px;
            color: var(--text-secondary);
        }

        .confirm-preview-content {
            background: var(--bg-sidebar);
            padding: 12px;
            border-radius: 4px;
            font-family: "SF Mono", Monaco, monospace;
            font-size: 12px;
            max-height: 200px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        /* Merge Patches Button (added to timeline) */
        .merge-patches-btn {
            width: 100%;
            padding: 10px;
            margin-top: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.1s, transform 0.05s;
        }

        .merge-patches-btn:hover {
            opacity: 0.9;
        }

        .merge-patches-btn:active {
            transform: scale(0.98);
        }

        /* Responsive */
        @media (max-width: 768px) {
            .patch-selection-grid {
                grid-template-columns: 1fr;
            }

            .patch-merge-wizard-content {
                max-height: 95vh;
            }
        }
    `;

    document.head.appendChild(style);
}
