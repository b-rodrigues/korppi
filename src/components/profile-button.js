// src/components/profile-button.js
// Profile button with avatar display and modal trigger

import { getProfile, saveProfile } from "../profile-service.js";

let profileModal = null;
let currentProfile = null;

/**
 * Initialize the profile button
 */
export async function initProfileButton() {
    const profileBtn = document.getElementById('profile-button');
    const profileNameEl = document.getElementById('profile-name-display');

    if (!profileBtn) return;

    // Load and display current profile
    await refreshProfileDisplay();

    // Click to open modal
    profileBtn.addEventListener('click', openProfileModal);

    // Set up modal
    setupProfileModal();
}

/**
 * Refresh the profile display
 */
async function refreshProfileDisplay() {
    try {
        currentProfile = await getProfile();
        updateProfileButton(currentProfile);
    } catch (err) {
        console.error('Failed to load profile:', err);
    }
}

/**
 * Update the profile button with current profile data
 */
function updateProfileButton(profile) {
    const profileBtn = document.getElementById('profile-button');
    const profileNameEl = document.getElementById('profile-name-display');

    if (!profileBtn) return;

    // Set avatar or initials
    if (profile.avatar_path) {
        profileBtn.innerHTML = `<img src="${profile.avatar_path}" alt="Avatar">`;
    } else {
        const initials = getInitials(profile.name || 'User');
        profileBtn.textContent = initials;
    }

    // Set border color
    profileBtn.style.borderColor = profile.color || '#4fc3f7';

    // Update name display
    if (profileNameEl) {
        profileNameEl.textContent = profile.name || 'Set up profile';
    }
}

/**
 * Get initials from a name
 */
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
        return parts[0].charAt(0).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Set up the profile modal
 */
function setupProfileModal() {
    profileModal = document.getElementById('profile-modal');
    if (!profileModal) return;

    const closeBtn = document.getElementById('profile-modal-close');
    const saveBtn = document.getElementById('profile-save-btn');
    const avatarInput = document.getElementById('profile-avatar-input');
    const avatarPreview = document.getElementById('profile-avatar-preview');

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', closeProfileModal);
    }

    // Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSaveProfile);
    }

    // Click outside to close
    profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) {
            closeProfileModal();
        }
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && profileModal.style.display !== 'none') {
            closeProfileModal();
        }
    });

    // Avatar upload
    if (avatarInput) {
        avatarInput.addEventListener('change', handleAvatarUpload);
    }
}

/**
 * Open the profile modal
 */
async function openProfileModal() {
    if (!profileModal) return;

    // Refresh profile data
    await refreshProfileDisplay();

    // Populate form
    document.getElementById('profile-name').value = currentProfile?.name || '';
    document.getElementById('profile-email').value = currentProfile?.email || '';
    document.getElementById('profile-color').value = currentProfile?.color || '#4fc3f7';
    document.getElementById('profile-color-value').textContent = currentProfile?.color || '#4fc3f7';
    document.getElementById('profile-id').textContent = currentProfile?.id || '';

    // Update avatar preview
    const avatarPreview = document.getElementById('profile-avatar-preview');
    if (avatarPreview) {
        if (currentProfile?.avatar_path) {
            avatarPreview.innerHTML = `<img src="${currentProfile.avatar_path}" alt="Avatar">`;
        } else {
            avatarPreview.textContent = getInitials(currentProfile?.name || '');
        }
    }

    profileModal.style.display = 'flex';
    document.getElementById('profile-name').focus();
}

/**
 * Close the profile modal
 */
function closeProfileModal() {
    if (profileModal) {
        profileModal.style.display = 'none';
    }
}

/**
 * Handle avatar file upload
 */
async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    // Read as data URL for preview
    const reader = new FileReader();
    reader.onload = (e) => {
        const avatarPreview = document.getElementById('profile-avatar-preview');
        if (avatarPreview) {
            avatarPreview.innerHTML = `<img src="${e.target.result}" alt="Avatar">`;
        }
        // Store the data URL temporarily
        avatarPreview.dataset.newAvatar = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Handle save profile
 */
async function handleSaveProfile() {
    const name = document.getElementById('profile-name').value.trim();

    if (!name) {
        alert('Name is required');
        document.getElementById('profile-name').focus();
        return;
    }

    const avatarPreview = document.getElementById('profile-avatar-preview');
    const newAvatarData = avatarPreview?.dataset.newAvatar;

    const profile = {
        id: currentProfile?.id,
        name: name,
        email: document.getElementById('profile-email').value.trim() || null,
        avatar_path: newAvatarData || currentProfile?.avatar_path || null,
        color: document.getElementById('profile-color').value || '#4fc3f7',
    };

    try {
        await saveProfile(profile);
        currentProfile = profile;
        updateProfileButton(profile);
        closeProfileModal();
    } catch (err) {
        console.error('Failed to save profile:', err);
        alert('Failed to save profile: ' + err);
    }
}
