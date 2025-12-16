// src/profile-service.js
import { invoke } from "@tauri-apps/api/core";

// Cached profile to avoid async calls in hot paths
let cachedProfile = null;

/**
 * Get the user profile from disk.
 * Returns default profile if not exists.
 * @returns {Promise<Object>} The user profile
 */
export async function getProfile() {
    const profile = await invoke("get_profile");
    cachedProfile = profile;
    return profile;
}

/**
 * Save the user profile to disk.
 * @param {Object} profile - The profile to save
 * @returns {Promise<void>}
 */
export async function saveProfile(profile) {
    await invoke("save_profile", { profile });
    cachedProfile = profile;
}

/**
 * Get the cached profile synchronously.
 * Returns null if profile hasn't been loaded yet.
 * Use getProfile() to load the profile first.
 * @returns {Object|null} The cached profile or null
 */
export function getCachedProfile() {
    return cachedProfile;
}

/**
 * Get the author ID for patch attribution.
 * Returns the profile ID if available, otherwise a temporary ID.
 * Note: The profile should be initialized via initProfile() before calling this.
 * @returns {string} The author ID
 */
export function getAuthorId() {
    if (cachedProfile && cachedProfile.id) {
        return cachedProfile.id;
    }
    // Fallback to "local" if profile hasn't been loaded yet
    // This ensures backwards compatibility and prevents errors
    console.warn("Profile not loaded yet, using 'local' as author ID");
    return "local";
}

/**
 * Get the current user's ID and name for review attribution.
 * Returns safe defaults if profile hasn't been loaded.
 * @returns {{ id: string, name: string }} The current user info
 */
export function getCurrentUserInfo() {
    return {
        id: cachedProfile?.id || 'local',
        name: cachedProfile?.name || 'Local User'
    };
}

/**
 * Initialize the profile on app startup.
 * Loads and caches the profile.
 * @returns {Promise<Object>} The loaded profile
 */
export async function initProfile() {
    return await getProfile();
}
