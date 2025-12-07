// src/components/save-confirm-modal.js
// Custom save confirmation modal with Yes/No/Cancel support

/**
 * Show save confirmation modal and return user's choice
 * @param {string} message - The message to display
 * @returns {Promise<'save'|'dontsave'|'cancel'>} User's choice
 */
export function showSaveConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('save-confirm-modal');
        const messageEl = document.getElementById('save-confirm-message');
        const saveBtn = document.getElementById('save-confirm-save-btn');
        const dontSaveBtn = document.getElementById('save-confirm-dontsave-btn');
        const cancelBtn = document.getElementById('save-confirm-cancel-btn');

        if (!modal || !messageEl || !saveBtn || !dontSaveBtn || !cancelBtn) {
            console.error('Save confirm modal elements not found');
            resolve('cancel');
            return;
        }

        // Set message
        messageEl.textContent = message;

        // Show modal
        modal.style.display = 'flex';

        // Clean up function
        const cleanup = () => {
            modal.style.display = 'none';
            saveBtn.removeEventListener('click', onSave);
            dontSaveBtn.removeEventListener('click', onDontSave);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeydown);
        };

        // Button handlers
        const onSave = () => {
            cleanup();
            resolve('save');
        };

        const onDontSave = () => {
            cleanup();
            resolve('dontsave');
        };

        const onCancel = () => {
            cleanup();
            resolve('cancel');
        };

        // Keyboard handler (Escape = Cancel)
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };

        // Attach event listeners
        saveBtn.addEventListener('click', onSave);
        dontSaveBtn.addEventListener('click', onDontSave);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeydown);

        // Focus the Save button by default
        saveBtn.focus();
    });
}
