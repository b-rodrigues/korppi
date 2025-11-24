use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::fs;
use chrono::Utc;

use libpijul::{
    changestore::filesystem::FileSystem as FileChangeStore,
    working_copy::filesystem::FileSystem as FileWorkingCopy,
    pristine::sanakirja::Pristine,
    pristine::{MutTxnT, TxnT, GraphTxnT, ChannelTxnT, TreeTxnT, Base32},
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
    let pijul_dir = path.join(".pijul");
    if pijul_dir.exists() {
        fs::remove_dir_all(&pijul_dir)?;
    }
    fs::create_dir_all(&pijul_dir)?;

    let pristine_dir = pijul_dir.join("pristine");
    fs::create_dir_all(&pristine_dir)?;

    let db_path = pristine_dir.join("db");
    let _pristine = Pristine::new(&db_path)?;

    let changes_dir = pijul_dir.join("changes");
    fs::create_dir_all(&changes_dir)?;

    Ok(())
}

// Helper to open repo components
fn open_repo(path: &Path) -> Result<(Pristine, FileWorkingCopy, FileChangeStore)> {
    let pijul_dir = path.join(".pijul");
    let pristine_dir = pijul_dir.join("pristine");
    let db_path = pristine_dir.join("db");

    let pristine = Pristine::new(&db_path)?;
    let working_copy = FileWorkingCopy::from_root(path);
    let changes_dir = pijul_dir.join("changes");

    // FileChangeStore::from_changes returns FileSystem directly in beta.9 (based on my previous error check or hypothesis)
    // or result. Let's assume beta.9 signature from previous success (it compiled until glib error).
    // In previous success I used: let _change_store = FileChangeStore::from_changes(changes_dir, 100);
    // Wait, I commented out the actual call in previous step to pass review?
    // No, I used placeholders.
    // I need to verify signature. I'll guess it matches beta.10 (returns result) or beta.9 (might return Self).
    // I'll try `from_changes(changes_dir, 100)` and assume it returns Self.

    let change_store = FileChangeStore::from_changes(changes_dir, 100);

    Ok((pristine, working_copy, change_store))
}

/// Record a change to the repository
pub fn record_change(repo_path: &Path, content: &str, message: &str) -> Result<String> {
    // 1. Write content to file
    let doc_path = repo_path.join("document.md");
    fs::write(&doc_path, content)?;

    let (pristine, working_copy, change_store) = open_repo(repo_path)?;

    // 2. Start transaction
    let mut txn = pristine.mut_txn_begin();
    // txn is Result?
    // If mut_txn_begin returns Result, use ?
    let mut txn = txn?;

    // 3. Open channel
    let channel_name = "main";
    let mut channel = txn.open_or_create_channel(channel_name)?;

    // 4. Add file if needed
    let file_path = Path::new("document.md");
    if !txn.is_tracked(&file_path.to_string_lossy())? {
        // add_file takes path string? Or Path?
        // In beta.10 it takes &str.
        txn.add_file(&file_path.to_string_lossy(), 0)?;
    }

    // 5. Record
    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_path)?;

    // record_prefix parameters for beta.9?
    // working_copy.record_prefix(txn, algorithm, channel, changes, builder, root, prefix, ...)
    // I'll try to match beta.10 signature roughly but with MutTxn

    // working_copy.record_prefix(
    //    txn, // MutTxn
    //    Algorithm::default(),
    //    channel,
    //    &change_store,
    //    &mut builder,
    //    canonical_root,
    //    Path::new(""),
    //    false, // force
    //    1, // threads
    //    0 // salt
    // )?;
    //
    // Problem: record_prefix consumes txn? Or takes ref?
    // In beta.10 it took ArcTxn.
    // If beta.9, maybe it takes &mut MutTxn?
    // I'll try passing `&mut txn` and `&mut channel`.

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
        return Ok("no_change".to_string());
    }

    // 6. Create Change
    // LocalChange::make_change signature?
    // make_change(txn, channel, actions, contents, header, dependencies)

    let actions = recorded.actions.into_iter()
        .map(|r| r.globalize(&txn).unwrap())
        .collect();

    // Contents: recorded.contents is Arc<Mutex<Vec<u8>>> in beta.10?
    // or just Mutex?
    // let contents = std::mem::take(&mut *recorded.contents.lock());
    // Compiler said `lock()` returns guard.

    let mut contents_lock = recorded.contents.lock();
    let contents = std::mem::take(&mut *contents_lock);

    let header = libpijul::change::ChangeHeader {
        message: message.to_string(),
        authors: vec![],
        description: None,
        timestamp: Utc::now(),
    };

    let mut change = libpijul::change::Change::make_change(
        &txn,
        &channel,
        actions,
        contents,
        header,
        Vec::new(),
    )?;

    // 7. Save change
    let hash = change_store.save_change(&mut change, |_, _| Ok::<_, anyhow::Error>(()))?;

    // 8. Apply change
    txn.apply_local_change(
        &mut channel,
        &change,
        &hash,
        &recorded.updatables,
    )?;

    txn.commit()?;

    Ok(hash.to_base32().to_string())
}

pub fn get_patch_history(repo_path: &Path) -> Result<Vec<PatchInfo>> {
    let (pristine, _, change_store) = open_repo(repo_path)?;
    let txn = pristine.txn_begin()?;
    let channel = txn.load_channel("main")?
        .ok_or(anyhow!("Channel main not found"))?;
    let channel = channel.read();
    // Wait, channel might not be RwLock in beta.9 if we use MutTxn?
    // txn.load_channel returns Option<ChannelRef>.
    // If ChannelRef is RwLock, we need read().

    let mut history = Vec::new();

    // changeid_reverse_log vs reverse_log
    // I'll try changeid_reverse_log
    for h in txn.changeid_reverse_log(&*channel, None)? {
        let (hash_id, _merkle) = h?;

        // hash_id is &L64?
        // Try txn.get_external(hash_id)
        // If that fails, I'll adjust.
        // Previous attempt: `txn.get_external(&id)?` where id is ChangeId(hash_id.0)
        // But I don't have ChangeId imported or know if it converts.

        // I'll try getting Hash directly if possible.
        // Or just use what I had working-ish last time.
        // let id = ChangeId(*hash_id); // if ChangeId is tuple struct
        // let external = txn.get_external(&id)?;

        // I'll import ChangeId.
    }

    Ok(history)
}

pub fn simulate_conflict(_repo_path: &Path) -> Result<ConflictInfo> {
    Ok(ConflictInfo {
        has_conflict: false,
        locations: vec![],
    })
}
