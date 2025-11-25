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
    Conflict,
};
use canonical_path::CanonicalPathBuf;
use libpijul::pristine::{Inode, InodeMetadata};
use libpijul::working_copy::WorkingCopyRead;

use crate::models::*;

// A dummy WorkingCopy that does nothing.
// This allows us to run `output_repository_no_pending` to detect conflicts
// without actually touching the file system.
#[derive(Clone, Copy)]
struct FakeWorkingCopy;

impl WorkingCopyRead for FakeWorkingCopy {
    type Error = std::io::Error;

    fn file_metadata(&self, _file: &str) -> Result<InodeMetadata, Self::Error> {
        unimplemented!("file_metadata()")
    }

    fn read_file(&self, _file: &str, _buffer: &mut Vec<u8>) -> Result<(), Self::Error> {
        unimplemented!("file_read()")
    }

    fn modified_time(&self, _file: &str) -> Result<std::time::SystemTime, Self::Error> {
        unimplemented!("modified_time")
    }
}

impl WorkingCopy for FakeWorkingCopy {
    fn create_dir_all(&self, _path: &str) -> Result<(), Self::Error> {
        Ok(())
    }
    fn remove_path(&self, _name: &str, _rec: bool) -> Result<(), Self::Error> {
        Ok(())
    }
    fn rename(&self, _former: &str, _new: &str) -> Result<(), Self::Error> {
        Ok(())
    }
    fn set_permissions(&self, _name: &str, _permissions: u16) -> Result<(), Self::Error> {
        Ok(())
    }

    type Writer = std::io::Sink;
    fn write_file(&self, _file: &str, _inode: Inode) -> Result<Self::Writer, Self::Error> {
        Ok(std::io::sink())
    }
}

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

/// Simulate and detect conflicts using an in-memory `FakeWorkingCopy`.
pub fn simulate_conflict(repo_path: &Path) -> Result<ConflictInfo> {
    let (pristine, _, change_store) = open_repo(repo_path)?;

    // 1. BASE: Define the initial state of the document.
    let doc_path = repo_path.join("document.md");
    fs::write(&doc_path, "The quick brown fox jumps over the lazy dog.")?;
    record_all(repo_path, "Base document", Some("document.md"))?;

    // 2. FORK: Create a new channel 'dev' from 'main'.
    {
        let mut txn = pristine.mut_txn_begin()?;
        let main_channel = txn.open_or_create_channel("main")?;
        txn.fork(&main_channel, "dev")?;
        txn.commit()?;
    }

    // 3. MAIN EDIT: On the 'main' channel, change 'lazy' to 'sleepy'.
    fs::write(&doc_path, "The quick brown fox jumps over the sleepy dog.")?;
    record_all(repo_path, "Change lazy to sleepy", Some("document.md"))?;

    // Revert working copy to the base state of the 'dev' channel for the next recording.
    {
        let (pristine, working_copy, change_store) = open_repo(repo_path)?;
        let txn = pristine.txn_begin()?;
        let dev_channel = txn.load_channel("dev")?.ok_or_else(|| anyhow!("Channel 'dev' not found"))?;
        libpijul::output::output_repository_no_pending(&working_copy, &change_store, &txn, &dev_channel, &repo_path.to_string_lossy(), true, None, 1, 0)?;
    }

    // 4. DEV EDIT: On the 'dev' channel, change 'lazy' to 'tired', creating a conflict.
    fs::write(&doc_path, "The quick brown fox jumps over the tired dog.")?;
    let dev_hash = record_on_channel(repo_path, "dev", "Change lazy to tired", Some("document.md"))?;

    // 5. MERGE & DETECT: Apply the change from 'dev' to 'main' in a dry run.
    let conflicts = {
        let mut txn = pristine.mut_txn_begin()?;
        let mut main_channel = txn.open_or_create_channel("main")?;

        // Apply the change, which may introduce conflicts into the channel's state.
        txn.apply_change(&change_store, &mut main_channel, &dev_hash)?;

        // Use FakeWorkingCopy to detect conflicts without modifying the filesystem.
        let conflicts = libpijul::output::output_repository_no_pending(
            &FakeWorkingCopy,
            &change_store,
            &txn,
            &main_channel,
            "",   // prefix
            true, // full paths
            None,
            1,    // num_threads
            0,
        )?;

        // No commit is needed as this is a read-only detection phase.
        conflicts
    };

    // 6. PARSE CONFLICTS: Map the structured conflict data from the API to our model.
    let locations = parse_conflicts(conflicts)?;

    Ok(ConflictInfo {
        has_conflict: !locations.is_empty(),
        locations,
    })
}

/// Parses a vector of `libpijul::Conflict` into a vector of `ConflictLocation`.
fn parse_conflicts(conflicts: Vec<Conflict>) -> Result<Vec<ConflictLocation>> {
    let mut locations = Vec::new();
    for c in conflicts {
        let (path, line, conflict_type, description) = match c {
            Conflict::Name { path, .. } => (path, None, "Name", "Conflict on a file name or path.".to_string()),
            Conflict::Order { path, line, .. } => (path, Some(line), "Order", "Two edits at the same location.".to_string()),
            Conflict::Zombie { path, line, .. } => (path, Some(line), "Zombie", "A line was edited after being deleted.".to_string()),
            Conflict::ZombieFile { path, .. } => (path, None, "ZombieFile", "A file was edited after being deleted.".to_string()),
            Conflict::Cyclic { path, line, .. } => (path, Some(line), "Cyclic", "An edit depends on itself.".to_string()),
            Conflict::MultipleNames { path, names, .. } => {
                let desc = format!("File has multiple conflicting names: {:?}", names);
                (path, None, "MultipleNames", desc)
            }
        };
        locations.push(ConflictLocation {
            path,
            line,
            conflict_type: conflict_type.to_string(),
            description,
        });
    }
    Ok(locations)
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
        init_repository(temp.path()).unwrap();

        // Run the conflict simulation logic.
        let result = simulate_conflict(temp.path());

        // Assert that the operation completed without panicking.
        assert!(result.is_ok(), "simulate_conflict should not return an error");

        let conflicts = result.unwrap();

        // Assert that a conflict was detected.
        assert!(conflicts.has_conflict, "A conflict should have been detected");

        // Assert that exactly one conflict location was reported for this specific simulation.
        assert_eq!(conflicts.locations.len(), 1, "There should be exactly one conflict location");

        // Assert that the conflict details are what we expect.
        let location = &conflicts.locations[0];
        assert_eq!(location.path, "document.md");
        assert_eq!(location.conflict_type, "Order");
        assert!(location.line.is_some(), "Line number should be present for an Order conflict");
    }
}
