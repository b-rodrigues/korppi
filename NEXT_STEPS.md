# Korppi Implementation Roadmap

This document outlines the implementation plan for Korppi, a collaborative Markdown editor with offline-first design and email-based synchronization.

## Priority Summary

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| High | Phase 1 (User Profiles) | Medium | Foundation for collaboration |
| High | Phase 2 (KMD Format) | Medium | Required for file portability |
| Medium | Phase 3 (Multi-Document) | Medium | Better UX |
| Medium | Phase 4 (Email Collaboration) | High | Core vision enabler |
| Lower | Phase 5 (Document Merging) | High | Advanced feature |
| Lower | Phase 6 (Enhanced Timeline) | Medium | Polish |

---

## Phase 1: User Profile System

**Goal:** Replace hardcoded "local" author with actual user identity.

### Tasks

1. **Create profile configuration module**
   - Add `src-tauri/src/profile.rs`
   - Define `UserProfile` struct with serialization

2. **Platform-appropriate storage**
   - Linux/macOS: `~/.config/korppi/profile.toml`
   - Windows: `%APPDATA%\korppi\profile.toml`
   - Use `directories` crate for cross-platform paths

3. **Profile fields**
   ```rust
   struct UserProfile {
       id: Uuid,           // Auto-generated on first run
       name: String,       // Display name
       email: Option<String>,
       avatar_path: Option<PathBuf>,
       color: String,      // Hex color (e.g., "#FF6B6B")
   }
   ```

4. **Profile Settings UI**
   - Add settings modal/page
   - Name and email input fields
   - Avatar picker (file upload or default avatars)
   - Color picker for author highlighting

5. **Integrate with patch-grouper.js**
   - Replace hardcoded `"local"` author with profile UUID
   - Expose profile via Tauri command:
     ```rust
     #[tauri::command]
     fn get_user_profile() -> Result<UserProfile, Error>
     ```
   - Call from JavaScript:
     ```javascript
     const profile = await invoke('get_user_profile');
     addSemanticPatches(patches, profile.id);
     ```

### Implementation Notes

- Generate UUID on first run, persist permanently
- Cache profile in memory, reload on file change
- Validate color format (hex)
- Resize avatars to reasonable dimensions (e.g., 128x128)

---

## Phase 2: KMD File Format

**Goal:** Implement the KMD specification for portable document storage.

### Tasks

1. **ZIP container implementation**
   - Use `zip` crate for Rust
   - Create/extract ZIP archives

2. **File components**
   - `format.json` - Format version and compatibility
   - `state.yjs` - Binary Yjs CRDT state
   - `history.sqlite` - Patch history database
   - `meta.json` - Document metadata
   - `authors/` - Cached author profiles

3. **Tauri commands**
   ```rust
   #[tauri::command]
   fn export_kmd(path: PathBuf, doc_state: Vec<u8>) -> Result<(), Error>
   
   #[tauri::command]
   fn import_kmd(path: PathBuf) -> Result<KmdDocument, Error>
   
   #[tauri::command]
   fn save_as_markdown(path: PathBuf, content: String) -> Result<(), Error>
   ```

4. **Markdown export**
   - Extract text from Yjs state
   - Convert to clean Markdown format
   - Handle formatting (bold, italic, etc.)

### Implementation Notes

- Use streaming for large files
- Validate ZIP contents before extraction
- Handle version compatibility checks
- Implement proper error handling for corrupted files

---

## Phase 3: Multi-Document Support

**Goal:** Enable working with multiple documents simultaneously.

### Tasks

1. **Document manager module**
   - Add `src-tauri/src/document_manager.rs`
   - Track open documents and their states

2. **Document operations**
   ```rust
   struct DocumentManager {
       documents: HashMap<Uuid, Document>,
       active_document: Option<Uuid>,
   }
   
   impl DocumentManager {
       fn open(&mut self, path: PathBuf) -> Result<Uuid, Error>
       fn create(&mut self) -> Uuid
       fn save(&self, id: Uuid) -> Result<(), Error>
       fn close(&mut self, id: Uuid) -> Result<(), Error>
   }
   ```

3. **Recent documents**
   - Store in `~/.config/korppi/recent.json`
   - Track last 10-20 documents
   - Show in File menu and welcome screen

4. **Tab/Window management**
   - UI tabs for switching documents
   - Consider multi-window support later

5. **File associations**
   - Register `.kmd` extension with OS
   - Handle file open events
   - Update `tauri.conf.json`:
     ```json
     "fileAssociations": [
       {
         "ext": ["kmd"],
         "mimeType": "application/vnd.korppi.document+zip",
         "description": "Korppi Document"
       }
     ]
     ```

### Implementation Notes

- Careful with memory management for multiple large documents
- Autosave all open documents
- Warn on unsaved changes before closing

---

## Phase 4: Email-Based Collaboration Workflow

**Goal:** Enable sharing and merging changes via email attachments.

### Tasks

1. **Patch bundle export**
   - Create `.kmd-patch` file format
   - Contains only new patches since last sync
   - Smaller than full document for email

2. **Patch import and merge**
   - Parse incoming `.kmd-patch` files
   - Apply patches using Yjs CRDT merge
   - Update sync state per collaborator

3. **UI components**
   - "Share Changes" button
     - Export patches since last sync with collaborator
     - Open email client with attachment
   - "Import Changes" button
     - File picker for `.kmd-patch` files
     - Show preview of incoming changes
     - Apply and merge

4. **Sync state tracking**
   - Track state vector per collaborator
   - Store in `meta.json` under `sync_state`
   - Detect and show "new changes available"

### Implementation Notes

- Use Yjs state vectors to compute minimal diffs
- Handle out-of-order patch application gracefully
- Consider compression for patch bundles
- Show clear feedback on merge results

---

## Phase 5: Document Merging

**Goal:** Enable advanced merge scenarios and conflict resolution.

### Tasks

1. **Yjs document merging**
   - Merge state vectors from two documents
   - Handle divergent branches
   - Automatic CRDT resolution for most cases

2. **Patch history concatenation**
   - Merge patch histories from both documents
   - Maintain proper timestamp ordering
   - Handle duplicate patches

3. **Conflict resolution UI**
   - Three-way merge view for structural conflicts
   - Accept local / remote / both options
   - Visual diff highlighting

4. **Branch-like workflow (optional)**
   - Fork document for experimental changes
   - Merge branches back together
   - Track branch metadata

### Implementation Notes

- Yjs handles most conflicts automatically
- UI needed mainly for informing users
- Consider undo after merge
- Test thoroughly with complex edit patterns

---

## Phase 6: Enhanced History & Timeline

**Goal:** Improve history visualization and time travel capabilities.

### Tasks

1. **Visual improvements**
   - Show author avatars on patches
   - Color-code by author
   - Group patches by time/session

2. **Filtering and search**
   - Filter by author
   - Filter by date range
   - Search in patch content

3. **Visual diff**
   - Side-by-side comparison
   - Inline diff highlighting
   - Navigate between changes

4. **Time travel**
   - Preview any historical version
   - Restore to previous version
   - Fork from historical point

5. **Annotations (future)**
   - Comments on specific patches
   - Discussion threads
   - Resolved/open tracking

### Implementation Notes

- Use snapshots for efficient time travel
- Cache commonly accessed versions
- Consider lazy loading for long histories
- Keyboard shortcuts for navigation

---

## Immediate Next Steps

1. **Start with Phase 1 - User Profiles**
   - Create `src-tauri/src/profile.rs`
   - Implement profile loading/saving
   - Add basic settings UI
   - Wire up to patch-grouper.js

2. **Define and implement KMD format**
   - Create ZIP container handling
   - Implement core file components
   - Add export/import commands

3. **Refactor author handling**
   - Remove hardcoded `"local"` string
   - Pass actual profile data through system
   - Update timeline to show real names/avatars

---

## Technical Dependencies

### Phase 1
- `directories` crate (cross-platform config paths)
- `uuid` crate (author ID generation)
- `toml` crate (profile serialization)

### Phase 2
- `zip` crate (ZIP archive handling)
- Already have: `rusqlite` for history

### Phase 3
- Consider `tauri-plugin-window-state` for window management

### Phase 4
- Yjs state vector encoding/decoding
- Email client integration (open mailto: or native)

---

## Architecture Notes

### State Management

```
User Profile (profile.rs)
    ↓
Document Manager (document_manager.rs)
    ↓
Individual Documents
    ├── Yjs State (source of truth)
    ├── Patch History (SQLite)
    └── Metadata (JSON)
```

### Data Flow for Collaboration

```
Local Edits → Yjs Doc → Semantic Patches → History DB
                ↓
         State Vector
                ↓
    Patch Bundle (.kmd-patch)
                ↓
         Email Transfer
                ↓
    Merge into Remote Doc
```

---

## Success Criteria

- [ ] Users can set their profile (name, avatar, color)
- [ ] Documents save as portable .kmd files
- [ ] Multiple documents can be open simultaneously
- [ ] Changes can be shared via email attachments
- [ ] Documents from multiple users merge cleanly
- [ ] Full edit history is preserved and navigable
