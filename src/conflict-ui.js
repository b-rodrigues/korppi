import { getConflicts, resolveConflict, detectConflicts } from "./conflict-service.js";

/**
 * Initialize the conflict resolution UI
 */
export function initConflictUI() {
    // Add conflict button to the header
    const header = document.querySelector("header");
    // Ensure header exists (it should based on previous day's work, but safe check)
    if (!header) {
        console.error("Header not found, cannot append conflict button");
        return;
    }

    const conflictBtn = document.createElement("button");
    conflictBtn.id = "conflict-toggle";
    conflictBtn.innerHTML = "⚠️ Conflicts <span id='conflict-badge'>0</span>";
    conflictBtn.style.cssText = `
        position: absolute;
        right: 20px;
        top: 20px;
        background: #ff9800;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
    `;
    header.appendChild(conflictBtn);

    // Add conflict panel
    const panel = document.createElement("div");
    panel.id = "conflict-panel";
    panel.innerHTML = `
        <div class="conflict-header">
            <h2>Conflicts</h2>
            <button id="scan-conflicts">🔍 Scan</button>
            <button id="close-conflicts">✕</button>
        </div>
        <div id="conflict-list"></div>
        <div id="conflict-detail" style="display: none;">
            <h3>Resolve Conflict</h3>
            <div class="conflict-versions">
                <div class="version local">
                    <h4>Your Version</h4>
                    <pre id="local-content"></pre>
                    <button class="resolve-btn" data-resolution="ResolvedLocal">
                        ✓ Keep Mine
                    </button>
                </div>
                <div class="version remote">
                    <h4>Their Version</h4>
                    <pre id="remote-content"></pre>
                    <button class="resolve-btn" data-resolution="ResolvedRemote">
                        ✓ Keep Theirs
                    </button>
                </div>
            </div>
            <div class="merge-section">
                <h4>Or Merge Manually</h4>
                <textarea id="merge-content" rows="4"></textarea>
                <button class="resolve-btn" data-resolution="ResolvedMerged">
                    ✓ Use Merged Version
                </button>
            </div>
            <button class="resolve-btn keep-both" data-resolution="ResolvedBoth">
                Keep Both (Append)
            </button>
        </div>
    `;
    panel.style.cssText = `
        display: none;
        position: fixed;
        top: 0;
        right: 0;
        width: 500px;
        height: 100%;
        background: #2a2a2a;
        border-left: 2px solid #ff9800;
        padding: 20px;
        overflow-y: auto;
        z-index: 1000;
    `;
    document.body.appendChild(panel);

    // Add styles
    addConflictStyles();

    // Event listeners
    conflictBtn.addEventListener("click", toggleConflictPanel);
    document.getElementById("close-conflicts").addEventListener("click", toggleConflictPanel);
    document.getElementById("scan-conflicts").addEventListener("click", scanForConflicts);
    document.getElementById("conflict-list").addEventListener("click", handleConflictSelect);
    panel.addEventListener("click", handleResolution);

    // Initial badge update
    updateConflictBadge();
}

let currentConflict = null;

async function toggleConflictPanel() {
    const panel = document.getElementById("conflict-panel");
    if (panel.style.display === "none") {
        panel.style.display = "block";
        await loadConflicts();
    } else {
        panel.style.display = "none";
    }
}

async function scanForConflicts() {
    const btn = document.getElementById("scan-conflicts");
    btn.disabled = true;
    btn.textContent = "Scanning...";

    try {
        await detectConflicts();
        await loadConflicts();
    } catch (err) {
        console.error("Failed to scan conflicts:", err);
    } finally {
        btn.disabled = false;
        btn.textContent = "🔍 Scan";
    }
}

async function loadConflicts() {
    const list = document.getElementById("conflict-list");

    try {
        const conflicts = await getConflicts();
        updateConflictBadge(conflicts.length);

        if (conflicts.length === 0) {
            list.innerHTML = `
                <div class="no-conflicts">
                    ✅ No conflicts detected
                </div>
            `;
            return;
        }

        list.innerHTML = conflicts.map(c => `
            <div class="conflict-item" data-id="${c.id}">
                <span class="conflict-type">${formatConflictType(c.conflict_type)}</span>
                <span class="conflict-authors">
                    ${c.local_version.author} vs ${c.remote_version.author}
                </span>
                <span class="conflict-pos">
                    Position: ${c.local_version.start}-${c.local_version.end}
                </span>
            </div>
        `).join("");
    } catch (err) {
        list.innerHTML = `<div class="error">Failed to load conflicts</div>`;
    }
}

function handleConflictSelect(event) {
    const item = event.target.closest(".conflict-item");
    if (!item) return;

    const conflictId = item.dataset.id;
    showConflictDetail(conflictId);
}

async function showConflictDetail(conflictId) {
    const conflicts = await getConflicts();
    const conflict = conflicts.find(c => c.id === conflictId);

    if (!conflict) return;

    currentConflict = conflict;

    document.getElementById("local-content").textContent =
        conflict.local_version.content || "(empty)";
    document.getElementById("remote-content").textContent =
        conflict.remote_version.content || "(empty)";
    document.getElementById("merge-content").value =
        (conflict.local_version.content || "") + "\n" + (conflict.remote_version.content || "");

    document.getElementById("conflict-list").style.display = "none";
    document.getElementById("conflict-detail").style.display = "block";
}

async function handleResolution(event) {
    const btn = event.target.closest(".resolve-btn");
    if (!btn || !currentConflict) return;

    const resolution = btn.dataset.resolution;
    let mergedContent = null;

    if (resolution === "ResolvedMerged") {
        mergedContent = document.getElementById("merge-content").value;
    } else if (resolution === "ResolvedBoth") {
        mergedContent = currentConflict.local_version.content +
                       "\n" +
                       currentConflict.remote_version.content;
    }

    try {
        await resolveConflict(currentConflict.id, resolution, mergedContent);

        // Go back to list
        document.getElementById("conflict-detail").style.display = "none";
        document.getElementById("conflict-list").style.display = "block";
        currentConflict = null;

        // Reload
        await loadConflicts();
    } catch (err) {
        console.error("Failed to resolve conflict:", err);
        alert("Failed to resolve conflict: " + err);
    }
}

async function updateConflictBadge(count) {
    if (count === undefined) {
        try {
            const conflicts = await getConflicts();
            count = conflicts.length;
        } catch {
            count = 0;
        }
    }

    const badge = document.getElementById("conflict-badge");
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? "inline" : "none";
    }

    const btn = document.getElementById("conflict-toggle");
    if (btn) {
        btn.style.background = count > 0 ? "#f44336" : "#4caf50";
    }
}

function formatConflictType(type) {
    const icons = {
        OverlappingEdit: "✏️ Overlapping Edit",
        DeleteModify: "🗑️ Delete vs Modify",
        ConcurrentInsert: "➕ Concurrent Insert",
        StructuralConflict: "🏗️ Structure Conflict",
    };
    return icons[type] || type;
}

function addConflictStyles() {
    const style = document.createElement("style");
    style.textContent = `
        #conflict-badge {
            background: white;
            color: #f44336;
            border-radius: 50%;
            padding: 2px 6px;
            font-size: 12px;
            margin-left: 4px;
        }

        .conflict-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #444;
        }

        .conflict-header h2 {
            flex: 1;
            margin: 0;
            color: #ff9800;
        }

        .conflict-item {
            background: #333;
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 4px;
            cursor: pointer;
            border-left: 3px solid #ff9800;
        }

        .conflict-item:hover {
            background: #444;
        }

        .conflict-type {
            display: block;
            font-weight: bold;
            margin-bottom: 4px;
        }

        .conflict-authors, .conflict-pos {
            font-size: 12px;
            color: #aaa;
            display: block;
        }

        .no-conflicts {
            text-align: center;
            padding: 40px;
            color: #4caf50;
        }

        .conflict-versions {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .version {
            flex: 1;
            background: #333;
            padding: 12px;
            border-radius: 4px;
        }

        .version.local {
            border-left: 3px solid #4fc3f7;
        }

        .version.remote {
            border-left: 3px solid #ff9800;
        }

        .version h4 {
            margin: 0 0 8px 0;
            font-size: 14px;
        }

        .version pre {
            background: #1e1e1e;
            padding: 8px;
            border-radius: 4px;
            margin: 0 0 12px 0;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 150px;
            overflow-y: auto;
        }

        .resolve-btn {
            width: 100%;
            padding: 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            margin-top: 8px;
        }

        .version.local .resolve-btn {
            background: #4fc3f7;
            color: #000;
        }

        .version.remote .resolve-btn {
            background: #ff9800;
            color: #000;
        }

        .merge-section {
            background: #333;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 12px;
        }

        .merge-section h4 {
            margin: 0 0 8px 0;
        }

        .merge-section textarea {
            width: 100%;
            background: #1e1e1e;
            border: 1px solid #444;
            color: #e0e0e0;
            padding: 8px;
            border-radius: 4px;
            resize: vertical;
        }

        .merge-section .resolve-btn {
            background: #9c27b0;
            color: white;
        }

        .keep-both {
            background: #607d8b !important;
            color: white !important;
        }
    `;
    document.head.appendChild(style);
}

// Auto-check for conflicts periodically
setInterval(updateConflictBadge, 30000);
