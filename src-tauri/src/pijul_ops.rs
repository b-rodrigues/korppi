use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use log;
use std::fs;
use std::path::{Path, PathBuf};

use canonical_path::CanonicalPathBuf;

use libpijul::{
    changestore::filesystem::FileSystem as FileChangeStore,
    changestore::ChangeStore,
    pristine::sanakirja::Pristine,
    pristine::{Base32, ChangeId, ChannelTxnT, GraphTxnT, MutTxnT, TreeTxnT, TxnT},
    working_copy::filesystem::FileSystem as FileWorkingCopy,
    working_copy::{WorkingCopy, WorkingCopyRead},
    Hash, MutTxnTExt, RecordBuilder, TxnTExt, Algorithm,
};

use crate::models::*;

/// Fake working copy for non-destructive conflict extraction
#[derive(Clone, Copy)]
struct FakeWorkingCopy;

impl WorkingCopyRead for FakeWorkingCopy {
    type Error = std::io::Error;

    fn file_metadata(
        &self,
        _file: &str,
    ) -> Result<libpijul::pristine::InodeMetadata, Self::Error> {
        unimplemented!()
    }

    fn read_file(&self, _file: &str, _buffer: &mut Vec<u8>) -> Result<(), Self::Error> {
        unimplemented!()
    }

    fn modified_time(&self, _file: &str) -> Result<std::time::SystemTime, Self::Error> {
        unimplemented!()
    }
}

impl WorkingCopy for FakeWorkingCopy {
    fn create_dir_all(&self, _path: &str) -> Result<(), Self::Error> { Ok(()) }
    fn remove_path(&self, _name: &str, _rec: bool) -> Result<(), Self::Error> { Ok(()) }
    fn rename(&self, _former: &str, _new: &str) -> Result<(), Self::Error> { Ok(()) }
    fn set_permissions(&self, _name: &str, _permissions: u16) -> Result<(), Self::Error> { Ok(()) }

    type Writer = std::io::Sink;
    fn write_file(&self, _file: &str, _inode: libpijul::pristine::Inode)
    -> Result<Self::Writer, Self::Error> {
        Ok(std::io::sink())
    }
}

/// Temporary repo path under /tmp
pub fn get_test_repo_path() -> Result<PathBuf> {
    let temp = std::env::temp_dir();
    let repo_path = temp.join("korppi-test-repo");
    fs::create_dir_all(&repo_path)?;
    Ok(repo_path)
}

/// Initialize repository
pub fn init_repository(path: &Path) -> Result<()> {
    let pijul_dir = path.join(".pijul");
    if pijul_dir.exists() {
        fs::remove_dir_all(&pijul_dir)?;
    }
    fs::create_dir_all(&pijul_dir)?;

    // pristine/db
    let pristine_dir = pijul_dir.join("pristine");
    fs::create_dir_all(&pristine_dir)?;
    let pristine = Pristine::new(&pristine_dir.join("db"))?;

    // changes/
    let changes_dir = pijul_dir.join("changes");
    fs::create_dir_all(&changes_dir)?;

    // Create main channel
    let mut txn = pristine.mut_txn_begin()?;
    txn.open_or_create_channel("main")?;
    txn.commit()?;

    Ok(())
}

/// Validate repository structure
pub fn verify_repository(path: &Path) -> Result<bool> {
    let pijul = path.join(".pijul");
    if !pijul.exists() {
        return Ok(false);
    }

    let pristine_db = pijul.join("pristine/db");
    let changes = pijul.join("changes");

    if !pristine_db.exists() || !changes.exists() {
        return Ok(false);
    }

    let pristine = Pristine::new(&pristine_db)?;
    let txn = pristine.txn_begin()?;
    Ok(txn.load_channel("main")?.is_some())
}

/// Open repo handles
fn open_repo(path: &Path) -> Result<(Pristine, FileWorkingCopy, FileChangeStore)> {
    let pijul = path.join(".pijul");
    if !pijul.exists() {
        return Err(anyhow!("Repository not initialized at {:?}", path));
    }

    let pristine = Pristine::new(&pijul.join("pristine/db"))?;
    let working_copy = FileWorkingCopy::from_root(path);
    let change_store = FileChangeStore::from_changes(pijul.join("changes"), 100);

    Ok((pristine, working_copy, change_store))
}

/// Core unified record function
fn record_generic_with_handles(
    pristine: &Pristine,
    working_copy: &FileWorkingCopy,
    change_store: &FileChangeStore,
    repo_root: &Path,
    channel_name: &str,
    message: &str,
    track_file: Option<&str>,
) -> Result<Hash> {
    let mut txn = pristine.mut_txn_begin()?;
    let mut channel = txn.open_or_create_channel(channel_name)?;

    if let Some(file) = track_file {
        if !txn.is_tracked(file)? {
            txn.add_file(file, 0)?;
        }
    }

    let mut builder = RecordBuilder::new();
    let canonical_root = CanonicalPathBuf::canonicalize(repo_root)?;

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
        return Err(anyhow!("No changes to record on channel {}", channel_name));
    }

    let actions = recorded
        .actions
        .into_iter()
        .map(|a| {
            a.globalize(&txn)
                .map_err(|e| anyhow!("Failed to globalize action: {}", e))
        })
        .collect::<Result<Vec<_>>>()?;

    let contents = std::mem::take(&mut *recorded.contents.lock());

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

fn record_generic(
    repo_path: &Path,
    channel: &str,
    message: &str,
    track: Option<&str>,
) -> Result<Hash> {
    let (pristine, wc, cs) = open_repo(repo_path)?;
    record_generic_with_handles(&pristine, &wc, &cs, repo_path, channel, message, track)
}

fn record_all(repo_path: &Path, message: &str, f: Option<&str>) -> Result<Hash> {
    record_generic(repo_path, "main", message, f)
}

fn record_on_channel(repo_path: &Path, chan: &str, msg: &str, f: Option<&str>)
-> Result<Hash> {
    record_generic(repo_path, chan, msg, f)
}

/// Write + record change
pub fn record_change(repo_path: &Path, content: &str, message: &str) -> Result<String> {
    let file = repo_path.join("document.md");
    fs::write(&file, content)?;

    match record_all(repo_path, message, Some("document.md")) {
        Ok(h) => Ok(h.to_base32().to_string()),
        Err(e) => {
            if format!("{}", e).contains("No changes to record") {
                Ok("no_change".to_string())
            } else {
                Err(e)
            }
        }
    }
}

/// Patch history
pub fn get_patch_history(repo_path: &Path) -> Result<Vec<PatchInfo>> {
    let (pristine, _wc, cs) = open_repo(repo_path)?;
    let txn = pristine.txn_begin()?;

    let channel = txn
        .load_channel("main")?
        .ok_or_else(|| anyhow!("Channel 'main' not found"))?;
    let ch_read = channel.read();

    let mut out = vec![];

    for entry in txn.changeid_reverse_log(&*ch_read, None)? {
        let (id, _) = entry?;
        let cid = ChangeId(*id);

        let ext = txn
            .get_external(&cid)?
            .ok_or_else(|| anyhow!("Missing external hash"))?;
        let h: Hash = ext.into();

        match cs.get_header(&h) {
            Ok(header) => out.push(PatchInfo {
                hash: h.to_base32().to_string(),
                description: header.message,
                timestamp: header.timestamp.to_rfc3339(),
            }),
            Err(e) => log::warn!("Missing header: {}", e),
        }
    }

    Ok(out)
}

/// Conflict simulation using structured libpijul::Conflict
pub fn simulate_conflict(repo_path: &Path) -> Result<ConflictInfo> {
    let (pristine, wc, cs) = open_repo(repo_path)?;

    let doc = repo_path.join("document.md");

    // BASE
    fs::write(&doc, "The quick brown fox jumps over the lazy dog.")?;
    record_generic_with_handles(
        &pristine,
        &wc,
        &cs,
        repo_path,
        "main",
        "Base document",
        Some("document.md"),
    )?;

    // FORK dev
    {
        let mut txn = pristine.mut_txn_begin()?;
        let main = txn.open_or_create_channel("main")?;
        txn.fork(&main, "dev")?;
        txn.commit()?;
    }

    // MAIN edit
    fs::write(&doc, "The quick brown fox jumps over the sleepy dog.")?;
    record_generic_with_handles(
        &pristine, &wc, &cs, repo_path,
        "main",
        "Change lazy to sleepy",
        Some("document.md"),
    )?;

    // DEV rewind
    {
        let txn = pristine.txn_begin()?;
        let dev = txn.load_channel("dev")?.ok_or_else(|| anyhow!("dev missing"))?;

        libpijul::output::output_repository_no_pending(
            &wc,
            &cs,
            &txn,
            &dev,
            &repo_path.to_string_lossy(),
            true,
            None,
            1,
            0,
        )?;
    }

    // DEV edit
    fs::write(&doc, "The quick brown fox jumps over the tired dog.")?;
    let dev_hash = record_generic_with_handles(
        &pristine, &wc, &cs, repo_path,
        "dev",
        "Change lazy to tired",
        Some("document.md"),
    )?;

    // MERGE and list conflicts using FakeWorkingCopy
    let conflicts = {
        let mut txn = pristine.mut_txn_begin()?;
        let mut main = txn.open_or_create_channel("main")?;

        txn.apply_change(&cs, &mut main, &dev_hash)?;

        let c = libpijul::output::output_repository_no_pending(
            &FakeWorkingCopy,
            &cs,
            &txn,
            &main,
            "",
            true,
            None,
            1,
            0,
        )?;

        txn.commit()?;
        c
    };

    // Map into your ConflictLocation model
    use libpijul::Conflict as PC;

    let mut locs = vec![];

    for c in conflicts {
        match c {
            PC::Name { path, .. } => locs.push(ConflictLocation {
                path,
                line: None,
                conflict_type: "name".to_string(),
                description: "Two entries share the same name".to_string(),
            }),

            PC::Order { path, line, .. } => locs.push(ConflictLocation {
                path,
                line: Some(line as usize),
                conflict_type: "order".to_string(),
                description: format!("Change-order conflict at line {}", line),
            }),

            PC::Zombie { path, line, .. } => locs.push(ConflictLocation {
                path,
                line: Some(line as usize),
                conflict_type: "zombie".to_string(),
                description: "A deleted line is referenced".to_string(),
            }),

            PC::ZombieFile { path, .. } => locs.push(ConflictLocation {
                path,
                line: None,
                conflict_type: "zombie_file".to_string(),
                description: "A deleted file is still referenced".to_string(),
            }),

            PC::Cyclic { path, line, .. } => locs.push(ConflictLocation {
                path,
                line: Some(line as usize),
                conflict_type: "cyclic".to_string(),
                description: "Cyclic dependency detected in patch graph".to_string(),
            }),

            PC::MultipleNames { path, names, .. } => locs.push(ConflictLocation {
                path,
                line: None,
                conflict_type: "multiple_names".to_string(),
                description: format!("Multiple names: {:?}", names),
            }),
        }
    }

    Ok(ConflictInfo {
        has_conflict: !locs.is_empty(),
        locations: locs,
    })
}
