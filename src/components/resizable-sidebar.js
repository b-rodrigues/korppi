// src/components/resizable-sidebar.js
// Handles mouse-drag resizing for both sidebars

const MIN_LEFT_WIDTH = 150;
const MAX_LEFT_WIDTH = 400;
const MIN_RIGHT_WIDTH = 200;
const MAX_RIGHT_WIDTH = 500;

let isResizing = false;
let currentHandle = null;
let startX = 0;
let startWidth = 0;

/**
 * Initialize resizable sidebars
 */
export function initResizableSidebars() {
    const leftSidebar = document.querySelector('.left-sidebar');
    const rightSidebar = document.querySelector('.right-sidebar');

    if (leftSidebar) {
        createResizeHandle(leftSidebar, 'left');
        loadSavedWidth('left', leftSidebar);
    }

    if (rightSidebar) {
        createResizeHandle(rightSidebar, 'right');
        loadSavedWidth('right', rightSidebar);
    }

    // Global mouse event handlers
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

/**
 * Create a resize handle for a sidebar
 */
function createResizeHandle(sidebar, side) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${side}`;
    handle.dataset.side = side;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        currentHandle = side;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;

        handle.classList.add('active');
        document.body.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
    });

    sidebar.appendChild(handle);
}

/**
 * Handle mouse move during resize
 */
function handleMouseMove(e) {
    if (!isResizing) return;

    const delta = currentHandle === 'left'
        ? e.clientX - startX
        : startX - e.clientX;

    let newWidth = startWidth + delta;

    if (currentHandle === 'left') {
        newWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, newWidth));
        document.documentElement.style.setProperty('--left-sidebar-width', `${newWidth}px`);
    } else {
        newWidth = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, newWidth));
        document.documentElement.style.setProperty('--right-sidebar-width', `${newWidth}px`);
    }
}

/**
 * Handle mouse up - end resize
 */
function handleMouseUp() {
    if (!isResizing) return;

    isResizing = false;

    // Save the new width
    const varName = currentHandle === 'left' ? '--left-sidebar-width' : '--right-sidebar-width';
    const width = getComputedStyle(document.documentElement).getPropertyValue(varName);
    localStorage.setItem(`korppi-${currentHandle}-sidebar-width`, width);

    // Clean up
    document.querySelectorAll('.resize-handle').forEach(h => h.classList.remove('active'));
    document.body.classList.remove('resizing');
    document.body.style.cursor = '';
    currentHandle = null;
}

/**
 * Load saved sidebar width from localStorage
 */
function loadSavedWidth(side, sidebar) {
    const saved = localStorage.getItem(`korppi-${side}-sidebar-width`);
    if (saved) {
        const varName = side === 'left' ? '--left-sidebar-width' : '--right-sidebar-width';
        document.documentElement.style.setProperty(varName, saved);
    }
}
