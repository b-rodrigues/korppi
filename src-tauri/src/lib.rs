pub mod yjs_store;
pub mod patch_log;
pub mod models;
pub mod conflict_detector;
pub mod conflict_store;
pub mod conflict_commands;
pub mod profile;
pub mod kmd;
pub mod document_manager;
pub mod comments;
pub mod db_utils;

use std::sync::Mutex;
use patch_log::{
    list_patches, record_patch, get_patch, save_snapshot, get_snapshot_for_patch,
    restore_to_patch, import_patches_from_document, record_patch_review,
    get_patch_reviews, get_patches_needing_review,
};
use yjs_store::{load_doc, store_update};
use conflict_commands::{detect_conflicts, get_conflicts, resolve_conflict, get_conflict_count};
use profile::{get_profile, save_profile, get_profile_path, export_profile, import_profile};
use kmd::{export_kmd, export_markdown, export_docx, get_document_meta, set_document_title, write_text_file};
use document_manager::{
    new_document, open_document, save_document, close_document,
    get_open_documents, get_recent_documents, clear_recent_documents,
    set_active_document, get_active_document, get_document_state,
    update_document_state, mark_document_modified, update_document_title,
    record_document_patch, list_document_patches, get_initial_file,
    save_document_snapshot, restore_document_to_patch,
    record_document_patch_review, get_document_patch_reviews,
    get_document_patches_needing_review, check_parent_patch_status,
    import_document, check_pandoc_available, open_url,
    DocumentManager,
};
use comments::{
    add_comment, list_comments, add_reply, resolve_comment, delete_comment, mark_comment_deleted, restore_comment,
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
            export_profile,
            import_profile,
            export_kmd,
            export_markdown,
            export_docx,
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
            restore_document_to_patch,
            save_document_snapshot,
            record_document_patch_review,
            get_document_patch_reviews,
            get_document_patches_needing_review,
            check_parent_patch_status,
            import_document,
            check_pandoc_available,
            open_url,
            import_patches_from_document,
            record_patch_review,
            get_patch_reviews,
            get_patches_needing_review,
            // Comment commands
            add_comment,
            list_comments,
            add_reply,
            resolve_comment,
            delete_comment,
            mark_comment_deleted,
            restore_comment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
