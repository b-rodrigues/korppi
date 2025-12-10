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
            // Use switchToTab function if available, otherwise click the tab button
            const tabBtn = document.querySelector(`.sidebar-tab[data-tab="${tab}"]`);
            if (tabBtn) {
                tabBtn.click();
            }
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
