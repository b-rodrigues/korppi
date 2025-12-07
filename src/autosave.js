// src/autosave.js
// Autosave functionality with configurable interval

import { saveDocument, getActiveDocumentId, hasUnsavedChanges } from "./document-manager.js";

const STORAGE_KEY = "korppi_autosave_settings";

let autosaveState = {
    enabled: false,
    intervalMinutes: 5,
    intervalId: null
};

/**
 * Initialize autosave functionality
 */
export function initAutosave() {
    // Load saved settings
    loadSettings();

    // Wire up UI
    const toggle = document.getElementById("autosave-toggle");
    const intervalSelect = document.getElementById("autosave-interval");

    if (toggle) {
        toggle.checked = autosaveState.enabled;
        toggle.addEventListener("change", () => {
            autosaveState.enabled = toggle.checked;
            intervalSelect.disabled = !toggle.checked;
            saveSettings();

            if (toggle.checked) {
                startAutosave();
            } else {
                stopAutosave();
            }
        });
    }

    if (intervalSelect) {
        intervalSelect.value = String(autosaveState.intervalMinutes);
        intervalSelect.disabled = !autosaveState.enabled;
        intervalSelect.addEventListener("change", () => {
            autosaveState.intervalMinutes = parseInt(intervalSelect.value, 10);
            saveSettings();

            // Restart with new interval
            if (autosaveState.enabled) {
                stopAutosave();
                startAutosave();
            }
        });
    }

    // Start autosave if enabled
    if (autosaveState.enabled) {
        startAutosave();
    }
}

/**
 * Start the autosave timer
 */
function startAutosave() {
    if (autosaveState.intervalId) {
        clearInterval(autosaveState.intervalId);
    }

    const intervalMs = autosaveState.intervalMinutes * 60 * 1000;

    autosaveState.intervalId = setInterval(async () => {
        const docId = getActiveDocumentId();
        if (docId && hasUnsavedChanges()) {
            try {
                await saveDocument(docId);
                showAutosaveNotification();
            } catch (err) {
                console.error("Autosave failed:", err);
            }
        }
    }, intervalMs);

    console.log(`Autosave started: every ${autosaveState.intervalMinutes} minute(s)`);
}

/**
 * Stop the autosave timer
 */
function stopAutosave() {
    if (autosaveState.intervalId) {
        clearInterval(autosaveState.intervalId);
        autosaveState.intervalId = null;
    }
    console.log("Autosave stopped");
}

/**
 * Show a brief notification when autosave occurs
 */
function showAutosaveNotification() {
    const toast = document.createElement("div");
    toast.className = "autosave-toast";
    toast.innerHTML = `<span>✓ Autosaved</span>`;
    toast.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 12px;
        padding: 6px 12px;
        background: var(--success, #27ae60);
        color: white;
        border-radius: 4px;
        font-size: 11px;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s;
    `;

    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
    });

    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 200);
    }, 1500);
}

/**
 * Load settings from localStorage
 */
function loadSettings() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            autosaveState.enabled = parsed.enabled ?? false;
            autosaveState.intervalMinutes = parsed.intervalMinutes ?? 5;
        }
    } catch (e) {
        console.warn("Failed to load autosave settings:", e);
    }
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            enabled: autosaveState.enabled,
            intervalMinutes: autosaveState.intervalMinutes
        }));
    } catch (e) {
        console.warn("Failed to save autosave settings:", e);
    }
}

/**
 * Check if autosave is enabled
 */
export function isAutosaveEnabled() {
    return autosaveState.enabled;
}
