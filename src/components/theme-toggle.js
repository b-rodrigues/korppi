// src/components/theme-toggle.js
// Light/Dark theme switching with persistence

const THEME_KEY = 'korppi-theme';

/**
 * Initialize theme toggle
 */
export function initThemeToggle() {
    // Load saved theme or detect system preference
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

    setTheme(initialTheme);

    // Set up toggle button
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        updateToggleButton(toggleBtn, initialTheme);
        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.dataset.theme || 'light';
            const newTheme = current === 'light' ? 'dark' : 'light';
            setTheme(newTheme);
            updateToggleButton(toggleBtn, newTheme);
        });
    }
}

/**
 * Set the theme
 */
export function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);

    // Dispatch event for other components
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

/**
 * Get current theme
 */
export function getTheme() {
    return document.documentElement.dataset.theme || 'light';
}

/**
 * Update toggle button appearance
 */
function updateToggleButton(btn, theme) {
    btn.innerHTML = theme === 'light'
        ? '<span class="icon">🌙</span><span class="label">Dark</span>'
        : '<span class="icon">☀️</span><span class="label">Light</span>';
    btn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
}
