use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::fs;
use log;
use chrono::Utc;

use libpijul::{
    changestore::filesystem::FileSystem as FileChangeStore,
    working_copy::filesystem::FileSystem as FileWorkingCopy,
    pristine::sanakirja::Pristine,
    pristine::{MutTxnT, TxnT, GraphTxnT, ChannelTxnT, TreeTxnT, Base32, ChangeId},
    changestore::ChangeStore,
    working_copy::WorkingCopy,
    TxnTExt, MutTxnTExt,
    RecordBuilder, Algorithm,
    Hash,
};
use canonical_path::CanonicalPathBuf;

use crate::models::*;

/// Get or create a test repository path
// NOTE: This uses a fixed path in the system's temp directory.
// This is simple for a prototype, but means that multiple instances of the app
// (or concurrent tests) will interfere with each other. A real application
// would use a unique path per session or per user.
pub fn get_test_repo_path() -> Result<PathBuf> {
    let temp_dir = std::env::temp_dir();
    let repo_path = temp_dir.join("korppi-test-repo");

    // Create if doesn't exist
    if !repo_path.exists() {
        fs::create_dir_all(&repo_path)?;
    }

    Ok(repo_path)
}

/// Initialize a Pijul repository
pub fn init_repository(path: &Path) -> Result<()> {
    let pijul_dir = path.join(".pijul");
    if pijul_dir.exists() {
        fs::remove_dir_all(&pijul_dir)?;
    }
    fs::create_dir_all(&pijul_dir)?;

    let pristine_dir = pijul_dir.join("pristine");
    fs::create_dir_all(&pristine_dir)?;

    let db_path = pristine_dir.join("db");
    let pristine = Pristine::new(&db_path)?;

    let changes_dir = pijul_dir.join("changes");
    FileChangeStore::from_changes(changes_dir, 100);

    // Create main channel
    let mut txn = pristine.mut_txn_begin()?;
    txn.open_or_create_channel("main")?;
    txn.commit()?;

    Ok(())
}

/// Verify that a repository is properly initialized
pub fn verify_repository(path: &Path) -> Result<bool> {
    let pijul_dir = path.join(".pijul");
    if !pijul_dir.exists() { return Ok(false); }
    if !pijul_dir.join("pristine").exists() { return Ok(false); }
    if !pijul_dir.join("changes").exists() { return Ok(false); }
    let db_path = pijul_dir.join("pristine/db");
    if !db_path.exists() { return Ok(false); }

    let pristine = Pristine::new(&db_path)?;
    let txn = pristine.txn_begin()?;
    Ok(txn.load_channel("main")?.is_some())
}

// Helper to open repo components
fn open_repo(path: &Path) -> Result<(Pristine, FileWorkingCopy, FileChangeStore)> {
    let pijul_dir = path.join(".pijul");
    let pristine_dir = pijul_dir.join("pristine");
    let db_path = pristine_dir.join("db");

    let pristine = Pristine::new(&db_path)?;
    let working_copy = FileWorkingCopy::from_root(path);
    let change_store = FileChangeStore::from_changes(pijul_dir.join("changes"), 100);

    Ok((pristine, working_copy, change_store))
}

// Helper: Record all changes
fn record_all(
    repo_path: &Path,
    message: &str,
    file_to_add: Option<&str>
) -> Result<Hash> {
    let (pristine, working_copy, change_store) = open_repo(repo_path)?;

    let mut txn = pristine.mut_txn_begin()?;
    let mut channel = txn.open_or_create_channel("main")?;

    if let Some(file) = file_to_add {
        if !txn.is_tracked(file)? {
             txn.add_file(file, 0)?;
        }
    }

    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_path)?;

    working_copy.record_prefix(
        &mut txn,
        Algorithm::default(),
        &mut channel,
        &change_store,
        &mut builder,
        canonical_root,
        Path::new(""),
        false, // force
        1, // threads
        0, // salt
    )?;

    let recorded = builder.finish();
    if recorded.actions.is_empty() {
        return Err(anyhow!("No changes to record"));
    }

    let actions = recorded
        .actions
        .into_iter()
        .map(|r| {
            r.globalize(&txn)
                .map_err(|e| anyhow!("Failed to globalize recorded action: {}", e))
        })
        .collect::<Result<Vec<_>>>()?;

    let mut contents_lock = recorded.contents.lock();
    let contents = std::mem::take(&mut *contents_lock);

    let mut change = libpijul::change::Change::make_change(
        &txn,
        &channel,
        actions,
        contents,
        libpijul::change::ChangeHeader {
            message: message.to_string(),
            authors: vec![],
            description: None,
            timestamp: Utc::now(),
        },
        Vec::new(),
    )?;

    let hash = change_store.save_change(&mut change, |_, _| Ok::<_, anyhow::Error>(()))?;

    txn.apply_local_change(
        &channel,
        &change,
        &hash,
        &recorded.updatables,
    )?;

    txn.commit()?;

    Ok(hash)
}

/// Record a change to the repository
pub fn record_change(repo_path: &Path, content: &str, message: &str) -> Result<String> {
    let doc_path = repo_path.join("document.md");
    fs::write(&doc_path, content)
        .context("Failed to write document")?;

    match record_all(repo_path, message, Some("document.md")) {
        Ok(hash) => Ok(hash.to_base32().to_string()),
        Err(e) => {
            if e.to_string().contains("No changes") {
                 Ok("no_change".to_string())
            } else {
                Err(e)
            }
        }
    }
}

/// Get history of patches
pub fn get_patch_history(repo_path: &Path) -> Result<Vec<PatchInfo>> {
    let (pristine, _, change_store) = open_repo(repo_path)?;
    let txn = pristine.txn_begin()?;
    let channel = txn.load_channel("main")?
        .ok_or(anyhow!("Channel main not found"))?;
    let channel_lock = channel.read();

    let mut history = Vec::new();

    for h in txn.changeid_reverse_log(&*channel_lock, None)? {
        let (hash_id, _merkle) = h?;
        let id = ChangeId(*hash_id);
        let external_hash = txn
            .get_external(&id)?
            .ok_or_else(|| anyhow!("No external hash for change id {:?}", id))?;
        let h: Hash = external_hash.into();

        match change_store.get_header(&h) {
            Ok(header) => {
                history.push(PatchInfo {
                    hash: h.to_base32().to_string(),
                    description: header.message,
                    timestamp: header.timestamp.to_rfc3339(),
                });
            },
            Err(e) => {
                log::warn!(
                    "Failed to get header for change {}: {}",
                    h.to_base32().to_string(),
                    e
                );
            }
        }
    }

    Ok(history)
}

/// Simulate and detect conflicts
pub fn simulate_conflict(repo_path: &Path) -> Result<ConflictInfo> {
    // Re-open repo components to ensure fresh state for each step.
    let (pristine, _, _) = open_repo(repo_path)?;

    // 1. BASE: Define the initial state of the document.
    let doc_path = repo_path.join("document.md");
    fs::write(&doc_path, "The quick brown fox jumps over the lazy dog.")?;
    record_all(repo_path, "Base document", Some("document.md"))?;

    // 2. FORK: Create a new channel 'dev' from 'main'.
    {
        let mut txn = pristine.mut_txn_begin()?;
        let main_channel = txn.open_or_create_channel("main")?;
        // Forking creates a new channel with the same history as 'main'.
        txn.fork(&main_channel, "dev")?;
        txn.commit()?;
    }

    // 3. MAIN EDIT: On the 'main' channel, change 'lazy' to 'sleepy'.
    fs::write(&doc_path, "The quick brown fox jumps over the sleepy dog.")?;
    // This change is recorded on the 'main' channel.
    record_all(repo_path, "Change lazy to sleepy", Some("document.md"))?;

    // Before making the dev edit, we must revert the working copy to the base state of the 'dev' channel.
    // This is crucial because Pijul's recording mechanism works relative to the current files on disk.
    // First, output the state of the 'dev' channel to the working copy.
    {
        let (pristine, working_copy, change_store) = open_repo(repo_path)?;
        let txn = pristine.txn_begin()?;
        let dev_channel = txn.load_channel("dev")?.ok_or_else(|| anyhow!("Channel 'dev' not found"))?;
        libpijul::output::output_repository_no_pending(
            &working_copy,
            &change_store,
            &txn,
            &dev_channel,
            &repo_path.to_string_lossy(),
            true,
            None,
            1,
            0,
        )?;
    }

    // 4. DEV EDIT: On the 'dev' channel, change 'lazy' to 'tired'.
    // This edit is made to the same line as the 'main' edit, creating a conflict.
    fs::write(&doc_path, "The quick brown fox jumps over the tired dog.")?;
    // Record this change specifically on the 'dev' channel.
    let dev_hash = record_on_channel(repo_path, "dev", "Change lazy to tired", Some("document.md"))?;

    // 5. MERGE: Apply the change from 'dev' onto 'main'.
    let conflicts = {
        let (pristine, working_copy, change_store) = open_repo(repo_path)?;
        let mut txn = pristine.mut_txn_begin()?;
        let mut main_channel = txn.open_or_create_channel("main")?;

        // Applying the change from 'dev' to 'main'. Pijul will detect the conflict here.
        txn.apply_change(&change_store, &mut main_channel, &dev_hash)?;

        // After applying, we output the state of the 'main' channel to get the conflict markers.
        libpijul::output::output_repository_no_pending(
            &working_copy,
            &change_store,
            &txn,
            &main_channel,
            &repo_path.to_string_lossy(),
            true,
            None,
            1,
            0,
        )?;

        txn.commit()?;

        // The conflict information is now present in the working copy file.
        fs::read_to_string(&doc_path)?
    };

    // 6. PARSE CONFLICTS: Instead of inspecting the API, we parse the conflict markers from the file.
    let mut locations = Vec::new();
    let has_conflict = conflicts.contains("<<<<<<<");

    if has_conflict {
        // NOTE: This parser assumes libpijul writes Git-style conflict markers
        // (<<<<<<<, =======, >>>>>>>) into the working copy. If that changes,
        // this logic must be updated.
        let mut current_options = Vec::new();
        let mut in_conflict = false;
        let mut line_number = 0;

        for line in conflicts.lines() {
            line_number += 1;
            if line.starts_with("<<<<<<<") {
                in_conflict = true;
            } else if line.starts_with("=======") {
                // Separator between conflict options.
            } else if line.starts_with(">>>>>>>") {
                in_conflict = false;
                locations.push(ConflictLocation {
                    line: line_number - current_options.len(), // Approximate line number.
                    options: current_options.clone(),
                });
                current_options.clear();
            } else if in_conflict {
                current_options.push(line.to_string());
            }
        }
    }

    Ok(ConflictInfo {
        has_conflict,
        locations,
    })
}

// Helper for recording on specific channel
fn record_on_channel(repo_path: &Path, channel_name: &str, message: &str, file_to_add: Option<&str>) -> Result<Hash> {
    let (pristine, working_copy, change_store) = open_repo(repo_path)?;

    let mut txn = pristine.mut_txn_begin()?;
    let mut channel = txn.open_or_create_channel(channel_name)?;

    if let Some(file) = file_to_add {
        if !txn.is_tracked(file)? {
             txn.add_file(file, 0)?;
        }
    }

    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_path)?;

    working_copy.record_prefix(
        &mut txn,
        Algorithm::default(),
        &mut channel,
        &change_store,
        &mut builder,
        canonical_root,
        Path::new(""),
        false,
        1,
        0,
    )?;

    let recorded = builder.finish();
    if recorded.actions.is_empty() {
        return Err(anyhow!("No changes to record on {}", channel_name));
    }

    let actions = recorded.actions.into_iter()
        .map(|r| r.globalize(&txn).unwrap())
        .collect();

    let mut contents_lock = recorded.contents.lock();
    let contents = std::mem::take(&mut *contents_lock);

    let mut change = libpijul::change::Change::make_change(
        &txn,
        &channel,
        actions,
        contents,
        libpijul::change::ChangeHeader {
            message: message.to_string(),
            authors: vec![],
            description: None,
            timestamp: Utc::now(),
        },
        Vec::new(),
    )?;

    let hash = change_store.save_change(&mut change, |_, _| Ok::<_, anyhow::Error>(()))?;

    txn.apply_local_change(
        &channel,
        &change,
        &hash,
        &recorded.updatables,
    )?;

    txn.commit()?;
    Ok(hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_init_repository() {
        let temp = TempDir::new().unwrap();
        let result = init_repository(temp.path());
        assert!(result.is_ok());
        assert!(temp.path().join(".pijul").exists());
    }

    #[test]
    fn test_conflict_simulation() {
        // Using a temporary directory for an isolated test environment.
        let temp = TempDir::new().unwrap();
        // 1. Initialize a new repository in the temporary directory.
        init_repository(temp.path()).unwrap();

        // 2. Run the conflict simulation logic.
        let result = simulate_conflict(temp.path());

        // 3. Assert that the operation completed without panicking.
        assert!(result.is_ok(), "simulate_conflict should not return an error");

        // 4. Unwrap the result to get the conflict information.
        let conflicts = result.unwrap();

        // 5. Assert that a conflict was actually detected.
        // This is the core success criterion for Day 3.
        assert!(conflicts.has_conflict, "A conflict should have been detected");

        // 6. Assert that at least one conflict location was reported.
        assert!(!conflicts.locations.is_empty(), "Conflict locations should not be empty");

        // 7. Assert that the conflict location has at least two options to choose from.
        let location = &conflicts.locations[0];
        assert!(location.options.len() >= 2, "Conflict should have at least two options");

        // 8. Assert that the options are not the same, meaning a real conflict was found.
        assert_ne!(location.options[0], location.options[1], "Conflict options should be different");
    }
}
