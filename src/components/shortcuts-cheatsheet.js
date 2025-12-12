// src/components/shortcuts-cheatsheet.js
// Keyboard shortcuts cheat sheet modal

let cheatsheetModal = null;

// Detect if running on Mac
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? '⌘' : 'Ctrl';
const altKey = isMac ? '⌥' : 'Alt';

const shortcuts = [
    {
        category: 'File',
        items: [
            { keys: `${modKey}+N`, action: 'New document' },
            { keys: `${modKey}+O`, action: 'Open document' },
            { keys: `${modKey}+S`, action: 'Save document' },
            { keys: `${modKey}+Shift+S`, action: 'Save As' },
            { keys: `${modKey}+W`, action: 'Close document' },
        ]
    },
    {
        category: 'Edit',
        items: [
            { keys: `${modKey}+Z`, action: 'Undo' },
            { keys: `${modKey}+Y`, action: 'Redo' },
            { keys: `${modKey}+X`, action: 'Cut' },
            { keys: `${modKey}+C`, action: 'Copy' },
            { keys: `${modKey}+V`, action: 'Paste' },
            { keys: `${modKey}+Shift+V`, action: 'Paste as plain text' },
            { keys: `${modKey}+A`, action: 'Select all' },
        ]
    },
    {
        category: 'Formatting',
        items: [
            { keys: `${modKey}+B`, action: 'Bold' },
            { keys: `${modKey}+I`, action: 'Italic' },
            { keys: `${modKey}+U`, action: 'Underline' },
            { keys: `${modKey}+Shift+X`, action: 'Strikethrough' },
        ]
    },
    {
        category: 'Search',
        items: [
            { keys: `${modKey}+F`, action: 'Find' },
            { keys: `${modKey}+H`, action: 'Find and Replace' },
            { keys: 'F3', action: 'Find next' },
            { keys: 'Shift+F3', action: 'Find previous' },
        ]
    },
    {
        category: 'Navigation',
        items: [
            { keys: `${modKey}+Tab`, action: 'Next tab' },
            { keys: `${modKey}+Shift+Tab`, action: 'Previous tab' },
        ]
    },
    {
        category: 'Help',
        items: [
            { keys: `${altKey}+Shift+K`, action: 'Show this cheat sheet' },
        ]
    }
];

/**
 * Show the keyboard shortcuts cheat sheet
 */
export function showShortcutsCheatsheet() {
    if (cheatsheetModal) {
        // Already open, just focus it
        return;
    }

    cheatsheetModal = document.createElement('div');
    cheatsheetModal.className = 'modal';
    cheatsheetModal.style.display = 'flex';
    cheatsheetModal.id = 'shortcuts-cheatsheet-modal';

    const categoriesHtml = shortcuts.map(cat => `
        <div class="shortcut-category">
            <h3>${cat.category}</h3>
            <div class="shortcut-list">
                ${cat.items.map(item => `
                    <div class="shortcut-item">
                        <kbd>${item.keys}</kbd>
                        <span>${item.action}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    cheatsheetModal.innerHTML = `
        <div class="modal-content shortcuts-cheatsheet-content">
            <div class="modal-header">
                <h2>Keyboard Shortcuts</h2>
                <button class="modal-close-btn" id="shortcuts-close-btn" title="Close (Esc)">&times;</button>
            </div>
            <div class="modal-body shortcuts-grid">
                ${categoriesHtml}
            </div>
            <div class="modal-footer">
                <span class="shortcut-hint">Press <kbd>Esc</kbd> or <kbd>${altKey}+Shift+K</kbd> to close</span>
            </div>
        </div>
    `;

    document.body.appendChild(cheatsheetModal);

    // Wire up close button
    const closeBtn = cheatsheetModal.querySelector('#shortcuts-close-btn');
    closeBtn.addEventListener('click', hideShortcutsCheatsheet);

    // Close on overlay click
    cheatsheetModal.addEventListener('click', (e) => {
        if (e.target === cheatsheetModal) {
            hideShortcutsCheatsheet();
        }
    });

    // Close on Escape
    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            hideShortcutsCheatsheet();
        }
    };
    document.addEventListener('keydown', handleKeydown, { once: true });
}

/**
 * Hide the keyboard shortcuts cheat sheet
 */
export function hideShortcutsCheatsheet() {
    if (cheatsheetModal) {
        cheatsheetModal.remove();
        cheatsheetModal = null;
    }
}

/**
 * Toggle the keyboard shortcuts cheat sheet
 */
export function toggleShortcutsCheatsheet() {
    if (cheatsheetModal) {
        hideShortcutsCheatsheet();
    } else {
        showShortcutsCheatsheet();
    }
}
