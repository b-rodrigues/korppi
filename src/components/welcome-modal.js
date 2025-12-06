// src/components/welcome-modal.js
// Welcome modal that appears on first launch

const WELCOME_DISMISSED_KEY = 'korppi-welcome-dismissed';

let welcomeModal = null;

/**
 * Initialize and show the welcome modal if not previously dismissed
 */
export async function initWelcomeModal() {
    welcomeModal = document.getElementById('welcome-modal');
    if (!welcomeModal) return;

    // Check if user has dismissed the welcome modal before
    const dismissed = localStorage.getItem(WELCOME_DISMISSED_KEY);
    if (dismissed === 'true') {
        return;
    }

    setupWelcomeModal();
    showWelcomeModal();
}

/**
 * Set up welcome modal event listeners
 */
function setupWelcomeModal() {
    const closeBtn = document.getElementById('welcome-close-btn');
    const configureProfileBtn = document.getElementById('welcome-configure-profile-btn');
    const dontShowAgainCheckbox = document.getElementById('welcome-dont-show-again');

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', closeWelcomeModal);
    }

    // Configure profile button - opens profile modal and closes welcome
    if (configureProfileBtn) {
        configureProfileBtn.addEventListener('click', () => {
            closeWelcomeModal();
            // Trigger profile modal by clicking the profile button
            const profileBtn = document.getElementById('profile-button');
            if (profileBtn) {
                profileBtn.click();
            }
        });
    }

    // Click outside to close
    welcomeModal.addEventListener('click', (e) => {
        if (e.target === welcomeModal) {
            closeWelcomeModal();
        }
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && welcomeModal.style.display !== 'none') {
            closeWelcomeModal();
        }
    });
}

/**
 * Show the welcome modal
 */
function showWelcomeModal() {
    if (welcomeModal) {
        welcomeModal.style.display = 'flex';
    }
}

/**
 * Close the welcome modal and save preference if checkbox is checked
 */
function closeWelcomeModal() {
    if (!welcomeModal) return;

    const dontShowAgainCheckbox = document.getElementById('welcome-dont-show-again');
    if (dontShowAgainCheckbox && dontShowAgainCheckbox.checked) {
        localStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
    }

    welcomeModal.style.display = 'none';
}

/**
 * Reset the welcome modal preference (for testing/settings)
 */
export function resetWelcomePreference() {
    localStorage.removeItem(WELCOME_DISMISSED_KEY);
}
