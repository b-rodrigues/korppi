use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::fs;
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
    // 1. Create .pijul directory
    let pijul_dir = path.join(".pijul");
    if pijul_dir.exists() {
        fs::remove_dir_all(&pijul_dir)?;
    }
    fs::create_dir_all(&pijul_dir)?;

    // 2. Initialize Pristine (DB)
    let pristine_dir = pijul_dir.join("pristine");
    fs::create_dir_all(&pristine_dir)?;

    let db_path = pristine_dir.join("db");
    Pristine::new_with_size(&db_path, 10 * 1024 * 1024)?;

    // 3. Initialize ChangeStore
    let changes_dir = pijul_dir.join("changes");
    FileChangeStore::from_changes(changes_dir, 100);

    Ok(())
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

    // Ensure channel exists
    let mut txn = pristine.mut_txn_begin()?;
    let _channel = txn.open_or_create_channel("main")?;
    txn.commit()?;

    // Record using ArcTxn
    let txn = pristine.arc_txn_begin()?;
    let channel = txn.write().open_or_create_channel("main")?;

    // Explicitly add file if requested and not tracked
    if let Some(file) = file_to_add {
        if !txn.read().is_tracked(file).unwrap_or(false) {
             txn.write().add_file(file, 0)?;
        }
    }

    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_path)?;

    // Record prefix (root)
    working_copy.record_prefix(
        txn.clone(),
        Algorithm::default(),
        channel.clone(),
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

    let actions = recorded.actions.into_iter()
        .map(|r| r.globalize(&*txn.read()).unwrap())
        .collect();

    let mut contents_lock = recorded.contents.lock();
    let contents = std::mem::take(&mut *contents_lock);

    let mut change = libpijul::change::Change::make_change(
        &*txn.read(),
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

    // Apply the change
    txn.write().apply_local_change(
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

    // Iterate reverse log
    for h in txn.changeid_reverse_log(&*channel_lock, None)? {
        let (hash_id, _merkle) = h?;

        let id = ChangeId(*hash_id);
        let external_hash = txn.get_external(&id)?.unwrap();
        let h: Hash = external_hash.into();

        // Try to get header, log error but don't fail completely
        match change_store.get_header(&h) {
            Ok(header) => {
                history.push(PatchInfo {
                    hash: h.to_base32().to_string(),
                    description: header.message,
                    timestamp: header.timestamp.to_rfc3339(),
                });
            },
            Err(e) => {
                println!("⚠️ Warning: Could not retrieve patch {}: {}", h.to_base32().to_string(), e);
            }
        }
    }

    Ok(history)
}

/// Simulate and detect conflicts
pub fn simulate_conflict(repo_path: &Path) -> Result<ConflictInfo> {
    let (pristine, working_copy, change_store) = open_repo(repo_path)?;

    // 1. Setup: Create a file on 'main'
    let doc_path = repo_path.join("conflict.md");
    fs::write(&doc_path, "Base content\n")?;

    record_all(repo_path, "Base", Some("conflict.md"))?;

    // 2. Create a second channel 'dev' from 'main'
    {
        let mut txn = pristine.mut_txn_begin()?;
        let main = txn.open_or_create_channel("main")?;
        txn.fork(&main, "dev")?;
        txn.commit()?;
    }

    // 3. Edit on 'main'
    fs::write(&doc_path, "Main content\n")?;
    let _main_hash = record_all(repo_path, "Main edit", Some("conflict.md"))?;

    // 4. Record on 'dev'
    fs::write(&doc_path, "Dev content\n")?;
    let dev_hash = record_on_channel(repo_path, "dev", "Dev edit", Some("conflict.md"))?;

    // 5. Merge 'dev' into 'main'
    let mut txn = pristine.arc_txn_begin()?;
    let channel_main = txn.write().open_or_create_channel("main")?;

    let _change_dev = change_store.get_change(&dev_hash)?;

    txn.write().apply_change(
        &change_store,
        &mut *channel_main.write(),
        &dev_hash,
    )?;

    // 6. Check for conflicts
    let conflicts = libpijul::output::output_repository_no_pending(
        &working_copy,
        &change_store,
        &txn,
        &channel_main,
        "",
        true,
        None,
        1,
        0,
    )?;

    txn.commit()?;

    let has_conflict = !conflicts.is_empty();
    let mut conflict_locs = Vec::new();

    for conflict in conflicts {
        conflict_locs.push(ConflictLocation {
            line: 0,
            options: vec![format!("{:?}", conflict)],
        });
    }

    // Check textual markers
    if doc_path.exists() {
        let content = fs::read_to_string(&doc_path)?;
        if content.contains(">>>>") && content.contains("<<<<") {
             if !has_conflict {
                 conflict_locs.push(ConflictLocation {
                     line: 0,
                     options: vec!["Conflict markers found in text".to_string()],
                 });
             }
        }
    }

    let actual_has_conflict = !conflict_locs.is_empty();

    Ok(ConflictInfo {
        has_conflict: actual_has_conflict,
        locations: conflict_locs,
    })
}

// Helper for recording on a specific channel
fn record_on_channel(repo_path: &Path, channel_name: &str, message: &str, file_to_add: Option<&str>) -> Result<Hash> {
    let (pristine, working_copy, change_store) = open_repo(repo_path)?;

    // Ensure channel exists first
    let mut txn = pristine.mut_txn_begin()?;
    let _channel = txn.open_or_create_channel(channel_name)?;
    txn.commit()?;

    let txn = pristine.arc_txn_begin()?;
    let channel = txn.write().open_or_create_channel(channel_name)?;

    if let Some(file) = file_to_add {
         if !txn.read().is_tracked(file).unwrap_or(false) {
             txn.write().add_file(file, 0)?;
        }
    }

    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_path)?;

    working_copy.record_prefix(
        txn.clone(),
        Algorithm::default(),
        channel.clone(),
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
        .map(|r| r.globalize(&*txn.read()).unwrap())
        .collect();

    let mut contents_lock = recorded.contents.lock();
    let contents = std::mem::take(&mut *contents_lock);

    let mut change = libpijul::change::Change::make_change(
        &*txn.read(),
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

    txn.write().apply_local_change(
        &channel,
        &change,
        &hash,
        &recorded.updatables,
    )?;

    txn.commit()?;
    Ok(hash)
}
