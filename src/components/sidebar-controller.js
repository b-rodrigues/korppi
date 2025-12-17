// src/components/sidebar-controller.js
// Controls right sidebar visibility and tab switching

import { getActiveDocumentId, onDocumentChange } from "../document-manager.js";

let rightSidebar = null;

// Store sidebar state per document
// Map<documentId, { visible: boolean, activeTab: string }>
const documentSidebarStates = new Map();

// Default state
const DEFAULT_STATE = {
    visible: false,
    activeTab: 'timeline'
};

/**
 * Initialize the sidebar controller
 */
export function initSidebarController() {
    rightSidebar = document.querySelector('.right-sidebar');

    // Hide sidebar by default on app start
    if (rightSidebar) {
        rightSidebar.classList.add('hidden');
    }

    // Initialize tab switching
    initSidebarTabs();

    // Listen for active document changes to restore state
    onDocumentChange((event, doc) => {
        if (event === "activeChange" && doc) {
            restoreSidebarState(doc.id);
        } else if (event === "close" && doc) {
            // Clean up state when document is closed
            documentSidebarStates.delete(doc.id);
        }
    });
}

/**
 * Initialize sidebar tab switching
 */
function initSidebarTabs() {
    const tabs = document.querySelectorAll('.sidebar-tab');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            switchSidebarTab(tabId);
        });
    });
}

/**
 * Save current state for active document
 */
function saveCurrentState() {
    const docId = getActiveDocumentId();
    if (!docId || !rightSidebar) return;

    const visible = !rightSidebar.classList.contains('hidden');
    const activeTabEl = document.querySelector('.sidebar-tab.active');
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'timeline';

    documentSidebarStates.set(docId, { visible, activeTab });
}

/**
 * Restore state for a document
 * @param {string} docId - Document ID
 */
function restoreSidebarState(docId) {
    if (!rightSidebar) return;

    const state = documentSidebarStates.get(docId) || DEFAULT_STATE;

    // Restore visibility
    if (state.visible) {
        rightSidebar.classList.remove('hidden');
    } else {
        rightSidebar.classList.add('hidden');
    }

    // Restore active tab (even if hidden, so it's ready when opened)
    // Avoid calling switchSidebarTab if it triggers events or complex logic we don't want during restore?
    // switchSidebarTab updates the UI classes and display, which is what we want.
    // It also saves the state again, which is redundant but harmless.
    // To avoid recursion or side effects, we can manually update UI if needed, 
    // but using the function ensures consistency.
    // However, switchSidebarTab calls saveCurrentState (if we add it there). 
    // Let's make sure switchSidebarTab doesn't rely on existing DOM state that might be stale.
    // Actually, switchSidebarTab takes an argument and sets the state.

    // We should just update the UI specific to the tab without "saving" first.
    updateSidebarTabUI(state.activeTab);
}


/**
 * Update the UI for a specific tab without changing business logic state
 * @param {string} tabId 
 */
function updateSidebarTabUI(tabId) {
    // Update tab buttons
    document.querySelectorAll('.sidebar-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
    });

    // Update tab content
    document.querySelectorAll('.sidebar-tab-content').forEach(content => {
        const isActive = content.id === `${tabId}-tab`;
        content.classList.toggle('active', isActive);
        content.style.display = isActive ? 'flex' : 'none';
    });

    // Notify other components (using custom event)
    window.dispatchEvent(new CustomEvent('sidebar-tab-changed', {
        detail: { tab: tabId }
    }));
}

/**
 * Switch the active sidebar tab
 * @param {string} tabId - The tab ID to switch to
 */
export function switchSidebarTab(tabId) {
    updateSidebarTabUI(tabId);
    saveCurrentState();
}

/**
 * Show the right sidebar, optionally switching to a specific tab
 * @param {string} [tab] - Optional tab to show: 'timeline' or 'comments'
 */
export function showRightSidebar(tab = null) {
    if (!rightSidebar) {
        rightSidebar = document.querySelector('.right-sidebar');
    }

    if (rightSidebar) {
        rightSidebar.classList.remove('hidden');

        // Switch to requested tab if specified
        if (tab) {
            switchSidebarTab(tab); // This saves state
        } else {
            saveCurrentState(); // Save visibility change
        }
    }
}

/**
 * Hide the right sidebar
 */
export function hideRightSidebar() {
    if (!rightSidebar) {
        rightSidebar = document.querySelector('.right-sidebar');
    }

    if (rightSidebar) {
        rightSidebar.classList.add('hidden');
        saveCurrentState();
    }
}

/**
 * Toggle the right sidebar visibility
 * @param {string} [tab] - Optional tab to show when opening
 */
export function toggleRightSidebar(tab = null) {
    if (!rightSidebar) {
        rightSidebar = document.querySelector('.right-sidebar');
    }

    if (rightSidebar) {
        if (rightSidebar.classList.contains('hidden')) {
            showRightSidebar(tab);
        } else {
            hideRightSidebar();
        }
    }
}

/**
 * Check if the right sidebar is currently visible
 * @returns {boolean}
 */
export function isRightSidebarVisible() {
    if (!rightSidebar) {
        rightSidebar = document.querySelector('.right-sidebar');
    }
    return rightSidebar && !rightSidebar.classList.contains('hidden');
}
