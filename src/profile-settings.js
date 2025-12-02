// src/profile-settings.js
import { getProfile, saveProfile, getCachedProfile } from "./profile-service.js";

let modal = null;
let nameInput = null;
let emailInput = null;
let colorInput = null;
let colorValue = null;
let profileIdDisplay = null;
let saveBtn = null;
let closeBtn = null;
let settingsBtn = null;

/**
 * Initialize the profile settings UI
 */
export function initProfileSettings() {
    // Get DOM elements
    modal = document.getElementById("profile-modal");
    nameInput = document.getElementById("profile-name");
    emailInput = document.getElementById("profile-email");
    colorInput = document.getElementById("profile-color");
    colorValue = document.getElementById("profile-color-value");
    profileIdDisplay = document.getElementById("profile-id");
    saveBtn = document.getElementById("profile-save-btn");
    closeBtn = document.getElementById("profile-modal-close");
    settingsBtn = document.getElementById("settings-btn");

    if (!modal || !settingsBtn) {
        console.warn("Profile settings elements not found");
        return;
    }

    // Set up event listeners
    settingsBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", closeModal);
    saveBtn.addEventListener("click", handleSave);
    
    // Update color value display when color changes
    colorInput.addEventListener("input", () => {
        colorValue.textContent = colorInput.value;
    });

    // Close modal when clicking outside
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Close modal on Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") {
            closeModal();
        }
    });

    // Check if this is first run (no name set) and prompt for setup
    checkFirstRun();
}

/**
 * Check if this is the first run and prompt for profile setup
 */
async function checkFirstRun() {
    const profile = getCachedProfile();
    if (profile && !profile.name) {
        // First run - open settings modal to prompt for name
        setTimeout(() => {
            openModal();
        }, 500);
    }
}

/**
 * Open the profile settings modal
 */
async function openModal() {
    if (!modal) return;

    // Load current profile
    const profile = await getProfile();
    
    // Populate form
    nameInput.value = profile.name || "";
    emailInput.value = profile.email || "";
    colorInput.value = profile.color || "#3498db";
    colorValue.textContent = profile.color || "#3498db";
    profileIdDisplay.textContent = profile.id || "";

    // Show modal
    modal.style.display = "flex";
    
    // Focus name input
    nameInput.focus();
}

/**
 * Close the profile settings modal
 */
function closeModal() {
    if (!modal) return;
    modal.style.display = "none";
}

/**
 * Handle save button click
 */
async function handleSave() {
    const name = nameInput.value.trim();
    
    // Validate required fields
    if (!name) {
        alert("Name is required");
        nameInput.focus();
        return;
    }

    // Get current profile to preserve ID
    const currentProfile = getCachedProfile() || {};
    
    // Build updated profile
    const profile = {
        id: currentProfile.id || crypto.randomUUID?.() || generateUUID(),
        name: name,
        email: emailInput.value.trim() || null,
        avatar_path: currentProfile.avatar_path || null,
        color: colorInput.value || "#3498db",
    };

    try {
        await saveProfile(profile);
        closeModal();
    } catch (err) {
        console.error("Failed to save profile:", err);
        alert("Failed to save profile: " + err);
    }
}

/**
 * Fallback UUID generator for older browsers
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
