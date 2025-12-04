pub mod yjs_store;
pub mod patch_log;
pub mod models;
pub mod conflict_detector;
pub mod conflict_store;
pub mod conflict_commands;
pub mod profile;
pub mod kmd;
pub mod document_manager;

use std::sync::Mutex;
use patch_log::{list_patches, record_patch, get_patch, save_snapshot, get_snapshot_for_patch, restore_to_patch, import_patches_from_document};
use yjs_store::{load_doc, store_update};
use conflict_commands::{detect_conflicts, get_conflicts, resolve_conflict, get_conflict_count};
use profile::{get_profile, save_profile, get_profile_path};
use kmd::{export_kmd, import_kmd, export_markdown, get_document_meta, set_document_title, write_text_file};
use document_manager::{
    new_document, open_document, save_document, close_document,
    get_open_documents, get_recent_documents, clear_recent_documents,
    set_active_document, get_active_document, get_document_state,
    update_document_state, mark_document_modified, update_document_title,
    record_document_patch, list_document_patches, get_initial_file,
    save_document_snapshot, restore_document_to_patch,
    update_patch_review_status,
    DocumentManager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(DocumentManager::default()))
        .invoke_handler(tauri::generate_handler![
            load_doc,
            store_update,
            record_patch,
            list_patches,
            get_patch,
            save_snapshot,
            get_snapshot_for_patch,
            restore_to_patch,
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
            // Document manager commands
            new_document,
            open_document,
            save_document,
            close_document,
            get_open_documents,
            get_recent_documents,
            clear_recent_documents,
            set_active_document,
            get_active_document,
            get_document_state,
            update_document_state,
            mark_document_modified,
            update_document_title,
            record_document_patch,
            list_document_patches,
            get_initial_file,
            save_document_snapshot,
            restore_document_to_patch,
            update_patch_review_status,
            import_patches_from_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
