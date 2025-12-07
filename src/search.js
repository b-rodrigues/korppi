// src/search.js
// Search functionality with simple and regex support

import { editor, editorViewCtx, getEditorContent } from "./editor.js";

let searchState = {
    active: false,
    query: "",
    replaceText: "",
    isRegex: false,
    caseSensitive: false,
    results: [],
    currentIndex: -1,
    highlightElements: []
};

let searchPanel = null;

/**
 * Initialize search functionality
 */
export function initSearch() {
    // Listen for Ctrl+F
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            showSearchPanel();
        }

        // Ctrl+H for Find & Replace
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
            e.preventDefault();
            showSearchPanel(true); // Show with replace expanded
        }

        // Escape to close search
        if (e.key === "Escape" && searchState.active) {
            hideSearchPanel();
        }

        // F3 or Ctrl+G for next match
        if (e.key === "F3" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g")) {
            e.preventDefault();
            if (e.shiftKey) {
                navigateToPrevious();
            } else {
                navigateToNext();
            }
        }
    });
}

/**
 * Show the search panel
 * @param {boolean} showReplace - Whether to show the replace row expanded
 */
export function showSearchPanel(showReplace = false) {
    if (searchPanel) {
        // Already visible, focus the input
        const input = searchPanel.querySelector("#search-input");
        if (input) {
            input.focus();
            input.select();
        }
        // Toggle replace visibility if requested
        if (showReplace) {
            const replaceRow = searchPanel.querySelector(".search-replace-row");
            if (replaceRow) replaceRow.style.display = "flex";
        }
        return;
    }

    searchPanel = document.createElement("div");
    searchPanel.id = "search-panel";
    searchPanel.className = "search-panel";
    searchPanel.innerHTML = `
        <div class="search-container">
            <div class="search-input-row">
                <input type="text" id="search-input" placeholder="Find..." autocomplete="off" />
                <span id="search-count" class="search-count">0/0</span>
                <button id="search-prev" class="search-nav-btn" title="Previous (Shift+F3)">▲</button>
                <button id="search-next" class="search-nav-btn" title="Next (F3)">▼</button>
                <button id="toggle-replace" class="search-nav-btn" title="Toggle Replace (Ctrl+H)">↔</button>
                <button id="search-close" class="search-close-btn" title="Close (Esc)">✕</button>
            </div>
            <div class="search-replace-row" style="display: ${showReplace ? 'flex' : 'none'};">
                <input type="text" id="replace-input" placeholder="Replace with..." autocomplete="off" />
                <button id="replace-one" class="search-action-btn" title="Replace current match">Replace</button>
                <button id="replace-all" class="search-action-btn" title="Replace all matches">Replace All</button>
            </div>
            <div class="search-options">
                <label class="search-option">
                    <input type="checkbox" id="search-regex" />
                    <span>.*</span>
                    <span class="option-label">Regex</span>
                </label>
                <label class="search-option">
                    <input type="checkbox" id="search-case" />
                    <span>Aa</span>
                    <span class="option-label">Match Case</span>
                </label>
            </div>
        </div>
    `;

    // Insert at top of editor area
    const editorArea = document.querySelector(".editor-area");
    if (editorArea) {
        editorArea.insertBefore(searchPanel, editorArea.firstChild);
    } else {
        document.body.appendChild(searchPanel);
    }

    searchState.active = true;

    // Wire up event handlers
    const input = searchPanel.querySelector("#search-input");
    const replaceInput = searchPanel.querySelector("#replace-input");
    const regexCheckbox = searchPanel.querySelector("#search-regex");
    const caseCheckbox = searchPanel.querySelector("#search-case");
    const prevBtn = searchPanel.querySelector("#search-prev");
    const nextBtn = searchPanel.querySelector("#search-next");
    const toggleReplaceBtn = searchPanel.querySelector("#toggle-replace");
    const replaceOneBtn = searchPanel.querySelector("#replace-one");
    const replaceAllBtn = searchPanel.querySelector("#replace-all");
    const closeBtn = searchPanel.querySelector("#search-close");

    input.addEventListener("input", () => {
        searchState.query = input.value;
        performSearch();
    });

    replaceInput.addEventListener("input", () => {
        searchState.replaceText = replaceInput.value;
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) {
                navigateToPrevious();
            } else {
                navigateToNext();
            }
        }
    });

    regexCheckbox.addEventListener("change", () => {
        searchState.isRegex = regexCheckbox.checked;
        performSearch();
    });

    caseCheckbox.addEventListener("change", () => {
        searchState.caseSensitive = caseCheckbox.checked;
        performSearch();
    });

    prevBtn.addEventListener("click", navigateToPrevious);
    nextBtn.addEventListener("click", navigateToNext);
    closeBtn.addEventListener("click", hideSearchPanel);

    // Toggle replace row visibility
    toggleReplaceBtn.addEventListener("click", () => {
        const replaceRow = searchPanel.querySelector(".search-replace-row");
        if (replaceRow) {
            replaceRow.style.display = replaceRow.style.display === "none" ? "flex" : "none";
        }
    });

    // Replace current match
    replaceOneBtn.addEventListener("click", () => {
        replaceCurrentMatch();
    });

    // Replace all matches
    replaceAllBtn.addEventListener("click", () => {
        replaceAllMatches();
    });

    // Focus input
    setTimeout(() => {
        input.focus();

        // Pre-fill with selected text if any
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();
        if (selectedText && selectedText.length < 100) {
            input.value = selectedText;
            searchState.query = selectedText;
            performSearch();
            input.select();
        }
    }, 50);
}

/**
 * Hide the search panel
 */
export function hideSearchPanel() {
    if (searchPanel) {
        searchPanel.remove();
        searchPanel = null;
    }

    clearHighlights();
    searchState.active = false;
    searchState.results = [];
    searchState.currentIndex = -1;

    // Return focus to editor
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.focus();
        });
    }
}

/**
 * Perform the search
 */
function performSearch() {
    clearHighlights();
    searchState.results = [];
    searchState.currentIndex = -1;

    const query = searchState.query;
    if (!query || !editor) {
        updateSearchCount();
        return;
    }

    // Validate regex if in regex mode
    let regex;
    if (searchState.isRegex) {
        try {
            const flags = searchState.caseSensitive ? "g" : "gi";
            regex = new RegExp(query, flags);
        } catch (e) {
            // Invalid regex, show error state
            const input = searchPanel?.querySelector("#search-input");
            if (input) input.style.borderColor = "var(--danger)";
            updateSearchCount("Invalid regex");
            return;
        }
    }

    // Reset input border if previously had error
    const input = searchPanel?.querySelector("#search-input");
    if (input) input.style.borderColor = "";

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = view.state.doc;

        // Search through the document
        doc.descendants((node, pos) => {
            if (node.isText) {
                const text = node.text;

                if (searchState.isRegex) {
                    // Regex search
                    regex.lastIndex = 0;
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        searchState.results.push({
                            from: pos + match.index,
                            to: pos + match.index + match[0].length,
                            text: match[0]
                        });
                    }
                } else {
                    // Simple text search
                    const searchText = searchState.caseSensitive ? query : query.toLowerCase();
                    const nodeText = searchState.caseSensitive ? text : text.toLowerCase();
                    let idx = 0;
                    while ((idx = nodeText.indexOf(searchText, idx)) !== -1) {
                        searchState.results.push({
                            from: pos + idx,
                            to: pos + idx + query.length,
                            text: text.substring(idx, idx + query.length)
                        });
                        idx += query.length;
                    }
                }
            }
        });

        // Highlight all results
        highlightResults(view);

        // Navigate to first result
        if (searchState.results.length > 0) {
            searchState.currentIndex = 0;
            scrollToMatch(view, 0);
        }

        updateSearchCount();
    });
}

/**
 * Highlight all search results
 */
function highlightResults(view) {
    clearHighlights();

    searchState.results.forEach((result, index) => {
        try {
            const fromCoords = view.coordsAtPos(result.from);
            const toCoords = view.coordsAtPos(result.to);

            const highlight = document.createElement("div");
            highlight.className = "search-highlight";
            highlight.dataset.index = index;
            highlight.style.cssText = `
                position: fixed;
                left: ${fromCoords.left}px;
                top: ${fromCoords.top}px;
                width: ${toCoords.right - fromCoords.left}px;
                height: ${toCoords.bottom - fromCoords.top}px;
                background: rgba(255, 235, 59, 0.5);
                pointer-events: none;
                z-index: 40;
                border-radius: 2px;
            `;

            document.body.appendChild(highlight);
            searchState.highlightElements.push(highlight);
        } catch (e) {
            // Position might be invalid, skip
        }
    });
}

/**
 * Clear all highlights
 */
function clearHighlights() {
    searchState.highlightElements.forEach(el => el.remove());
    searchState.highlightElements = [];
    document.querySelectorAll(".search-highlight, .search-current-highlight").forEach(el => el.remove());
}

/**
 * Navigate to the next match
 */
function navigateToNext() {
    if (searchState.results.length === 0) return;

    searchState.currentIndex = (searchState.currentIndex + 1) % searchState.results.length;

    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            scrollToMatch(view, searchState.currentIndex);
        });
    }

    updateSearchCount();
}

/**
 * Navigate to the previous match
 */
function navigateToPrevious() {
    if (searchState.results.length === 0) return;

    searchState.currentIndex = searchState.currentIndex <= 0
        ? searchState.results.length - 1
        : searchState.currentIndex - 1;

    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            scrollToMatch(view, searchState.currentIndex);
        });
    }

    updateSearchCount();
}

/**
 * Scroll to a specific match
 */
function scrollToMatch(view, index) {
    if (index < 0 || index >= searchState.results.length) return;

    const result = searchState.results[index];

    // Update highlight styling - current match is different color
    searchState.highlightElements.forEach((el, i) => {
        if (i === index) {
            el.style.background = "rgba(255, 152, 0, 0.8)";
            el.style.boxShadow = "0 0 4px rgba(255, 152, 0, 0.8)";
        } else {
            el.style.background = "rgba(255, 235, 59, 0.5)";
            el.style.boxShadow = "none";
        }
    });

    // Set selection to the match
    try {
        const tr = view.state.tr.setSelection(
            view.state.selection.constructor.create(view.state.doc, result.from, result.to)
        );
        view.dispatch(tr.scrollIntoView());
    } catch (e) {
        console.warn("Could not scroll to match:", e);
    }
}

/**
 * Update the search count display
 */
function updateSearchCount(error = null) {
    const countEl = searchPanel?.querySelector("#search-count");
    if (!countEl) return;

    if (error) {
        countEl.textContent = error;
        countEl.style.color = "var(--danger)";
    } else if (searchState.results.length === 0) {
        countEl.textContent = searchState.query ? "No results" : "0/0";
        countEl.style.color = searchState.query ? "var(--danger)" : "";
    } else {
        countEl.textContent = `${searchState.currentIndex + 1}/${searchState.results.length}`;
        countEl.style.color = "";
    }
}

/**
 * Check if search is active
 */
export function isSearchActive() {
    return searchState.active;
}

/**
 * Replace the current match
 */
function replaceCurrentMatch() {
    if (searchState.results.length === 0 || searchState.currentIndex < 0) return;
    if (!editor) return;

    const result = searchState.results[searchState.currentIndex];
    const replaceText = searchState.replaceText;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        // Replace the text at the current match position
        const tr = state.tr.replaceWith(
            result.from,
            result.to,
            state.schema.text(replaceText)
        );
        dispatch(tr);

        // Re-search to update results
        setTimeout(() => {
            performSearch();
            // Navigate to next match (or stay at current position if possible)
        }, 10);
    });
}

/**
 * Replace all matches
 */
function replaceAllMatches() {
    if (searchState.results.length === 0) return;
    if (!editor) return;

    const replaceText = searchState.replaceText;
    const count = searchState.results.length;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        // Replace from end to start to maintain correct positions
        const sortedResults = [...searchState.results].sort((a, b) => b.from - a.from);

        let tr = state.tr;
        for (const result of sortedResults) {
            tr = tr.replaceWith(
                result.from,
                result.to,
                state.schema.text(replaceText)
            );
        }
        dispatch(tr);

        // Clear search and show toast
        setTimeout(() => {
            performSearch();
            showReplaceToast(`Replaced ${count} occurrence${count > 1 ? 's' : ''}`);
        }, 10);
    });
}

/**
 * Show a toast notification for replace operations
 */
function showReplaceToast(message) {
    const toast = document.createElement('div');
    toast.className = 'search-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 16px;
        background: var(--bg-sidebar);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 12px;
        z-index: 1100;
        box-shadow: var(--shadow-md);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}
