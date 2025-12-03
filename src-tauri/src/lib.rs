pub mod yjs_store;
pub mod patch_log;
pub mod models;
pub mod conflict_detector;
pub mod conflict_store;
pub mod conflict_commands;
pub mod profile;
pub mod kmd;

use patch_log::{list_patches, record_patch, get_patch};
use yjs_store::{load_doc, store_update};
use conflict_commands::{detect_conflicts, get_conflicts, resolve_conflict, get_conflict_count};
use profile::{get_profile, save_profile, get_profile_path};
use kmd::{export_kmd, import_kmd, export_markdown, get_document_meta, set_document_title, write_text_file};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_doc,
            store_update,
            record_patch,
            list_patches,
            get_patch,
            detect_conflicts,
            get_conflicts,
            resolve_conflict,
            get_conflict_count,
            get_profile,
            save_profile,
            get_profile_path,
            export_kmd,
            import_kmd,
            export_markdown,
            get_document_meta,
            set_document_title,
            write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
