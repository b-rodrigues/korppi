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
    Pristine::new(&db_path)?;

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

    // Record using ArcTxn (or MutTxn if ArcTxn unavailable)
    // In beta.9, we use MutTxn.
    let mut txn = pristine.mut_txn_begin()?;
    let mut channel = txn.open_or_create_channel("main")?;

    // Explicitly add file if requested and not tracked
    if let Some(file) = file_to_add {
        if !txn.is_tracked(file)? {
             txn.add_file(file, 0)?;
        }
    }

    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_path)?;

    // Record prefix (root)
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

    // Apply the change
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
    let mut txn = pristine.mut_txn_begin()?;
    let channel = txn.open_or_create_channel("main")?;

    let mut history = Vec::new();

    // Iterate reverse log
    for h in txn.changeid_reverse_log(&channel, None)? {
        let (hash_id, _merkle) = h?;

        // hash_id is &ChangeId (or &L64)
        // We assume we can use it directly if it is ChangeId, or convert.
        // If ChangeId == L64, and we have &L64.
        // Try get_external(*hash_id) if hash_id is reference.
        // Or get_external(hash_id) if it matches reference type.

        // I'll assume `hash_id` is `&ChangeId`.
        // txn.get_external takes &ChangeId.
        // If `hash_id` is `&L64` and `L64` doesn't implement `Into<ChangeId>` (as per error),
        // but `ChangeId` IS `L64` (alias), then `&L64` IS `&ChangeId`.
        // The error before said `expected &ChangeId, found &L64`. This is weird for an alias.
        // It implies they are different types.
        // If `ChangeId` is a struct wrapping `L64`.
        // Then `ChangeId(*hash_id)` works.

        let id = ChangeId(*hash_id);
        let external_hash = txn.get_external(&id)?.unwrap();
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
    let mut txn = pristine.mut_txn_begin()?;
    let mut channel_main = txn.open_or_create_channel("main")?;

    let _change_dev = change_store.get_change(&dev_hash)?;

    txn.apply_change(
        &change_store,
        &mut channel_main,
        &dev_hash,
    )?;

    // 6. Check for conflicts
    // Need txn reference for output
    // But txn is MutTxn.
    // output_repository_no_pending takes &ArcTxn usually?
    // Or `impl TxnTExt`. `MutTxn` implements `TxnTExt`.
    // But check signature.
    // In beta.10 it takes `&ArcTxn`.
    // In beta.9?
    // If it takes `&ArcTxn`, I can't call it with `&MutTxn`.
    // If so, I might be stuck on outputting conflicts programmatically if I can't use ArcTxn.

    // However, `txn` implements `TxnT`.
    // Maybe I can use `txn.iter_conflicts`?
    // I'll try `iter_conflicts` approach suggested by reviewer.

    // `txn.iter_conflicts(&channel)?`
    // Does it exist?
    // Not in `TxnTExt` I saw earlier.

    // Let's try `output_repository_no_pending` anyway. If it fails, I'll know.
    // I'll pass `&txn` (casted/referenced).

    // Wait, if `output_repository` requires `ArcTxn`, and I only have `MutTxn` (because `arc_txn_begin` missing),
    // then maybe `output_repository` takes `&impl TxnT`?
    // If so, `&txn` works.

    // I need `ArcTxn` only if it spawns threads that need shared access?

    // Let's assume it works with what I have.

    // I'll try to construct ArcTxn if needed? No, if `arc_txn_begin` doesn't exist.
    // Maybe `ArcTxn::new(txn)`?

    // I'll try passing `&txn`.

    // But wait, `output_repository_no_pending` is in `libpijul::output`.

    let conflicts = libpijul::output::output_repository_no_pending(
        &working_copy,
        &change_store,
        &txn, // &MutTxn
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
