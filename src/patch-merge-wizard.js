// src/patch-merge-wizard.js
// Three-way patch merge wizard UI with conflict group support

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { fetchPatchList, hasSnapshotContent, refreshTimeline } from "./timeline.js";
import { detectPatchConflicts } from "./conflict-detection.js";
import { mergeWithConflicts, parseConflicts, resolveConflict, hasUnresolvedConflicts, countConflicts } from "./patch-merge.js";
import { setMarkdownContent, getMarkdown } from "./editor.js";
import { getCachedProfile, getCurrentUserInfo } from "./profile-service.js";

let wizardState = {
    isOpen: false,
    step: 1, // 1: select patches/group, 2: review/edit merge, 3: confirm (or next patch)
    mode: 'manual', // 'manual' or 'group'

    // For manual mode (2 patches)
    patchA: null,
    patchB: null,

    // For group mode (N patches)
    conflictGroup: null, // Array of patch objects in the group
    patchQueue: [], // Remaining patches to merge
    currentPatchIndex: 0, // Which patch we're currently merging (0 = first two, 1 = result + third, etc.)

    // Common state
    baseSnapshot: null,
    currentBase: '', // Current base for merging (starts as baseSnapshot, then becomes merged result)
    currentPatch: null, // Current patch being merged into base
    mergedContent: '',
    hasConflicts: false,
    conflictCount: 0,

    // All patches for reference
    allPatches: [],
    allConflictGroups: []
};

/**
 * Open the patch merge wizard
 */
export function openPatchMergeWizard() {
    wizardState = {
        isOpen: true,
        step: 1,
        mode: 'manual',
        patchA: null,
        patchB: null,
        conflictGroup: null,
        patchQueue: [],
        currentPatchIndex: 0,
        baseSnapshot: null,
        currentBase: '',
        currentPatch: null,
        mergedContent: '',
        hasConflicts: false,
        conflictCount: 0,
        allPatches: [],
        allConflictGroups: []
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
                <span class="wizard-step-indicator" id="wizard-step-indicator">Step 1</span>
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
    const stepIndicator = document.getElementById('wizard-step-indicator');

    if (!body || !footer) return;

    // Update step indicator
    if (wizardState.mode === 'group' && wizardState.conflictGroup) {
        const total = wizardState.conflictGroup.length - 1; // Number of merges needed
        const current = wizardState.currentPatchIndex + 1;
        stepIndicator.textContent = `Merge ${current} of ${total}`;
    } else {
        stepIndicator.textContent = `Step ${wizardState.step}`;
    }

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
 * Step 1: Select conflict group or individual patches
 */
async function renderStep1(body, footer) {
    const patches = await fetchPatchList();
    wizardState.allPatches = patches;

    // Filter to only Save patches with snapshots
    const savePatches = patches
        .filter(p => p.kind === 'Save' && hasSnapshotContent(p))
        .sort((a, b) => b.timestamp - a.timestamp);

    // Detect conflict groups
    const { conflictGroups } = detectPatchConflicts(patches);
    wizardState.allConflictGroups = conflictGroups;

    // Build conflict group info with patch details
    const conflictGroupsWithDetails = conflictGroups.map(group => {
        const groupPatches = group.map(id => savePatches.find(p => p.id === id)).filter(Boolean);
        const authors = [...new Set(groupPatches.map(p => p.data?.authorName || p.author))];
        return {
            ids: group,
            patches: groupPatches,
            authors,
            size: groupPatches.length
        };
    }).filter(g => g.size >= 2);

    // Find base snapshot (earliest patch)
    const sortedByTime = [...savePatches].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedByTime.length > 0) {
        wizardState.baseSnapshot = sortedByTime[0].data.snapshot;
    }

    body.innerHTML = `
        <div class="wizard-step-content">
            <p class="wizard-description">
                Select a conflict group to merge all related patches, or manually select individual patches.
            </p>

            ${conflictGroupsWithDetails.length > 0 ? `
                <div class="conflict-groups-section">
                    <h3>Conflict Groups</h3>
                    <p class="section-hint">These patches have overlapping changes and should be merged together.</p>
                    <div class="conflict-group-list">
                        ${conflictGroupsWithDetails.map((group, idx) => `
                            <div class="conflict-group-item ${wizardState.conflictGroup === group.patches ? 'selected' : ''}"
                                 data-group-idx="${idx}">
                                <div class="group-header">
                                    <span class="group-icon">⚠️</span>
                                    <span class="group-title">${group.size} conflicting patches</span>
                                    <span class="group-badge">${group.size - 1} merge${group.size > 2 ? 's' : ''} needed</span>
                                </div>
                                <div class="group-authors">
                                    Authors: ${group.authors.join(', ')}
                                </div>
                                <div class="group-patches">
                                    ${group.patches.map(p => `
                                        <span class="mini-patch-badge" style="border-left-color: ${p.data?.authorColor || '#808080'}">
                                            #${p.id} ${p.data?.authorName || p.author}
                                        </span>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : `
                <div class="no-conflicts-notice">
                    <span class="success-icon">✓</span>
                    No conflict groups detected. You can manually select patches to merge below.
                </div>
            `}

            <div class="manual-selection-section">
                <h3>Manual Selection</h3>
                <p class="section-hint">Or select two specific patches to merge.</p>

                <div class="patch-selection-grid">
                    <div class="patch-selection-column">
                        <h4>First Patch</h4>
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
                        <h4>Second Patch</h4>
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
            </div>

            ${getSelectionSummary()}
        </div>
    `;

    // Add click handlers for conflict groups
    body.querySelectorAll('.conflict-group-item').forEach(item => {
        item.addEventListener('click', () => {
            const groupIdx = parseInt(item.dataset.groupIdx);
            const group = conflictGroupsWithDetails[groupIdx];

            // Clear manual selection
            wizardState.patchA = null;
            wizardState.patchB = null;
            wizardState.mode = 'group';
            wizardState.conflictGroup = group.patches;

            // Update UI
            body.querySelectorAll('.conflict-group-item').forEach(el => {
                el.classList.toggle('selected', el === item);
            });
            body.querySelectorAll('.patch-selection-item').forEach(el => {
                el.classList.remove('selected');
            });

            updateSelectionSummary();
            updateNextButton();
        });
    });

    // Add click handlers for manual patch selection
    body.querySelectorAll('.patch-selection-item').forEach(item => {
        item.addEventListener('click', () => {
            const patchId = parseInt(item.dataset.patchId);
            const list = item.dataset.list;
            const patch = savePatches.find(p => p.id === patchId);

            // Clear conflict group selection
            wizardState.conflictGroup = null;
            wizardState.mode = 'manual';
            body.querySelectorAll('.conflict-group-item').forEach(el => {
                el.classList.remove('selected');
            });

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

            updateSelectionSummary();
            updateNextButton();
        });
    });

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-cancel-btn">Cancel</button>
        <button class="btn-primary" id="wizard-next-btn" disabled>
            Next: Preview Merge
        </button>
    `;

    footer.querySelector('#wizard-cancel-btn').addEventListener('click', closePatchMergeWizard);
    footer.querySelector('#wizard-next-btn').addEventListener('click', async () => {
        await startMerging();
    });

    updateNextButton();
}

/**
 * Get selection summary HTML
 */
function getSelectionSummary() {
    if (wizardState.conflictGroup && wizardState.conflictGroup.length >= 2) {
        const patches = wizardState.conflictGroup;
        return `
            <div class="selection-summary group-summary">
                <strong>Selected Conflict Group:</strong>
                ${patches.length} patches to merge sequentially
                <div class="merge-sequence">
                    ${patches.map((p, idx) => `
                        <span class="sequence-patch" style="border-color: ${p.data?.authorColor || '#808080'}">
                            #${p.id}
                        </span>
                        ${idx < patches.length - 1 ? '<span class="sequence-arrow">→</span>' : ''}
                    `).join('')}
                </div>
            </div>
        `;
    } else if (wizardState.patchA && wizardState.patchB) {
        return `
            <div class="selection-summary">
                <strong>Selected:</strong>
                Patch #${wizardState.patchA.id} (${wizardState.patchA.data?.authorName || wizardState.patchA.author})
                + Patch #${wizardState.patchB.id} (${wizardState.patchB.data?.authorName || wizardState.patchB.author})
            </div>
        `;
    }
    return '<div class="selection-summary empty">Select a conflict group or two patches to merge</div>';
}

/**
 * Update selection summary in DOM
 */
function updateSelectionSummary() {
    const existing = document.querySelector('.selection-summary');
    if (existing) {
        existing.outerHTML = getSelectionSummary();
    }
}

/**
 * Update next button state
 */
function updateNextButton() {
    const nextBtn = document.getElementById('wizard-next-btn');
    if (!nextBtn) return;

    const canProceed = (wizardState.conflictGroup && wizardState.conflictGroup.length >= 2) ||
                       (wizardState.patchA && wizardState.patchB);

    nextBtn.disabled = !canProceed;
}

/**
 * Start the merging process
 */
async function startMerging() {
    if (wizardState.mode === 'group' && wizardState.conflictGroup) {
        // Group mode: set up queue for sequential merging
        const patches = wizardState.conflictGroup;

        // Sort by timestamp to merge in chronological order
        const sortedPatches = [...patches].sort((a, b) => a.timestamp - b.timestamp);

        // First patch becomes the initial base
        wizardState.currentBase = sortedPatches[0].data?.snapshot || wizardState.baseSnapshot || '';
        wizardState.patchQueue = sortedPatches.slice(1); // Remaining patches to merge
        wizardState.currentPatchIndex = 0;

        // Start first merge
        wizardState.currentPatch = wizardState.patchQueue[0];
        await performCurrentMerge();
    } else {
        // Manual mode: simple two-patch merge
        wizardState.currentBase = wizardState.patchA.data?.snapshot || wizardState.baseSnapshot || '';
        wizardState.currentPatch = wizardState.patchB;
        wizardState.patchQueue = [];
        wizardState.currentPatchIndex = 0;

        await performCurrentMerge();
    }

    wizardState.step = 2;
    await renderWizardContent();
}

/**
 * Perform merge of current base with current patch
 */
async function performCurrentMerge() {
    const base = wizardState.baseSnapshot || '';
    const contentA = wizardState.currentBase;
    const contentB = wizardState.currentPatch.data?.snapshot || '';

    // Determine labels
    let labelA, labelB;
    if (wizardState.mode === 'group') {
        if (wizardState.currentPatchIndex === 0) {
            // First merge: first patch vs second patch
            const firstPatch = wizardState.conflictGroup.find(p =>
                p.data?.snapshot === wizardState.currentBase ||
                (wizardState.currentBase === wizardState.baseSnapshot && p === wizardState.conflictGroup[0])
            );
            labelA = firstPatch?.data?.authorName || 'Previous';
        } else {
            labelA = 'Merged Result';
        }
        labelB = wizardState.currentPatch.data?.authorName || `Patch #${wizardState.currentPatch.id}`;
    } else {
        labelA = wizardState.patchA.data?.authorName || `Patch #${wizardState.patchA.id}`;
        labelB = wizardState.patchB.data?.authorName || `Patch #${wizardState.patchB.id}`;
    }

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

    // Progress indicator for group mode
    let progressHtml = '';
    if (wizardState.mode === 'group' && wizardState.patchQueue.length > 0) {
        const total = wizardState.patchQueue.length;
        const current = wizardState.currentPatchIndex + 1;
        const remaining = total - current;

        progressHtml = `
            <div class="merge-progress-bar">
                <div class="progress-info">
                    <span>Merging patch #${wizardState.currentPatch.id} (${wizardState.currentPatch.data?.authorName || 'Unknown'})</span>
                    <span class="progress-count">${current} of ${total}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${(current / total) * 100}%"></div>
                </div>
                ${remaining > 0 ? `<div class="progress-remaining">${remaining} more patch${remaining > 1 ? 'es' : ''} after this</div>` : ''}
            </div>
        `;
    }

    // Determine labels for quick resolve buttons
    let labelA, labelB;
    if (wizardState.mode === 'group') {
        labelA = wizardState.currentPatchIndex === 0 ?
            (wizardState.conflictGroup[0]?.data?.authorName || 'First Patch') :
            'Merged Result';
        labelB = wizardState.currentPatch.data?.authorName || `Patch #${wizardState.currentPatch.id}`;
    } else {
        labelA = wizardState.patchA?.data?.authorName || 'Patch A';
        labelB = wizardState.patchB?.data?.authorName || 'Patch B';
    }

    body.innerHTML = `
        <div class="wizard-step-content merge-editor-step">
            ${progressHtml}

            <div class="merge-status-bar">
                ${currentConflictCount > 0 ? `
                    <span class="conflict-indicator-text">
                        <span class="conflict-icon">⚠</span>
                        ${currentConflictCount} conflict${currentConflictCount !== 1 ? 's' : ''} remaining
                    </span>
                    <span class="conflict-help">
                        Look for <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> markers and resolve manually
                    </span>
                ` : `
                    <span class="no-conflict-indicator">
                        <span class="success-icon">✓</span>
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
                                Accept All from ${labelA}
                            </button>
                            <button class="resolve-all-btn" data-resolution="B">
                                Accept All from ${labelB}
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

    // Determine next button text
    const hasMorePatches = wizardState.mode === 'group' &&
                          wizardState.currentPatchIndex < wizardState.patchQueue.length - 1;
    const nextButtonText = hasMorePatches ? 'Next Patch' : 'Apply Merge';
    const hasConflictsRemaining = hasUnresolvedConflicts(wizardState.mergedContent);

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-back-btn">Back</button>
        <button class="btn-primary" id="wizard-next-btn" ${hasConflictsRemaining ? 'disabled' : ''}>
            ${hasConflictsRemaining ? 'Resolve Conflicts First' : nextButtonText}
        </button>
    `;

    footer.querySelector('#wizard-back-btn').addEventListener('click', async () => {
        wizardState.step = 1;
        await renderWizardContent();
    });

    footer.querySelector('#wizard-next-btn').addEventListener('click', async () => {
        if (!hasUnresolvedConflicts(wizardState.mergedContent)) {
            if (hasMorePatches) {
                // Move to next patch in queue
                await proceedToNextPatch();
            } else {
                // Go to final confirmation
                wizardState.step = 3;
                await renderWizardContent();
            }
        }
    });
}

/**
 * Proceed to merge the next patch in the queue
 */
async function proceedToNextPatch() {
    // Current merged content becomes the new base
    wizardState.currentBase = wizardState.mergedContent;
    wizardState.currentPatchIndex++;
    wizardState.currentPatch = wizardState.patchQueue[wizardState.currentPatchIndex];

    // Perform the next merge
    await performCurrentMerge();

    // Re-render step 2
    await renderWizardContent();
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
                <span class="conflict-icon">⚠</span>
                ${currentConflictCount} conflict${currentConflictCount !== 1 ? 's' : ''} remaining
            </span>
            <span class="conflict-help">
                Look for <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> markers and resolve manually
            </span>
        `;
    } else {
        statusBar.innerHTML = `
            <span class="no-conflict-indicator">
                <span class="success-icon">✓</span>
                No conflicts - merge is clean!
            </span>
        `;
    }

    // Update next button state
    const nextBtn = document.getElementById('wizard-next-btn');
    if (nextBtn) {
        const hasMorePatches = wizardState.mode === 'group' &&
                              wizardState.currentPatchIndex < wizardState.patchQueue.length - 1;
        const nextButtonText = hasMorePatches ? 'Next Patch' : 'Apply Merge';

        nextBtn.disabled = currentConflictCount > 0;
        nextBtn.textContent = currentConflictCount > 0 ? 'Resolve Conflicts First' : nextButtonText;
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
                const lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 20;
                editor.scrollTop = Math.max(0, i * lineHeight - 100);
                return;
            }
            conflictCount++;
        }
        charOffset += lines[i].length + 1;
    }
}

/**
 * Step 3: Confirm and apply the merge
 */
async function renderStep3(body, footer) {
    // Build list of merged patches
    let mergedPatchesList;
    if (wizardState.mode === 'group' && wizardState.conflictGroup) {
        mergedPatchesList = wizardState.conflictGroup.map(p =>
            `<li><strong>${p.data?.authorName || 'Unknown'}</strong> (Patch #${p.id})</li>`
        ).join('');
    } else {
        mergedPatchesList = `
            <li><strong>${wizardState.patchA.data?.authorName || 'Patch A'}</strong> (Patch #${wizardState.patchA.id})</li>
            <li><strong>${wizardState.patchB.data?.authorName || 'Patch B'}</strong> (Patch #${wizardState.patchB.id})</li>
        `;
    }

    body.innerHTML = `
        <div class="wizard-step-content confirm-step">
            <div class="confirm-icon">✓</div>
            <h3>Ready to Apply Merge</h3>
            <p class="confirm-description">
                The merged content is ready to be applied. This will:
            </p>
            <ul class="confirm-list">
                <li>Replace the current document content with the merged result</li>
                <li>Combine changes from:
                    <ul>${mergedPatchesList}</ul>
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
        const success = setMarkdownContent(wizardState.mergedContent);

        if (!success) {
            alert('Failed to apply merged content to the editor.');
            return;
        }

        closePatchMergeWizard();
        await refreshTimeline();

        // Build success message
        let patchList;
        if (wizardState.mode === 'group' && wizardState.conflictGroup) {
            patchList = wizardState.conflictGroup.map(p =>
                `- ${p.data?.authorName || 'Unknown'} (#${p.id})`
            ).join('\n');
        } else {
            patchList = `- ${wizardState.patchA.data?.authorName || 'Patch A'} (#${wizardState.patchA.id})\n- ${wizardState.patchB.data?.authorName || 'Patch B'} (#${wizardState.patchB.id})`;
        }

        alert(`Merge applied successfully!\n\nCombined patches from:\n${patchList}`);

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
 * Initialize the patch merge wizard
 */
export function initPatchMergeWizard() {
    addWizardStyles();
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

        /* Step 1: Selections */
        .wizard-description {
            color: var(--text-secondary);
            margin-bottom: 20px;
            line-height: 1.5;
        }

        .section-hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 12px;
        }

        /* Conflict Groups Section */
        .conflict-groups-section {
            margin-bottom: 24px;
        }

        .conflict-groups-section h3 {
            font-size: 14px;
            margin-bottom: 8px;
            color: var(--text-primary);
        }

        .conflict-group-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .conflict-group-item {
            padding: 12px 16px;
            background: var(--bg-panel);
            border: 2px solid var(--border-color);
            border-left: 4px solid #f44336;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
        }

        .conflict-group-item:hover {
            background: var(--btn-bg-hover);
            border-color: #f44336;
        }

        .conflict-group-item.selected {
            background: rgba(244, 67, 54, 0.1);
            border-color: #f44336;
        }

        .group-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .group-icon {
            font-size: 16px;
        }

        .group-title {
            font-weight: 600;
            flex: 1;
        }

        .group-badge {
            font-size: 11px;
            padding: 2px 8px;
            background: #f44336;
            color: white;
            border-radius: 10px;
        }

        .group-authors {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 8px;
        }

        .group-patches {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .mini-patch-badge {
            font-size: 11px;
            padding: 2px 8px;
            background: var(--bg-sidebar);
            border-left: 3px solid;
            border-radius: 0 4px 4px 0;
        }

        .no-conflicts-notice {
            padding: 16px;
            background: rgba(76, 175, 80, 0.1);
            border: 1px solid rgba(76, 175, 80, 0.3);
            border-radius: 6px;
            color: #4caf50;
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
        }

        .no-conflicts-notice .success-icon {
            font-size: 20px;
        }

        /* Manual Selection */
        .manual-selection-section h3 {
            font-size: 14px;
            margin-bottom: 8px;
            color: var(--text-primary);
        }

        .patch-selection-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .patch-selection-column h4 {
            font-size: 12px;
            margin-bottom: 8px;
            color: var(--text-secondary);
        }

        .patch-selection-list {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-panel);
        }

        .patch-selection-item {
            padding: 10px 12px;
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
            margin-bottom: 2px;
        }

        .patch-selection-time {
            font-size: 10px;
            color: var(--text-muted);
        }

        /* Selection Summary */
        .selection-summary {
            padding: 12px;
            background: var(--accent-bg);
            border-radius: 6px;
            border: 1px solid var(--accent);
            font-size: 13px;
        }

        .selection-summary.empty {
            background: var(--bg-panel);
            border-color: var(--border-color);
            color: var(--text-muted);
        }

        .selection-summary.group-summary {
            background: rgba(244, 67, 54, 0.1);
            border-color: #f44336;
        }

        .merge-sequence {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 8px;
        }

        .sequence-patch {
            padding: 2px 8px;
            background: var(--bg-sidebar);
            border-left: 3px solid;
            border-radius: 0 4px 4px 0;
            font-size: 12px;
        }

        .sequence-arrow {
            color: var(--text-muted);
            font-size: 14px;
        }

        /* Step 2: Merge Editor */
        .merge-editor-step {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .merge-progress-bar {
            padding: 12px 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 6px;
            color: white;
        }

        .progress-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 13px;
        }

        .progress-count {
            font-weight: 600;
        }

        .progress-track {
            height: 6px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 3px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: white;
            border-radius: 3px;
            transition: width 0.3s ease;
        }

        .progress-remaining {
            font-size: 11px;
            opacity: 0.8;
            margin-top: 6px;
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
            min-height: 200px;
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
            max-height: 180px;
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
            min-width: 100px;
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

        /* Merge Patches Button */
        .merge-patches-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            width: 100%;
            padding: 10px;
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
