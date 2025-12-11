// src-tauri/src/profile.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,             // UUID
    pub name: String,
    pub email: Option<String>,
    pub avatar_path: Option<PathBuf>,
    pub color: String,          // Hex color e.g., "#3498db"
}

impl Default for UserProfile {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: String::new(),
            email: None,
            avatar_path: None,
            color: "#3498db".to_string(),
        }
    }
}

/// Get the config directory path for the application
fn get_config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("korppi"))
        .ok_or_else(|| "Could not determine config directory".to_string())
}

/// Get the profile file path
fn get_profile_file_path() -> Result<PathBuf, String> {
    get_config_dir().map(|p| p.join("profile.toml"))
}

/// Load profile from disk, return default if not exists
#[tauri::command]
pub fn get_profile(_app: AppHandle) -> Result<UserProfile, String> {
    let path = get_profile_file_path()?;
    
    if !path.exists() {
        return Ok(UserProfile::default());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read profile: {}", e))?;
    
    toml::from_str(&content)
        .map_err(|e| format!("Failed to parse profile: {}", e))
}

/// Save profile to disk
#[tauri::command]
pub fn save_profile(_app: AppHandle, profile: UserProfile) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    let path = config_dir.join("profile.toml");
    
    // Ensure config directory exists
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let content = toml::to_string_pretty(&profile)
        .map_err(|e| format!("Failed to serialize profile: {}", e))?;
    
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write profile: {}", e))?;
    
    Ok(())
}

/// Return the config directory path (for avatar storage)
#[tauri::command]
pub fn get_profile_path(_app: AppHandle) -> Result<PathBuf, String> {
    get_config_dir()
}

/// Export the current profile to the specified path
#[tauri::command]
pub fn export_profile(_app: AppHandle, path: PathBuf) -> Result<(), String> {
    let profile_path = get_profile_file_path()?;
    
    if !profile_path.exists() {
        return Err("No profile found to export".to_string());
    }
    
    fs::copy(&profile_path, &path)
        .map_err(|e| format!("Failed to export profile: {}", e))?;
        
    Ok(())
}

/// Import a profile from the specified path
#[tauri::command]
pub fn import_profile(_app: AppHandle, path: PathBuf) -> Result<(), String> {
    let profile_path = get_profile_file_path()?;
    let config_dir = get_config_dir()?;
    
    // Ensure config directory exists
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    // Validate that the file is a valid profile
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;
        
    let _profile: UserProfile = toml::from_str(&content)
        .map_err(|e| format!("Invalid profile file: {}", e))?;
    
    // Copy the file
    fs::copy(&path, &profile_path)
        .map_err(|e| format!("Failed to import profile: {}", e))?;
        
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_temp_profile_path() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let profile_path = temp_dir.path().join("profile.toml");
        (temp_dir, profile_path)
    }

    #[test]
    fn test_user_profile_default() {
        let profile = UserProfile::default();
        assert!(!profile.id.is_empty());
        assert!(profile.name.is_empty());
        assert!(profile.email.is_none());
        assert!(profile.avatar_path.is_none());
        assert_eq!(profile.color, "#3498db");
        // Validate UUID format
        assert!(Uuid::parse_str(&profile.id).is_ok());
    }

    #[test]
    fn test_user_profile_serialization() {
        let profile = UserProfile {
            id: "test-uuid".to_string(),
            name: "Test User".to_string(),
            email: Some("test@example.com".to_string()),
            avatar_path: Some(PathBuf::from("/path/to/avatar.png")),
            color: "#ff5500".to_string(),
        };

        let toml_str = toml::to_string_pretty(&profile).unwrap();
        let parsed: UserProfile = toml::from_str(&toml_str).unwrap();

        assert_eq!(parsed.id, profile.id);
        assert_eq!(parsed.name, profile.name);
        assert_eq!(parsed.email, profile.email);
        assert_eq!(parsed.avatar_path, profile.avatar_path);
        assert_eq!(parsed.color, profile.color);
    }

    #[test]
    fn test_user_profile_roundtrip_file() {
        let (_temp_dir, profile_path) = create_temp_profile_path();
        
        let profile = UserProfile {
            id: Uuid::new_v4().to_string(),
            name: "Test User".to_string(),
            email: Some("test@example.com".to_string()),
            avatar_path: None,
            color: "#aabbcc".to_string(),
        };

        // Write to file
        let content = toml::to_string_pretty(&profile).unwrap();
        std::fs::write(&profile_path, &content).unwrap();

        // Read back
        let loaded_content = std::fs::read_to_string(&profile_path).unwrap();
        let loaded: UserProfile = toml::from_str(&loaded_content).unwrap();

        assert_eq!(loaded.id, profile.id);
        assert_eq!(loaded.name, profile.name);
        assert_eq!(loaded.email, profile.email);
        assert_eq!(loaded.color, profile.color);
    }

    #[test]
    fn test_user_profile_minimal_toml() {
        // Test that we can parse a minimal TOML file
        let toml_content = "id = \"uuid-123\"\nname = \"Minimal User\"\ncolor = \"#123456\"";

        let profile: UserProfile = toml::from_str(toml_content).unwrap();
        assert_eq!(profile.id, "uuid-123");
        assert_eq!(profile.name, "Minimal User");
        assert!(profile.email.is_none());
        assert!(profile.avatar_path.is_none());
        assert_eq!(profile.color, "#123456");
    }
}
