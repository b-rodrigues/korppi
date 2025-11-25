use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use log;
use std::fs;
use std::path::{Path, PathBuf};

use libpijul::{
    changestore::filesystem::FileSystem as FileChangeStore,
    changestore::ChangeStore,
    pristine::sanakirja::Pristine,
    pristine::{Base32, ChangeId, ChannelTxnT, GraphTxnT, MutTxnT, TreeTxnT, TxnT},
    working_copy::filesystem::FileSystem as FileWorkingCopy,
    working_copy::{WorkingCopy, WorkingCopyRead},
    Hash, MutTxnTExt, RecordBuilder, TxnTExt, Algorithm,
};
use canonical_path::CanonicalPathBuf;

use crate::models::*;

/// A fake working copy that allows us to call `output_repository_no_pending`
/// and get a list of `Conflict`s without touching the real working copy.
#[derive(Clone, Copy)]
struct FakeWorkingCopy;

impl WorkingCopyRead for FakeWorkingCopy {
    type Error = std::io::Error;

    fn file_metadata(
        &self,
        _file: &str,
    ) -> Result<libpijul::pristine::InodeMetadata, Self::Error> {
        unimplemented!("file_metadata() not needed for conflict listing");
    }

    fn read_file(&self, _file: &str, _buffer: &mut Vec<u8>) -> Result<(), Self::Error> {
        unimplemented!("read_file() not needed for conflict listing");
    }

    fn modified_time(&self, _file: &str) -> Result<std::time::SystemTime, Self::Error> {
        unimplemented!("modified_time() not needed for conflict listing");
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

    fn write_file(
        &self,
        _file: &str,
        _inode: libpijul::pristine::Inode,
    ) -> Result<Self::Writer, Self::Error> {
        Ok(std::io::sink())
    }
}

/// Get or create a test repository path
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
    if !pijul_dir.exists() {
        return Ok(false);
    }
    if !pijul_dir.join("pristine").exists() {
        return Ok(false);
    }
    if !pijul_dir.join("changes").exists() {
        return Ok(false);
    }
    let db_path = pijul_dir.join("pristine/db");
    if !db_path.exists() {
        return Ok(false);
    }

    let pristine = Pristine::new(&db_path)?;
    let txn = pristine.txn_begin()?;
    Ok(txn.load_channel("main")?.is_some())
}

/// Helper to open repo components with basic validation
fn open_repo(path: &Path) -> Result<(Pristine, FileWorkingCopy, FileChangeStore)> {
    let pijul_dir = path.join(".pijul");
    if !pijul_dir.exists() {
        return Err(anyhow!(
            "Repository not initialized: missing .pijul directory at {:?}",
            pijul_dir
        ));
    }

    let pristine_dir = pijul_dir.join("pristine");
    let db_path = pristine_dir.join("db");
    let changes_dir = pijul_dir.join("changes");

    if !pristine_dir.exists() || !db_path.exists() || !changes_dir.exists() {
        return Err(anyhow!(
            "Repository structure incomplete under {:?}",
            pijul_dir
        ));
    }

    let pristine = Pristine::new(&db_path)?;
    let working_copy = FileWorkingCopy::from_root(path);
    let change_store = FileChangeStore::from_changes(changes_dir, 100);

    Ok((pristine, working_copy, change_store))
}

/// Internal helper: record a change using existing repo handles
fn record_generic_with_handles(
    pristine: &Pristine,
    working_copy: &FileWorkingCopy,
    change_store: &FileChangeStore,
    repo_path: &Path,
    channel_name: &str,
    message: &str,
    file_to_add: Option<&str>,
) -> Result<Hash> {
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
        false, // force
        1,     // threads
        0,     // salt
    )?;

    let recorded = builder.finish();
    if recorded.actions.is_empty() {
        return Err(anyhow!("No changes to record on channel {}", channel_name));
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

    txn.apply_local_change(&channel, &change, &hash, &recorded.updatables)?;

    txn.commit()?;

    Ok(hash)
}

/// Public helper: record on any channel by name
fn record_generic(
    repo_path: &Path,
    channel_name: &str,
    message: &str,
    file_to_add: Option<&str>,
) -> Result<Hash> {
    let (pristine, working_copy, change_store) = open_repo(repo_path)?;
    record_generic_with_handles(
        &pristine,
        &working_copy,
        &change_store,
        repo_path,
        channel_name,
        message,
        file_to_add,
    )
}

/// Helper: record on main channel
fn record_all(repo_path: &Path, message: &str, file_to_add: Option<&str>) -> Result<Hash> {
    record_generic(repo_path, "main", message, file_to_add)
}

/// Helper: record on a specific channel
fn record_on_channel(
    repo_path: &Path,
    channel_name: &str,
    message: &str,
    file_to_add: Option<&str>,
) -> Result<Hash> {
    record_generic(repo_path, channel_name, message, file_to_add)
}

/// Record a change to the repository via the "document.md" file
pub fn record_change(repo_path: &Path, content: &str, message: &str) -> Result<String> {
    let doc_path = repo_path.join("document.md");
    fs::write(&doc_path, content).context("Failed to write document")?;

    match record_all(repo_path, message, Some("document.md")) {
        Ok(hash) => Ok(hash.to_base32().to_string()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("No changes to record") {
                Ok("no_change".to_string())
            } else {
                Err(e)
            }
        }
    }
}

/// Get history of patches
pub fn get_patch_history(repo_path: &Path) -> Result<Vec<PatchInfo>> {
    let (pristine, _working_copy, change_store) = open_repo(repo_path)?;
    let txn = pristine.txn_begin()?;
    let channel = txn
        .load_channel("main")?
        .ok_or_else(|| anyhow!("Channel 'main' not found"))?;
    let channel_lock = channel.read();

    let mut history = Vec::new();

    for h in txn.changeid_reverse_log(&*channel_lock, None)? {
        let (hash_id, _merkle) = h?;

        let id = ChangeId(*hash_id);
        let external_hash_opt = txn.get_external(&id)?;
        let external_hash = external_hash_opt
            .ok_or_else(|| anyhow!("No external hash for change id {:?}", id))?;
        let h: Hash = external_hash.into();

        match change_store.get_header(&h) {
            Ok(header) => {
                history.push(PatchInfo {
                    hash: h.to_base32().to_string(),
                    description: header.message,
                    timestamp: header.timestamp.to_rfc3339(),
                });
            }
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

/// Simulate and detect conflicts using libpijul::Conflict, without
/// relying on textual conflict markers in the working copy.
pub fn simulate_conflict(repo_path: &Path) -> Result<ConflictInfo> {
    // Open repo handles once for the whole operation
    let (pristine, working_copy, change_store) = open_repo(repo_path)?;

    // 1. BASE: initial document
    let doc_path = repo_path.join("document.md");
    fs::write(
        &doc_path,
        "The quick brown fox jumps over the lazy dog.",
    )?;
    record_generic_with_handles(
        &pristine,
        &working_copy,
        &change_store,
        repo_path,
        "main",
        "Base document",
        Some("document.md"),
    )?;

    // 2. FORK: create 'dev' channel from 'main'
    {
        let mut txn = pristine.mut_txn_begin()?;
        let main_channel = txn.open_or_create_channel("main")?;
        txn.fork(&main_channel, "dev")?;
        txn.commit()?;
    }

    // 3. MAIN EDIT: lazy -> sleepy on main
    fs::write(
        &doc_path,
        "The quick brown fox jumps over the sleepy dog.",
    )?;
    record_generic_with_handles(
        &pristine,
        &working_copy,
        &change_store,
        repo_path,
        "main",
        "Change lazy to sleepy",
        Some("document.md"),
    )?;

    // 4. DEV EDIT:
    //    Rewind working copy to 'dev' channel snapshot, then lazy -> tired.
    {
        let txn = pristine.txn_begin()?;
        let dev_channel = txn
            .load_channel("dev")?
            .ok_or_else(|| anyhow!("Channel 'dev' not found"))?;

        // Output dev channel to the *real* working copy (no pending)
        let _ = libpijul::output::output_repository_no_pending(
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

    fs::write(
        &doc_path,
        "The quick brown fox jumps over the tired dog.",
    )?;
    let dev_hash = record_generic_with_handles(
        &pristine,
        &working_copy,
        &change_store,
        repo_path,
        "dev",
        "Change lazy to tired",
        Some("document.md"),
    )?;

    // 5. MERGE: apply dev change onto main, but use FakeWorkingCopy to get
    //    structured conflicts without touching the working copy on disk.
    let conflicts_vec = {
        let mut txn = pristine.mut_txn_begin()?;
        let mut main_channel = txn.open_or_create_channel("main")?;

        txn.apply_change(&change_store, &mut main_channel, &dev_hash)?;

        let conflicts = libpijul::output::output_repository_no_pending(
            &FakeWorkingCopy,
            &change_store,
            &txn,
            &main_channel,
            "",
            true,
            None,
            1,
            0,
        )?;

        txn.commit()?;
        conflicts
    };

    // 6. Map libpijul::Conflict into UI-friendly ConflictInfo
    use libpijul::Conflict as PijulConflict;

    let mut locations = Vec::new();

    for c in conflicts_vec {
        match c {
            PijulConflict::Name { path, .. } => {
                locations.push(ConflictLocation {
                    line: 0,
                    options: vec![format!("name conflict at {}", path)],
                });
            }
            PijulConflict::Order { path, line, .. } => {
                locations.push(ConflictLocation {
                    line: line as usize,
                    options: vec![format!("order conflict at {}:{}", path, line)],
                });
            }
            PijulConflict::Zombie { path, line, .. } => {
                locations.push(ConflictLocation {
                    line: line as usize,
                    options: vec![format!("zombie conflict at {}:{}", path, line)],
                });
            }
            PijulConflict::ZombieFile { path, .. } => {
                locations.push(ConflictLocation {
                    line: 0,
                    options: vec![format!("zombie file conflict at {}", path)],
                });
            }
            PijulConflict::Cyclic { path, line, .. } => {
                locations.push(ConflictLocation {
                    line: line as usize,
                    options: vec![format!("cyclic conflict at {}:{}", path, line)],
                });
            }
            PijulConflict::MultipleNames { path, names, .. } => {
                locations.push(ConflictLocation {
                    line: 0,
                    options: vec![format!("multiple names for {}: {:?}", path, names)],
                });
            }
        }
    }

    Ok(ConflictInfo {
        has_conflict: !locations.is_empty(),
        locations,
    })
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
        let temp = TempDir::new().unwrap();
        init_repository(temp.path()).unwrap();

        let result = simulate_conflict(temp.path());
        assert!(result.is_ok(), "simulate_conflict should not return an error");

        let conflicts = result.unwrap();
        assert!(conflicts.has_conflict, "A conflict should have been detected");
        assert!(
            !conflicts.locations.is_empty(),
            "Conflict locations should not be empty"
        );
    }
}
