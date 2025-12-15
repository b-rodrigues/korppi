// src/components/sidebar-controller.js
// Controls right sidebar visibility and tab switching

let rightSidebar = null;

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
 * Switch the active sidebar tab
 * @param {string} tabId - The tab ID to switch to
 */
export function switchSidebarTab(tabId) {
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
            switchSidebarTab(tab);
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
