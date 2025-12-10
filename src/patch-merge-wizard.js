// src/patch-merge-wizard.js
// Three-way patch merge wizard UI with conflict group and zone-based support

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { fetchPatchList, hasSnapshotContent, refreshTimeline } from "./timeline.js";
import { detectPatchConflicts } from "./conflict-detection.js";
import { mergeWithConflicts, parseConflicts, resolveConflict, hasUnresolvedConflicts, countConflicts } from "./patch-merge.js";
import { detectConflictZones, extractZoneContent, replaceZoneContent, getZoneContext, formatZoneForDisplay } from "./conflict-zones.js";
import { setMarkdownContent, getMarkdown } from "./editor.js";
import { getCachedProfile, getCurrentUserInfo } from "./profile-service.js";

let wizardState = {
    isOpen: false,
    step: 1, // 1: select patches, 2: show zones, 3: resolve zone, 4: confirm
    mode: 'manual', // 'manual' or 'group'

    // For manual mode (2 patches)
    patchA: null,
    patchB: null,

    // For group mode (N patches)
    conflictGroup: null,

    // Zone-based merging
    zones: [], // All detected zones
    conflictZones: [], // Only zones with conflicts (2+ authors)
    currentZoneIndex: 0,
    zoneResolutions: {}, // zoneId -> resolved content

    // Common state
    baseSnapshot: null,
    selectedPatches: [], // Normalized list of selected patches
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
        zones: [],
        conflictZones: [],
        currentZoneIndex: 0,
        zoneResolutions: {},
        baseSnapshot: null,
        selectedPatches: [],
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
    if (wizardState.step === 3 && wizardState.conflictZones.length > 0) {
        stepIndicator.textContent = `Zone ${wizardState.currentZoneIndex + 1} of ${wizardState.conflictZones.length}`;
    } else {
        const stepNames = ['Select Patches', 'Review Zones', 'Resolve Zone', 'Apply'];
        stepIndicator.textContent = stepNames[wizardState.step - 1] || `Step ${wizardState.step}`;
    }

    switch (wizardState.step) {
        case 1:
            await renderStep1_SelectPatches(body, footer);
            break;
        case 2:
            await renderStep2_ShowZones(body, footer);
            break;
        case 3:
            await renderStep3_ResolveZone(body, footer);
            break;
        case 4:
            await renderStep4_Confirm(body, footer);
            break;
    }
}

/**
 * Step 1: Select patches to merge
 */
async function renderStep1_SelectPatches(body, footer) {
    const patches = await fetchPatchList();
    wizardState.allPatches = patches;

    const savePatches = patches
        .filter(p => p.kind === 'Save' && hasSnapshotContent(p))
        .sort((a, b) => b.timestamp - a.timestamp);

    const { conflictGroups } = detectPatchConflicts(patches);
    wizardState.allConflictGroups = conflictGroups;

    const conflictGroupsWithDetails = conflictGroups.map(group => {
        const groupPatches = group.map(id => savePatches.find(p => p.id === id)).filter(Boolean);
        const authors = [...new Set(groupPatches.map(p => p.data?.authorName || p.author))];
        return { ids: group, patches: groupPatches, authors, size: groupPatches.length };
    }).filter(g => g.size >= 2);

    const sortedByTime = [...savePatches].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedByTime.length > 0) {
        wizardState.baseSnapshot = sortedByTime[0].data.snapshot;
    }

    body.innerHTML = `
        <div class="wizard-step-content">
            <p class="wizard-description">
                Select patches to merge. Conflicts will be broken down into independent zones for easier resolution.
            </p>

            ${conflictGroupsWithDetails.length > 0 ? `
                <div class="conflict-groups-section">
                    <h3>Conflict Groups</h3>
                    <p class="section-hint">These patches have overlapping changes.</p>
                    <div class="conflict-group-list">
                        ${conflictGroupsWithDetails.map((group, idx) => `
                            <div class="conflict-group-item ${wizardState.conflictGroup === group.patches ? 'selected' : ''}"
                                 data-group-idx="${idx}">
                                <div class="group-header">
                                    <span class="group-icon">⚠️</span>
                                    <span class="group-title">${group.size} conflicting patches</span>
                                </div>
                                <div class="group-authors">Authors: ${group.authors.join(', ')}</div>
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
                    No conflict groups detected. Select patches manually below.
                </div>
            `}

            <div class="manual-selection-section">
                <h3>Manual Selection</h3>
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
                                    <div class="patch-selection-time">${new Date(p.timestamp).toLocaleString()}</div>
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
                                    <div class="patch-selection-time">${new Date(p.timestamp).toLocaleString()}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>

            ${getSelectionSummary()}
        </div>
    `;

    // Event handlers for conflict groups
    body.querySelectorAll('.conflict-group-item').forEach(item => {
        item.addEventListener('click', () => {
            const groupIdx = parseInt(item.dataset.groupIdx);
            const group = conflictGroupsWithDetails[groupIdx];

            wizardState.patchA = null;
            wizardState.patchB = null;
            wizardState.mode = 'group';
            wizardState.conflictGroup = group.patches;

            body.querySelectorAll('.conflict-group-item').forEach(el => el.classList.toggle('selected', el === item));
            body.querySelectorAll('.patch-selection-item').forEach(el => el.classList.remove('selected'));

            updateSelectionSummary();
            updateNextButton();
        });
    });

    // Event handlers for manual selection
    body.querySelectorAll('.patch-selection-item').forEach(item => {
        item.addEventListener('click', () => {
            const patchId = parseInt(item.dataset.patchId);
            const list = item.dataset.list;
            const patch = savePatches.find(p => p.id === patchId);

            wizardState.conflictGroup = null;
            wizardState.mode = 'manual';
            body.querySelectorAll('.conflict-group-item').forEach(el => el.classList.remove('selected'));

            if (list === 'a') {
                wizardState.patchA = patch;
                body.querySelectorAll('#patch-list-a .patch-selection-item').forEach(el =>
                    el.classList.toggle('selected', el.dataset.patchId === String(patchId)));
            } else {
                wizardState.patchB = patch;
                body.querySelectorAll('#patch-list-b .patch-selection-item').forEach(el =>
                    el.classList.toggle('selected', el.dataset.patchId === String(patchId)));
            }

            updateSelectionSummary();
            updateNextButton();
        });
    });

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-cancel-btn">Cancel</button>
        <button class="btn-primary" id="wizard-next-btn" disabled>Next: Analyze Zones</button>
    `;

    footer.querySelector('#wizard-cancel-btn').addEventListener('click', closePatchMergeWizard);
    footer.querySelector('#wizard-next-btn').addEventListener('click', async () => {
        await analyzeZones();
        wizardState.step = 2;
        await renderWizardContent();
    });

    updateNextButton();
}

/**
 * Analyze patches and detect conflict zones
 */
async function analyzeZones() {
    // Normalize selected patches
    if (wizardState.mode === 'group' && wizardState.conflictGroup) {
        wizardState.selectedPatches = [...wizardState.conflictGroup].sort((a, b) => a.timestamp - b.timestamp);
    } else {
        wizardState.selectedPatches = [wizardState.patchA, wizardState.patchB].sort((a, b) => a.timestamp - b.timestamp);
    }

    const base = wizardState.baseSnapshot || '';

    // Prepare patches for zone detection
    const patchesForZones = wizardState.selectedPatches.map(p => ({
        id: p.id,
        content: p.data?.snapshot || '',
        author: p.author,
        authorName: p.data?.authorName || p.author,
        authorColor: p.data?.authorColor || '#808080'
    }));

    // Detect zones
    const zones = detectConflictZones(base, patchesForZones);

    // Format zones for display
    wizardState.zones = zones.map(z => formatZoneForDisplay(z, base));
    wizardState.conflictZones = wizardState.zones.filter(z => z.hasConflict);
    wizardState.currentZoneIndex = 0;
    wizardState.zoneResolutions = {};
}

/**
 * Step 2: Show detected zones
 */
async function renderStep2_ShowZones(body, footer) {
    const totalZones = wizardState.zones.length;
    const conflictZoneCount = wizardState.conflictZones.length;
    const cleanZoneCount = totalZones - conflictZoneCount;

    body.innerHTML = `
        <div class="wizard-step-content zones-overview">
            <div class="zones-summary">
                <div class="zones-stat">
                    <span class="stat-number">${totalZones}</span>
                    <span class="stat-label">Total Zones</span>
                </div>
                <div class="zones-stat conflict">
                    <span class="stat-number">${conflictZoneCount}</span>
                    <span class="stat-label">Need Resolution</span>
                </div>
                <div class="zones-stat clean">
                    <span class="stat-number">${cleanZoneCount}</span>
                    <span class="stat-label">Auto-merged</span>
                </div>
            </div>

            ${conflictZoneCount === 0 ? `
                <div class="no-conflicts-notice">
                    <span class="success-icon">✓</span>
                    <div>
                        <strong>No conflicts detected!</strong>
                        <p>All changes from the selected patches can be automatically merged.</p>
                    </div>
                </div>
            ` : `
                <p class="wizard-description">
                    The following zones have overlapping changes from different authors and need manual resolution:
                </p>
            `}

            <div class="zones-list">
                ${wizardState.zones.map((zone, idx) => `
                    <div class="zone-item ${zone.hasConflict ? 'has-conflict' : 'clean'} ${wizardState.zoneResolutions[zone.id] ? 'resolved' : ''}">
                        <div class="zone-header">
                            <span class="zone-lines">Lines ${zone.startLine + 1}-${zone.endLine + 1}</span>
                            <span class="zone-status">
                                ${wizardState.zoneResolutions[zone.id] ? '✓ Resolved' :
                                  zone.hasConflict ? '⚠️ Conflict' : '✓ Auto-merged'}
                            </span>
                        </div>
                        <div class="zone-authors">
                            ${zone.patches.map(p => `
                                <span class="zone-author-badge" style="background-color: ${p.authorColor}">
                                    ${p.authorName}
                                </span>
                            `).join('')}
                        </div>
                        <div class="zone-preview">${escapeHtml(zone.preview)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    const hasUnresolvedConflicts = wizardState.conflictZones.some(z => !wizardState.zoneResolutions[z.id]);

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-back-btn">Back</button>
        ${conflictZoneCount > 0 && hasUnresolvedConflicts ? `
            <button class="btn-primary" id="wizard-resolve-btn">Resolve Conflicts (${conflictZoneCount} zones)</button>
        ` : `
            <button class="btn-primary" id="wizard-apply-btn">Apply Merge</button>
        `}
    `;

    footer.querySelector('#wizard-back-btn').addEventListener('click', async () => {
        wizardState.step = 1;
        await renderWizardContent();
    });

    const resolveBtn = footer.querySelector('#wizard-resolve-btn');
    if (resolveBtn) {
        resolveBtn.addEventListener('click', async () => {
            wizardState.currentZoneIndex = 0;
            wizardState.step = 3;
            await renderWizardContent();
        });
    }

    const applyBtn = footer.querySelector('#wizard-apply-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            await buildFinalMerge();
            wizardState.step = 4;
            await renderWizardContent();
        });
    }
}

/**
 * Step 3: Resolve individual zone
 */
async function renderStep3_ResolveZone(body, footer) {
    const zone = wizardState.conflictZones[wizardState.currentZoneIndex];
    if (!zone) {
        wizardState.step = 2;
        await renderWizardContent();
        return;
    }

    const base = wizardState.baseSnapshot || '';
    const baseZoneContent = extractZoneContent(base, zone.startLine, zone.endLine);
    const context = getZoneContext(base, zone.startLine, zone.endLine, 2);

    // Get zone content from each patch
    const patchContents = zone.patches.map(p => {
        const patchData = wizardState.selectedPatches.find(sp => sp.id === p.id);
        const fullContent = patchData?.data?.snapshot || '';
        return {
            authorName: p.authorName,
            authorColor: p.authorColor,
            content: extractZoneContent(fullContent, zone.startLine, zone.endLine)
        };
    });

    // Get current resolution or compute initial merge
    let currentContent = wizardState.zoneResolutions[zone.id];
    if (currentContent === undefined) {
        // Try to merge the zone contents
        if (patchContents.length === 2) {
            const result = mergeWithConflicts(baseZoneContent, patchContents[0].content, patchContents[1].content,
                patchContents[0].authorName, patchContents[1].authorName);
            currentContent = result.merged;
        } else {
            // For 3+ patches, merge sequentially
            currentContent = patchContents[0].content;
            for (let i = 1; i < patchContents.length; i++) {
                const result = mergeWithConflicts(baseZoneContent, currentContent, patchContents[i].content,
                    i === 1 ? patchContents[0].authorName : 'Previous', patchContents[i].authorName);
                currentContent = result.merged;
            }
        }
    }

    const conflicts = parseConflicts(currentContent);
    const conflictCount = countConflicts(currentContent);

    body.innerHTML = `
        <div class="wizard-step-content zone-editor-step">
            <div class="zone-progress-bar">
                <div class="progress-info">
                    <span>Zone ${wizardState.currentZoneIndex + 1} of ${wizardState.conflictZones.length}</span>
                    <span>Lines ${zone.startLine + 1}-${zone.endLine + 1}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${((wizardState.currentZoneIndex + 1) / wizardState.conflictZones.length) * 100}%"></div>
                </div>
            </div>

            <div class="zone-context-info">
                <div class="zone-authors-involved">
                    Authors: ${zone.patches.map(p => `
                        <span class="zone-author-badge" style="background-color: ${p.authorColor}">${p.authorName}</span>
                    `).join(' ')}
                </div>
            </div>

            ${context.before ? `
                <div class="zone-context before">
                    <span class="context-label">Context before:</span>
                    <pre>${escapeHtml(context.before)}</pre>
                </div>
            ` : ''}

            <div class="merge-status-bar">
                ${conflictCount > 0 ? `
                    <span class="conflict-indicator-text">
                        <span class="conflict-icon">⚠</span>
                        ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''} in this zone
                    </span>
                ` : `
                    <span class="no-conflict-indicator">
                        <span class="success-icon">✓</span>
                        Zone resolved!
                    </span>
                `}
            </div>

            <div class="merge-editor-container">
                <div class="merge-editor-toolbar">
                    <span class="toolbar-label">Zone Content:</span>
                    ${conflicts.length > 0 ? `
                        <div class="quick-resolve-buttons">
                            ${patchContents.map((p, i) => `
                                <button class="resolve-all-btn" data-author-idx="${i}">
                                    Use ${p.authorName}
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                <textarea id="zone-editor" class="merge-editor-textarea">${escapeHtml(currentContent)}</textarea>
            </div>

            ${context.after ? `
                <div class="zone-context after">
                    <span class="context-label">Context after:</span>
                    <pre>${escapeHtml(context.after)}</pre>
                </div>
            ` : ''}

            ${conflicts.length > 0 ? `
                <div class="conflict-navigator">
                    <h4>Conflicts in this zone</h4>
                    <div class="conflict-list">
                        ${conflicts.map((c, idx) => `
                            <div class="conflict-nav-item" data-conflict-idx="${idx}">
                                <span class="conflict-num">#${idx + 1}</span>
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
    const editor = body.querySelector('#zone-editor');
    editor.addEventListener('input', () => {
        wizardState.zoneResolutions[zone.id] = editor.value;
        updateZoneConflictStatus(zone.id);
    });

    // Bind quick resolve buttons
    body.querySelectorAll('.resolve-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const authorIdx = parseInt(btn.dataset.authorIdx);
            const authorContent = patchContents[authorIdx].content;
            wizardState.zoneResolutions[zone.id] = authorContent;
            editor.value = authorContent;
            updateZoneConflictStatus(zone.id);
        });
    });

    // Bind conflict resolution buttons
    body.querySelectorAll('.conflict-resolve-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            const resolution = btn.dataset.resolution;
            const currentVal = editor.value;
            const resolved = resolveConflict(currentVal, idx, resolution);
            wizardState.zoneResolutions[zone.id] = resolved;
            editor.value = resolved;
            updateZoneConflictStatus(zone.id);
        });
    });

    // Store initial value
    wizardState.zoneResolutions[zone.id] = currentContent;

    const hasConflictsRemaining = hasUnresolvedConflicts(currentContent);
    const isLastZone = wizardState.currentZoneIndex >= wizardState.conflictZones.length - 1;

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-back-btn">Back to Overview</button>
        ${wizardState.currentZoneIndex > 0 ? `
            <button class="btn-secondary" id="wizard-prev-zone-btn">Previous Zone</button>
        ` : ''}
        <button class="btn-primary" id="wizard-next-zone-btn" ${hasConflictsRemaining ? 'disabled' : ''}>
            ${hasConflictsRemaining ? 'Resolve Conflicts First' : (isLastZone ? 'Finish & Review' : 'Next Zone')}
        </button>
    `;

    footer.querySelector('#wizard-back-btn').addEventListener('click', async () => {
        wizardState.step = 2;
        await renderWizardContent();
    });

    const prevBtn = footer.querySelector('#wizard-prev-zone-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', async () => {
            wizardState.currentZoneIndex--;
            await renderWizardContent();
        });
    }

    footer.querySelector('#wizard-next-zone-btn').addEventListener('click', async () => {
        if (!hasUnresolvedConflicts(wizardState.zoneResolutions[zone.id])) {
            if (isLastZone) {
                await buildFinalMerge();
                wizardState.step = 4;
            } else {
                wizardState.currentZoneIndex++;
            }
            await renderWizardContent();
        }
    });
}

/**
 * Update zone conflict status in the UI
 */
function updateZoneConflictStatus(zoneId) {
    const content = wizardState.zoneResolutions[zoneId] || '';
    const conflictCount = countConflicts(content);
    const statusBar = document.querySelector('.merge-status-bar');

    if (statusBar) {
        statusBar.innerHTML = conflictCount > 0 ? `
            <span class="conflict-indicator-text">
                <span class="conflict-icon">⚠</span>
                ${conflictCount} conflict${conflictCount !== 1 ? 's' : ''} in this zone
            </span>
        ` : `
            <span class="no-conflict-indicator">
                <span class="success-icon">✓</span>
                Zone resolved!
            </span>
        `;
    }

    const nextBtn = document.getElementById('wizard-next-zone-btn');
    if (nextBtn) {
        const isLastZone = wizardState.currentZoneIndex >= wizardState.conflictZones.length - 1;
        nextBtn.disabled = conflictCount > 0;
        nextBtn.textContent = conflictCount > 0 ? 'Resolve Conflicts First' : (isLastZone ? 'Finish & Review' : 'Next Zone');
    }
}

/**
 * Build the final merged content from all zone resolutions
 */
async function buildFinalMerge() {
    const base = wizardState.baseSnapshot || '';
    let result = base;

    // Start with the first patch's content as base if we have patches
    if (wizardState.selectedPatches.length > 0) {
        result = wizardState.selectedPatches[0].data?.snapshot || base;
    }

    // For zones with conflicts, use the resolved content
    // For clean zones, use the patch content (they auto-merge)

    // Sort zones by start line (descending) so we replace from bottom to top
    const sortedZones = [...wizardState.zones].sort((a, b) => b.startLine - a.startLine);

    for (const zone of sortedZones) {
        if (zone.hasConflict && wizardState.zoneResolutions[zone.id]) {
            // Use the manually resolved content
            result = replaceZoneContent(result, zone.startLine, zone.endLine, wizardState.zoneResolutions[zone.id]);
        } else if (!zone.hasConflict && zone.patches.length > 0) {
            // Use the single patch's version (auto-merged)
            const patchData = wizardState.selectedPatches.find(sp => sp.id === zone.patches[0].id);
            if (patchData) {
                const patchZoneContent = extractZoneContent(patchData.data?.snapshot || '', zone.startLine, zone.endLine);
                result = replaceZoneContent(result, zone.startLine, zone.endLine, patchZoneContent);
            }
        }
    }

    wizardState.mergedContent = result;
}

/**
 * Step 4: Confirm and apply
 */
async function renderStep4_Confirm(body, footer) {
    const patchesList = wizardState.selectedPatches.map(p =>
        `<li><strong>${p.data?.authorName || 'Unknown'}</strong> (Patch #${p.id})</li>`
    ).join('');

    const zonesResolved = wizardState.conflictZones.length;

    body.innerHTML = `
        <div class="wizard-step-content confirm-step">
            <div class="confirm-icon">✓</div>
            <h3>Ready to Apply Merge</h3>

            <div class="confirm-stats">
                <div class="stat-item">
                    <span class="stat-value">${wizardState.selectedPatches.length}</span>
                    <span class="stat-label">Patches Merged</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${zonesResolved}</span>
                    <span class="stat-label">Conflicts Resolved</span>
                </div>
            </div>

            <ul class="confirm-list">
                <li>Combined changes from: <ul>${patchesList}</ul></li>
            </ul>

            <div class="confirm-preview">
                <h4>Preview of merged content:</h4>
                <pre class="confirm-preview-content">${escapeHtml(wizardState.mergedContent.substring(0, 500))}${wizardState.mergedContent.length > 500 ? '\n...' : ''}</pre>
            </div>
        </div>
    `;

    footer.innerHTML = `
        <button class="btn-secondary" id="wizard-back-btn">Back</button>
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
 * Apply the merged content
 */
async function applyMerge() {
    try {
        const success = setMarkdownContent(wizardState.mergedContent);
        if (!success) {
            alert('Failed to apply merged content.');
            return;
        }

        closePatchMergeWizard();
        await refreshTimeline();

        const patchList = wizardState.selectedPatches.map(p =>
            `- ${p.data?.authorName || 'Unknown'} (#${p.id})`
        ).join('\n');

        alert(`Merge applied successfully!\n\nCombined patches from:\n${patchList}`);
    } catch (err) {
        console.error('Failed to apply merge:', err);
        alert(`Error: ${err.message || err}`);
    }
}

// Helper functions
function getSelectionSummary() {
    if (wizardState.conflictGroup && wizardState.conflictGroup.length >= 2) {
        return `
            <div class="selection-summary group-summary">
                <strong>Selected:</strong> ${wizardState.conflictGroup.length} patches from conflict group
            </div>
        `;
    } else if (wizardState.patchA && wizardState.patchB) {
        return `
            <div class="selection-summary">
                <strong>Selected:</strong>
                #${wizardState.patchA.id} (${wizardState.patchA.data?.authorName || wizardState.patchA.author})
                + #${wizardState.patchB.id} (${wizardState.patchB.data?.authorName || wizardState.patchB.author})
            </div>
        `;
    }
    return '<div class="selection-summary empty">Select patches to merge</div>';
}

function updateSelectionSummary() {
    const existing = document.querySelector('.selection-summary');
    if (existing) existing.outerHTML = getSelectionSummary();
}

function updateNextButton() {
    const nextBtn = document.getElementById('wizard-next-btn');
    if (!nextBtn) return;
    const canProceed = (wizardState.conflictGroup && wizardState.conflictGroup.length >= 2) ||
                       (wizardState.patchA && wizardState.patchB);
    nextBtn.disabled = !canProceed;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function initPatchMergeWizard() {
    addWizardStyles();
}

function addWizardStyles() {
    if (document.getElementById('patch-merge-wizard-styles')) return;

    const style = document.createElement('style');
    style.id = 'patch-merge-wizard-styles';
    style.textContent = `
        .patch-merge-wizard-modal { z-index: 1100; }
        .patch-merge-wizard-content { max-width: 900px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; }
        .patch-merge-wizard-header { display: flex; align-items: center; gap: 16px; }
        .patch-merge-wizard-header h2 { flex: 1; }
        .wizard-step-indicator { font-size: 12px; color: var(--text-muted); background: var(--bg-panel); padding: 4px 12px; border-radius: 12px; }
        .patch-merge-wizard-body { flex: 1; overflow-y: auto; padding: 20px; }
        .patch-merge-wizard-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 20px; border-top: 1px solid var(--border-color); }

        .wizard-description { color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5; }
        .section-hint { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }

        .conflict-groups-section { margin-bottom: 24px; }
        .conflict-groups-section h3, .manual-selection-section h3 { font-size: 14px; margin-bottom: 8px; }
        .conflict-group-list { display: flex; flex-direction: column; gap: 8px; }
        .conflict-group-item { padding: 12px 16px; background: var(--bg-panel); border: 2px solid var(--border-color); border-left: 4px solid #f44336; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
        .conflict-group-item:hover { background: var(--btn-bg-hover); }
        .conflict-group-item.selected { background: rgba(244, 67, 54, 0.1); border-color: #f44336; }
        .group-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .group-icon { font-size: 16px; }
        .group-title { font-weight: 600; flex: 1; }
        .group-authors { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
        .group-patches { display: flex; flex-wrap: wrap; gap: 6px; }
        .mini-patch-badge { font-size: 11px; padding: 2px 8px; background: var(--bg-sidebar); border-left: 3px solid; border-radius: 0 4px 4px 0; }

        .no-conflicts-notice { padding: 16px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px; color: #4caf50; display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .no-conflicts-notice .success-icon { font-size: 20px; }

        .patch-selection-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .patch-selection-column h4 { font-size: 12px; margin-bottom: 8px; color: var(--text-secondary); }
        .patch-selection-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-panel); }
        .patch-selection-item { padding: 10px 12px; border-bottom: 1px solid var(--border-light); cursor: pointer; transition: background 0.1s; }
        .patch-selection-item:last-child { border-bottom: none; }
        .patch-selection-item:hover { background: var(--btn-bg-hover); }
        .patch-selection-item.selected { background: var(--accent-bg); border-left: 3px solid var(--accent); }
        .patch-selection-info { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
        .patch-selection-time { font-size: 10px; color: var(--text-muted); }

        .selection-summary { padding: 12px; background: var(--accent-bg); border-radius: 6px; border: 1px solid var(--accent); font-size: 13px; }
        .selection-summary.empty { background: var(--bg-panel); border-color: var(--border-color); color: var(--text-muted); }
        .selection-summary.group-summary { background: rgba(244, 67, 54, 0.1); border-color: #f44336; }

        /* Zones */
        .zones-overview { }
        .zones-summary { display: flex; gap: 16px; margin-bottom: 24px; }
        .zones-stat { flex: 1; padding: 16px; background: var(--bg-panel); border-radius: 8px; text-align: center; }
        .zones-stat.conflict { border-left: 4px solid #f44336; }
        .zones-stat.clean { border-left: 4px solid #4caf50; }
        .stat-number { display: block; font-size: 32px; font-weight: bold; }
        .stat-label { font-size: 12px; color: var(--text-muted); }

        .zones-list { display: flex; flex-direction: column; gap: 8px; }
        .zone-item { padding: 12px 16px; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 6px; }
        .zone-item.has-conflict { border-left: 4px solid #f44336; }
        .zone-item.clean { border-left: 4px solid #4caf50; }
        .zone-item.resolved { border-left-color: #2196f3; }
        .zone-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .zone-lines { font-weight: 600; }
        .zone-status { font-size: 12px; }
        .zone-authors { display: flex; gap: 4px; margin-bottom: 8px; }
        .zone-author-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; color: white; }
        .zone-preview { font-family: monospace; font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Zone Editor */
        .zone-editor-step { display: flex; flex-direction: column; gap: 12px; }
        .zone-progress-bar { padding: 12px 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 6px; color: white; }
        .progress-info { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
        .progress-track { height: 6px; background: rgba(255,255,255,0.3); border-radius: 3px; }
        .progress-fill { height: 100%; background: white; border-radius: 3px; transition: width 0.3s; }

        .zone-context-info { padding: 8px 12px; background: var(--bg-panel); border-radius: 6px; }
        .zone-authors-involved { display: flex; align-items: center; gap: 8px; font-size: 12px; }

        .zone-context { padding: 8px 12px; background: var(--bg-sidebar); border-radius: 4px; font-size: 11px; }
        .zone-context pre { margin: 4px 0 0; white-space: pre-wrap; color: var(--text-muted); }
        .context-label { font-size: 10px; color: var(--text-muted); }

        .merge-status-bar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: var(--bg-panel); border-radius: 6px; border: 1px solid var(--border-color); }
        .conflict-indicator-text { color: #f44336; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .no-conflict-indicator { color: #4caf50; font-weight: 600; display: flex; align-items: center; gap: 8px; }

        .merge-editor-container { display: flex; flex-direction: column; }
        .merge-editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-sidebar); border: 1px solid var(--border-color); border-bottom: none; border-radius: 6px 6px 0 0; }
        .toolbar-label { font-weight: 600; font-size: 12px; }
        .quick-resolve-buttons { display: flex; gap: 8px; }
        .resolve-all-btn { padding: 4px 10px; font-size: 11px; background: var(--btn-bg); border: 1px solid var(--btn-border); border-radius: 4px; cursor: pointer; }
        .resolve-all-btn:hover { background: var(--btn-bg-hover); }

        .merge-editor-textarea { min-height: 150px; padding: 12px; font-family: monospace; font-size: 13px; line-height: 1.5; background: var(--bg-page); border: 1px solid var(--border-color); border-radius: 0 0 6px 6px; color: var(--text-primary); resize: vertical; }
        .merge-editor-textarea:focus { outline: none; border-color: var(--accent); }

        .conflict-navigator { border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-panel); }
        .conflict-navigator h4 { padding: 10px 16px; margin: 0; font-size: 13px; border-bottom: 1px solid var(--border-light); background: var(--bg-sidebar); border-radius: 6px 6px 0 0; }
        .conflict-list { max-height: 120px; overflow-y: auto; }
        .conflict-nav-item { padding: 8px 16px; border-bottom: 1px solid var(--border-light); display: flex; align-items: center; gap: 12px; }
        .conflict-nav-item:last-child { border-bottom: none; }
        .conflict-num { font-weight: 600; color: #f44336; }
        .conflict-actions { display: flex; gap: 8px; }
        .conflict-resolve-btn { padding: 4px 10px; font-size: 11px; background: var(--btn-bg); border: 1px solid var(--btn-border); border-radius: 4px; cursor: pointer; }
        .conflict-resolve-btn:hover { background: var(--accent); color: #000; }

        /* Confirm */
        .confirm-step { text-align: center; padding: 20px; }
        .confirm-icon { font-size: 48px; color: #4caf50; margin-bottom: 16px; }
        .confirm-stats { display: flex; justify-content: center; gap: 24px; margin: 20px 0; }
        .stat-item { text-align: center; }
        .stat-value { display: block; font-size: 28px; font-weight: bold; color: var(--accent); }
        .confirm-list { text-align: left; max-width: 400px; margin: 0 auto 20px; }
        .confirm-preview { text-align: left; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; }
        .confirm-preview h4 { font-size: 13px; margin-bottom: 12px; color: var(--text-secondary); }
        .confirm-preview-content { background: var(--bg-sidebar); padding: 12px; border-radius: 4px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap; }

        .merge-patches-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .merge-patches-btn:hover { opacity: 0.9; }

        @media (max-width: 768px) { .patch-selection-grid { grid-template-columns: 1fr; } .zones-summary { flex-direction: column; } }
    `;

    document.head.appendChild(style);
}
