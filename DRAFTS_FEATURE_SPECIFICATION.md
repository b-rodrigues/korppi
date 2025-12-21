# Drafts & Speculative Reconciliation Feature Specification

**Version:** 1.0.0-draft
**Status:** Draft
**Created:** December 2024
**Authors:** Korppi Development Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Design Goals](#design-goals)
4. [Core Concepts](#core-concepts)
5. [User Experience](#user-experience)
6. [Technical Architecture](#technical-architecture)
7. [File Format Changes](#file-format-changes)
8. [Implementation Plan](#implementation-plan)
9. [Testing Strategy](#testing-strategy)
10. [Migration & Compatibility](#migration--compatibility)
11. [Future Extensions](#future-extensions)

---

## Executive Summary

This document specifies the **Drafts** feature for Korppi, which introduces:

1. **Speculative Reconciliation** - During reconciliation, users can toggle hunks on/off and preview different combinations before committing changes
2. **Draft Branches** - Short-lived, named branches that live inside the `.kmd` file for experimentation
3. **What-If Comparisons** - Ability to save multiple candidate versions and compare them
4. **Safe Experimentation** - A sandbox mode where users can try changes without affecting their main document

The key insight is that **drafts are overlays on top of the main document**, not separate universes. The main document remains sacred and unchanged until the user explicitly merges a draft.

---

## Problem Statement

### Current Limitations

1. **Permanent Decisions During Reconciliation**
   - Users must accept/reject hunks immediately
   - No way to preview "what if I accept A but not B?"
   - Once accepted, changes are applied to the document

2. **No Safe Experimentation**
   - Users cannot try adding new sections without risk
   - No way to maintain multiple candidate versions
   - Fear of breaking a "good" version discourages exploration

3. **Lost Context in Collaboration**
   - When importing collaborators' files, the relationship is not visualized
   - No concept of "where did we diverge?"
   - Hard to understand the history of changes across multiple people

### User Pain Points

- "I want to see what the document looks like with Alice's intro vs Bob's intro before deciding"
- "I want to experiment with restructuring section 3, but I don't want to lose my current version"
- "I accepted the wrong hunk and now I have to start over"

---

## Design Goals

### Must Have

1. **Drafts live inside the `.kmd` file** - Self-contained, portable
2. **Drafts are short-lived** - Discourage long-running branches
3. **No silent switching** - Users always know they're on a draft
4. **Forced decision points** - Cannot ignore drafts forever
5. **Reconciliation creates a draft automatically** - Safe by default

### Nice to Have

1. **Import drafts from collaborators' files**
2. **Visual comparison between drafts**
3. **Named drafts with timestamps**

### Non-Goals

1. **Long-lived branches** - This is not git; drafts are temporary
2. **Complex branch hierarchies** - No branches of branches
3. **Merge conflicts between drafts** - Keep it simple

---

## Core Concepts

### The "Draft as Overlay" Model

```
┌─────────────────────────────────────────────────────┐
│                    MAIN DOCUMENT                     │
│                   (always sacred)                    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │           Draft: "Reconciling alice.kmd"     │    │
│  │           ───────────────────────────────    │    │
│  │           + Hunk 1: Added intro              │    │
│  │           + Hunk 3: Fixed typos              │    │
│  │           (overlay on main)                  │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │           Draft: "Experiment: new section"   │    │
│  │           ───────────────────────────────    │    │
│  │           + 45 new lines in section 3        │    │
│  │           (overlay on main)                  │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Key principle**: When viewing a draft, you see `main + draft changes` combined. Edits go to the draft, not main. Main is never modified until you explicitly merge.

### Draft Lifecycle

```
                    ┌──────────────┐
                    │   CREATED    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  ACTIVE  │ │  STALE   │ │ EXPIRED  │
        │ (< 24h)  │ │ (1-7d)   │ │  (> 7d)  │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             └────────────┼────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
        ┌──────────┐           ┌──────────┐
        │  MERGED  │           │ DISCARDED│
        └──────────┘           └──────────┘
```

### Draft States

| State | Age | UI Indicator | User Action |
|-------|-----|--------------|-------------|
| **Active** | < 24 hours | Green banner | Work freely |
| **Stale** | 1-7 days | Yellow warning | Reminder to resolve |
| **Expired** | > 7 days | Red warning | Urgent prompt |
| **Merged** | - | Removed | Applied to main |
| **Discarded** | - | Removed | Changes deleted |

---

## User Experience

### UX Principle: Always Know Where You Are

The UI must make it **impossible** to forget you're on a draft:

1. **Colored sidebar** - Different color when draft is active
2. **Persistent banner** - Non-dismissible header showing draft name
3. **Visual diff** - Draft changes highlighted in the editor
4. **Clear exit actions** - Merge, Discard, or Save for Later

### Scenario 1: Speculative Reconciliation

```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ DRAFT: Reconciling alice-edits.kmd                  [×]  │
│ Created: 5 minutes ago                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │  INCOMING CHANGES   │  │      LIVE PREVIEW           │  │
│  │                     │  │                             │  │
│  │  ☑ Hunk 1 (Alice)   │  │  # Introduction             │  │
│  │    Rewrote intro    │  │  This is Alice's new        │  │
│  │    +15 -3 lines     │  │  intro combined with...     │  │
│  │                     │  │                             │  │
│  │  ☐ Hunk 2 (Bob)     │  │  ## Section 2               │  │
│  │    Also rewrote     │  │  Original content here.     │  │
│  │    +8 -12 lines     │  │                             │  │
│  │                     │  │  ## Section 3               │  │
│  │  ☑ Hunk 3 (Alice)   │  │  With Alice's additions.    │  │
│  │    Added section    │  │                             │  │
│  │    +20 lines        │  │                             │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                             │
│  [Save as New Draft]  [Apply to Document]  [Discard All]   │
└─────────────────────────────────────────────────────────────┘
```

**Workflow:**
1. User clicks "Reconcile" → selects `alice-edits.kmd`
2. System creates draft: `"Reconciling alice-edits.kmd"`
3. All hunks shown unchecked; user toggles to preview
4. Live preview updates as hunks are selected
5. User can "Save as New Draft" to keep this combination
6. "Apply to Document" merges selected hunks to main
7. "Discard All" returns to main unchanged

### Scenario 2: Experimental Draft

```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ DRAFT: Experiment - new intro                       [×]  │
│ Created: 2 hours ago | +23 lines from main                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  # Introduction                                             │
│  ┌─ draft change ─────────────────────────────────────────┐ │
│  │ This is my experimental new introduction that I'm      │ │
│  │ trying out. It has a completely different tone.        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ## Background                                              │
│  The original content continues here unchanged...           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [Compare with Main]  [Merge to Document]  [Discard Draft]  │
└─────────────────────────────────────────────────────────────┘
```

**Workflow:**
1. User clicks "New Draft" → names it "Experiment - new intro"
2. System creates draft from current main state
3. User edits freely; changes go to draft
4. Draft changes highlighted with background color
5. "Compare with Main" shows side-by-side diff
6. "Merge to Document" applies changes to main
7. "Discard Draft" returns to main, deleting changes

### Scenario 3: Forced Decision on Close

When closing a document with unresolved drafts:

```
┌────────────────────────────────────────────────────────────┐
│                   Unresolved Drafts                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  You have 2 drafts that haven't been resolved:             │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 📝 "Reconciling alice-edits.kmd"                    │   │
│  │    Created: 3 hours ago | 5 hunks selected          │   │
│  │    [Merge]  [Keep for Later]  [Discard]             │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 📝 "Experiment - restructure"                       │   │
│  │    Created: 1 day ago | +45 lines                   │   │
│  │    [Merge]  [Keep for Later]  [Discard]             │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│           [Resolve All and Close]  [Cancel]                │
└────────────────────────────────────────────────────────────┘
```

### Scenario 4: Draft Manager Panel

```
┌────────────────────────────────────────────────────────────┐
│  Drafts                                              [+]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ● MAIN DOCUMENT (current)                                 │
│    Last edited: 5 minutes ago                              │
│                                                            │
│  ───────────────────────────────────────────────────────   │
│                                                            │
│  ○ Reconciling alice-edits.kmd                             │
│    Created: 2 hours ago | 3 hunks | +15 -8 lines           │
│    [View] [Merge] [Discard]                                │
│                                                            │
│  ○ Experiment - new section 3          ⚠️ Stale (3 days)   │
│    Created: 3 days ago | +45 lines                         │
│    [View] [Merge] [Discard]                                │
│                                                            │
│  ───────────────────────────────────────────────────────   │
│  [Compare Drafts]                                          │
└────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ draft-       │  │ draft-       │  │ speculative-         │   │
│  │ manager.js   │  │ ui.js        │  │ reconcile.js         │   │
│  │              │  │              │  │                      │   │
│  │ - CRUD ops   │  │ - Banner     │  │ - Hunk toggling      │   │
│  │ - State mgmt │  │ - Panel      │  │ - Live preview       │   │
│  │ - Lifecycle  │  │ - Indicators │  │ - Save as draft      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         └─────────────────┼──────────────────────┘               │
│                           │                                      │
│                    ┌──────▼───────┐                              │
│                    │ draft-       │                              │
│                    │ service.js   │                              │
│                    │              │                              │
│                    │ Tauri IPC    │                              │
│                    └──────┬───────┘                              │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                     ┌──────▼───────┐
                     │  Tauri IPC   │
                     └──────┬───────┘
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│                           │        BACKEND (Rust)                │
├───────────────────────────┼──────────────────────────────────────┤
│                    ┌──────▼───────┐                              │
│                    │ draft_       │                              │
│                    │ commands.rs  │                              │
│                    │              │                              │
│                    │ Tauri cmds   │                              │
│                    └──────┬───────┘                              │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                    │
│         │                 │                 │                    │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐           │
│  │ draft_       │  │ draft_       │  │ draft_       │           │
│  │ manager.rs   │  │ store.rs     │  │ merge.rs     │           │
│  │              │  │              │  │              │           │
│  │ - Lifecycle  │  │ - SQLite     │  │ - Apply to   │           │
│  │ - Validation │  │ - Yjs state  │  │   main       │           │
│  │ - Expiry     │  │ - CRUD       │  │ - Diff calc  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Data Structures

#### Draft (Frontend)

```typescript
interface Draft {
  id: string;                    // UUID
  name: string;                  // User-visible name
  type: 'reconciliation' | 'experiment';
  createdAt: number;             // Unix timestamp ms
  updatedAt: number;             // Unix timestamp ms
  state: 'active' | 'stale' | 'expired';

  // For reconciliation drafts
  sourceFile?: string;           // e.g., "alice-edits.kmd"
  selectedHunks?: string[];      // Array of hunk IDs

  // Statistics
  linesAdded: number;
  linesRemoved: number;

  // Parent reference
  parentStateVector: Uint8Array; // Yjs state vector at creation
}

interface DraftState {
  activeDraftId: string | null;  // Currently viewing draft
  drafts: Map<string, Draft>;    // All drafts
  mainState: Uint8Array;         // Main Yjs state
}
```

#### Draft (Backend/Rust)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub name: String,
    pub draft_type: DraftType,
    pub created_at: i64,
    pub updated_at: i64,
    pub source_file: Option<String>,
    pub selected_hunks: Vec<String>,
    pub lines_added: i32,
    pub lines_removed: i32,
    pub parent_state_vector: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DraftType {
    Reconciliation,
    Experiment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DraftState {
    Active,   // < 24 hours
    Stale,    // 1-7 days
    Expired,  // > 7 days
}
```

### Database Schema

Add to `history.sqlite`:

```sql
-- Draft metadata
CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    draft_type TEXT NOT NULL,         -- 'reconciliation' or 'experiment'
    created_at INTEGER NOT NULL,      -- Unix timestamp ms
    updated_at INTEGER NOT NULL,      -- Unix timestamp ms
    source_file TEXT,                 -- For reconciliation: source .kmd path
    selected_hunks TEXT,              -- JSON array of hunk IDs
    lines_added INTEGER DEFAULT 0,
    lines_removed INTEGER DEFAULT 0,
    parent_state_vector BLOB NOT NULL -- Yjs state vector at creation
);

-- Draft Yjs states (stored separately for efficiency)
CREATE TABLE draft_states (
    draft_id TEXT PRIMARY KEY,
    yjs_state BLOB NOT NULL,          -- Full Yjs state for this draft
    FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_drafts_created_at ON drafts(created_at);
CREATE INDEX idx_drafts_type ON drafts(draft_type);
```

### Tauri Commands

```rust
// Draft CRUD
#[tauri::command]
async fn create_draft(name: String, draft_type: String) -> Result<Draft, String>;

#[tauri::command]
async fn get_draft(id: String) -> Result<Draft, String>;

#[tauri::command]
async fn list_drafts() -> Result<Vec<Draft>, String>;

#[tauri::command]
async fn update_draft(id: String, updates: DraftUpdate) -> Result<Draft, String>;

#[tauri::command]
async fn delete_draft(id: String) -> Result<(), String>;

// Draft state management
#[tauri::command]
async fn get_draft_state(id: String) -> Result<Vec<u8>, String>;

#[tauri::command]
async fn save_draft_state(id: String, state: Vec<u8>) -> Result<(), String>;

// Draft operations
#[tauri::command]
async fn merge_draft_to_main(id: String) -> Result<(), String>;

#[tauri::command]
async fn create_reconciliation_draft(
    source_path: String,
    hunks: Vec<Hunk>
) -> Result<Draft, String>;

#[tauri::command]
async fn update_draft_hunks(
    id: String,
    selected_hunks: Vec<String>
) -> Result<DraftPreview, String>;

// Lifecycle
#[tauri::command]
async fn get_stale_drafts() -> Result<Vec<Draft>, String>;

#[tauri::command]
async fn check_draft_expiry() -> Result<DraftExpiryStatus, String>;
```

---

## File Format Changes

### Updated KMD Structure

```
document.kmd (ZIP archive)
├── format.json              # Updated version to 1.1.0
├── state.yjs                # Main document state (unchanged)
├── history.sqlite           # Updated schema with drafts tables
├── meta.json                # Unchanged
├── authors/                 # Unchanged
│   └── {uuid}.json
└── drafts/                  # NEW: Draft Yjs states
    ├── {draft-id-1}.yjs     # Draft state (binary Yjs)
    └── {draft-id-2}.yjs     # Draft state (binary Yjs)
```

### format.json Updates

```json
{
  "kmd_version": "1.1.0",
  "min_reader_version": "1.0.0",
  "features": {
    "drafts": true
  },
  "created_by": {
    "app": "korppi",
    "version": "0.3.0"
  },
  "compression": "deflate"
}
```

**Backward Compatibility:**
- `min_reader_version` stays at `1.0.0`
- Older readers will ignore the `drafts/` directory
- Drafts are stored in SQLite which older readers won't query
- Main document functionality is unaffected

---

## Implementation Plan

### Phase 0: Foundation (No User-Visible Changes)

#### Step 0.1: Database Schema
**Goal:** Add draft tables to SQLite without breaking existing functionality.

**Files:**
- `src-tauri/src/db_utils.rs` - Add migration for drafts tables

**Tasks:**
1. Add `drafts` table creation to schema
2. Add `draft_states` table creation
3. Add migration logic for existing documents
4. Write tests for schema creation

**Tests:**
- [ ] New document has drafts tables
- [ ] Existing document is migrated on open
- [ ] Tables have correct indexes

**Size:** ~50 lines of Rust

---

#### Step 0.2: Draft Data Structures
**Goal:** Define Rust structs and serialization for drafts.

**Files:**
- `src-tauri/src/models.rs` - Add Draft structs
- `src-tauri/src/draft_store.rs` - NEW: CRUD operations

**Tasks:**
1. Define `Draft`, `DraftType`, `DraftState` structs
2. Implement `Serialize`/`Deserialize`
3. Create `DraftStore` with basic CRUD
4. Write unit tests

**Tests:**
- [ ] Draft serializes to JSON correctly
- [ ] Draft deserializes from JSON correctly
- [ ] CRUD operations work on SQLite

**Size:** ~150 lines of Rust

---

#### Step 0.3: Tauri Commands (Backend)
**Goal:** Expose draft operations to frontend via Tauri IPC.

**Files:**
- `src-tauri/src/draft_commands.rs` - NEW: Tauri command handlers
- `src-tauri/src/lib.rs` - Register commands

**Tasks:**
1. Implement `create_draft` command
2. Implement `list_drafts` command
3. Implement `get_draft`, `update_draft`, `delete_draft`
4. Register all commands in Tauri

**Tests:**
- [ ] Commands are callable from frontend
- [ ] Error handling works correctly
- [ ] Commands are transactional

**Size:** ~200 lines of Rust

---

#### Step 0.4: Draft Service (Frontend)
**Goal:** Create frontend service to communicate with backend.

**Files:**
- `src/draft-service.js` - NEW: Tauri IPC wrapper

**Tasks:**
1. Create async functions for all Tauri commands
2. Add error handling and logging
3. Create TypeScript-style JSDoc types
4. Write integration tests

**Tests:**
- [ ] Service can create a draft
- [ ] Service can list drafts
- [ ] Service handles backend errors gracefully

**Size:** ~100 lines of JavaScript

---

### Phase 1: Draft Manager UI (Minimal Viable Feature)

#### Step 1.1: Draft Manager State
**Goal:** Create frontend state management for drafts.

**Files:**
- `src/draft-manager.js` - NEW: State management

**Tasks:**
1. Create `DraftManager` class
2. Implement `loadDrafts()` on document open
3. Implement `createDraft()`, `deleteDraft()`
4. Track `activeDraftId`
5. Emit events on state changes

**Tests:**
- [ ] State loads correctly on document open
- [ ] Creating draft updates state
- [ ] Deleting draft updates state

**Size:** ~150 lines of JavaScript

---

#### Step 1.2: Draft Panel UI
**Goal:** Add draft list panel to sidebar.

**Files:**
- `src/draft-ui.js` - NEW: Draft panel component
- `src/styles.css` - Draft panel styles
- `src/main.js` - Integrate panel

**Tasks:**
1. Create draft panel HTML structure
2. Implement draft list rendering
3. Add "New Draft" button
4. Add View/Merge/Discard buttons per draft
5. Style the panel

**Tests:**
- [ ] Panel shows in sidebar
- [ ] Drafts are listed correctly
- [ ] Buttons trigger correct actions

**Size:** ~200 lines of JavaScript, ~50 lines of CSS

---

#### Step 1.3: Create Experiment Draft
**Goal:** User can create an experiment draft from current state.

**Files:**
- `src/draft-manager.js` - Add creation logic
- `src/draft-ui.js` - Wire up "New Draft" button

**Tasks:**
1. Implement "New Draft" dialog (name input)
2. Create draft with snapshot of current Yjs state
3. Switch view to new draft
4. Show draft banner

**Tests:**
- [ ] Can create named draft
- [ ] Draft contains current document state
- [ ] UI switches to draft view

**Size:** ~100 lines of JavaScript

---

#### Step 1.4: Draft Banner
**Goal:** Show persistent banner when viewing a draft.

**Files:**
- `src/draft-ui.js` - Add banner component
- `src/styles.css` - Banner styles

**Tasks:**
1. Create banner HTML (name, age, actions)
2. Show banner when `activeDraftId` is set
3. Add Merge/Discard buttons to banner
4. Style with distinct color (not dismissible)

**Tests:**
- [ ] Banner shows when on draft
- [ ] Banner hidden when on main
- [ ] Banner shows correct draft name

**Size:** ~80 lines of JavaScript, ~30 lines of CSS

---

#### Step 1.5: Switch Between Main and Drafts
**Goal:** User can switch between main document and drafts.

**Files:**
- `src/draft-manager.js` - Switching logic
- `src/editor.js` - Integrate with Yjs

**Tasks:**
1. Implement `switchToDraft(id)` - load draft Yjs state
2. Implement `switchToMain()` - restore main state
3. Save current state before switching
4. Update editor with new state

**Tests:**
- [ ] Switching to draft shows draft content
- [ ] Switching to main shows main content
- [ ] Edits on draft don't affect main
- [ ] Edits on main don't affect draft

**Size:** ~100 lines of JavaScript

---

#### Step 1.6: Merge Draft to Main
**Goal:** User can apply draft changes to main document.

**Files:**
- `src-tauri/src/draft_merge.rs` - NEW: Merge logic
- `src/draft-manager.js` - Trigger merge

**Tasks:**
1. Implement Yjs state merge (draft → main)
2. Create patch for history ("Merged draft: X")
3. Delete draft after merge
4. Switch view to main
5. Show success notification

**Tests:**
- [ ] Merge applies all draft changes to main
- [ ] Merge creates history entry
- [ ] Draft is deleted after merge
- [ ] Main shows merged content

**Size:** ~100 lines of Rust, ~50 lines of JavaScript

---

#### Step 1.7: Discard Draft
**Goal:** User can delete a draft without merging.

**Files:**
- `src/draft-manager.js` - Delete logic

**Tasks:**
1. Show confirmation dialog
2. Delete draft from database
3. If currently viewing, switch to main
4. Update draft panel

**Tests:**
- [ ] Confirmation dialog appears
- [ ] Draft is deleted
- [ ] View switches to main if needed

**Size:** ~50 lines of JavaScript

---

### Phase 2: Draft Lifecycle & Safety

#### Step 2.1: Draft Age Calculation
**Goal:** Calculate and display draft age/staleness.

**Files:**
- `src/draft-manager.js` - Age utilities
- `src/draft-ui.js` - Display age

**Tasks:**
1. Add `getDraftState(draft)` → active/stale/expired
2. Add human-readable age ("2 hours ago", "3 days ago")
3. Update panel to show age
4. Style differently based on state

**Tests:**
- [ ] Fresh draft shows as "active"
- [ ] 2-day old draft shows as "stale"
- [ ] 8-day old draft shows as "expired"

**Size:** ~60 lines of JavaScript

---

#### Step 2.2: Stale Draft Warnings
**Goal:** Show warnings for stale/expired drafts.

**Files:**
- `src/draft-ui.js` - Warning indicators

**Tasks:**
1. Add yellow warning icon for stale drafts
2. Add red warning icon for expired drafts
3. Show tooltip with explanation
4. Update banner color for stale/expired

**Tests:**
- [ ] Stale draft shows yellow indicator
- [ ] Expired draft shows red indicator
- [ ] Tooltips explain the warning

**Size:** ~40 lines of JavaScript, ~20 lines of CSS

---

#### Step 2.3: Forced Decision on Close
**Goal:** Prompt user to resolve drafts when closing document.

**Files:**
- `src/draft-manager.js` - Close handler
- `src/draft-ui.js` - Resolution dialog
- `src/main.js` - Integrate with close flow

**Tasks:**
1. Hook into document close event
2. Check for unresolved drafts
3. Show resolution dialog if drafts exist
4. Block close until resolved

**Tests:**
- [ ] Closing with drafts shows dialog
- [ ] Can merge/keep/discard from dialog
- [ ] Close proceeds after resolution
- [ ] Can cancel close

**Size:** ~150 lines of JavaScript

---

#### Step 2.4: Startup Draft Check
**Goal:** Show draft status when opening document.

**Files:**
- `src/draft-manager.js` - Startup check
- `src/draft-ui.js` - Notification

**Tasks:**
1. On document open, check for existing drafts
2. Show notification if stale/expired drafts exist
3. Offer quick actions (view, merge, discard)

**Tests:**
- [ ] Opening doc with drafts shows notification
- [ ] Notification shows correct draft count
- [ ] Quick actions work

**Size:** ~60 lines of JavaScript

---

### Phase 3: Speculative Reconciliation

#### Step 3.1: Reconciliation Creates Draft
**Goal:** When user clicks Reconcile, create a draft automatically.

**Files:**
- `src/reconcile.js` - Modify to create draft
- `src/draft-manager.js` - Integration

**Tasks:**
1. Modify `startReconciliation()` to create draft first
2. Name draft "Reconciling: {filename}"
3. Set `draft_type` to "reconciliation"
4. Store source file path

**Tests:**
- [ ] Reconcile creates a draft
- [ ] Draft has correct name and type
- [ ] Source file is recorded

**Size:** ~50 lines of JavaScript

---

#### Step 3.2: Hunk Selection State
**Goal:** Track which hunks are selected in reconciliation draft.

**Files:**
- `src/reconcile.js` - Selection state
- `src/draft-manager.js` - Persist selection

**Tasks:**
1. Add `selectedHunks` array to reconciliation draft
2. Update selection when user toggles hunk
3. Persist selection to backend
4. Load selection on draft switch

**Tests:**
- [ ] Toggling hunk updates selection
- [ ] Selection persists across switches
- [ ] Selection saved to database

**Size:** ~80 lines of JavaScript

---

#### Step 3.3: Live Preview
**Goal:** Show document preview with selected hunks applied.

**Files:**
- `src/speculative-reconcile.js` - NEW: Preview logic
- `src/reconcile.js` - Integration

**Tasks:**
1. Create function to apply selected hunks to base state
2. Update preview when selection changes
3. Debounce updates for performance
4. Show diff highlighting in preview

**Tests:**
- [ ] Preview updates when hunks toggled
- [ ] Preview shows correct combined result
- [ ] Performance is acceptable

**Size:** ~150 lines of JavaScript

---

#### Step 3.4: Hunk Toggle UI
**Goal:** Replace accept/reject with toggle checkboxes.

**Files:**
- `src/hunk-review-panel.js` - Modify UI
- `src/styles.css` - Checkbox styles

**Tasks:**
1. Replace Accept/Reject buttons with checkboxes
2. Add "Select All" / "Deselect All" buttons
3. Show selection count in header
4. Style checked vs unchecked hunks

**Tests:**
- [ ] Checkboxes toggle selection
- [ ] Select All works
- [ ] Deselect All works

**Size:** ~100 lines of JavaScript, ~30 lines of CSS

---

#### Step 3.5: Apply Reconciliation
**Goal:** Apply selected hunks to main document.

**Files:**
- `src/speculative-reconcile.js` - Apply logic
- `src/draft-manager.js` - Trigger merge

**Tasks:**
1. Create final state with selected hunks
2. Merge to main document
3. Create history entry listing applied hunks
4. Delete reconciliation draft
5. Show success notification

**Tests:**
- [ ] Only selected hunks are applied
- [ ] History entry is correct
- [ ] Draft is deleted

**Size:** ~100 lines of JavaScript

---

#### Step 3.6: Save as Named Draft
**Goal:** Save current hunk selection as a named draft for later.

**Files:**
- `src/speculative-reconcile.js` - Save logic
- `src/draft-ui.js` - Save dialog

**Tasks:**
1. Add "Save as Draft" button
2. Show name input dialog
3. Create new experiment draft with current preview state
4. Keep reconciliation draft open

**Tests:**
- [ ] Can save selection as new draft
- [ ] New draft has preview content
- [ ] Original reconciliation draft unchanged

**Size:** ~80 lines of JavaScript

---

### Phase 4: Polish & Enhancements

#### Step 4.1: Draft Comparison View
**Goal:** Compare two drafts side-by-side.

**Files:**
- `src/draft-compare.js` - NEW: Comparison view
- `src/styles.css` - Comparison styles

**Tasks:**
1. Create split-pane comparison view
2. Implement diff highlighting between drafts
3. Add "Compare" button to draft panel
4. Allow selecting two drafts to compare

**Size:** ~200 lines of JavaScript, ~50 lines of CSS

---

#### Step 4.2: Import Drafts from Collaborators
**Goal:** When importing .kmd, option to import their drafts too.

**Files:**
- `src-tauri/src/kmd.rs` - Read drafts from imported file
- `src/reconcile.js` - Draft import UI

**Tasks:**
1. Parse drafts from imported .kmd
2. Show dialog listing available drafts
3. Allow user to select which to import
4. Import selected drafts with "Imported from: X" prefix

**Size:** ~150 lines of Rust, ~100 lines of JavaScript

---

#### Step 4.3: Draft Keyboard Shortcuts
**Goal:** Add keyboard shortcuts for draft operations.

**Files:**
- `src/keyboard-shortcuts.js` - Add draft shortcuts

**Tasks:**
1. `Cmd+Shift+N` - New draft
2. `Cmd+Shift+M` - Merge current draft
3. `Cmd+Shift+D` - Discard current draft
4. `Cmd+Shift+0` - Switch to main

**Size:** ~30 lines of JavaScript

---

#### Step 4.4: Draft Statistics
**Goal:** Show detailed statistics for each draft.

**Files:**
- `src/draft-ui.js` - Stats display
- `src/draft-manager.js` - Calculate stats

**Tasks:**
1. Calculate lines added/removed
2. Calculate word count difference
3. Show in draft panel tooltip
4. Update on draft change

**Size:** ~80 lines of JavaScript

---

## Testing Strategy

### Unit Tests

| Module | Test File | Coverage |
|--------|-----------|----------|
| Draft store (Rust) | `src-tauri/src/draft_store.test.rs` | CRUD, queries |
| Draft merge (Rust) | `src-tauri/src/draft_merge.test.rs` | Yjs merging |
| Draft manager (JS) | `src/draft-manager.test.js` | State management |
| Speculative reconcile (JS) | `src/speculative-reconcile.test.js` | Preview logic |

### Integration Tests

1. **Draft lifecycle** - Create → Edit → Merge → Verify main updated
2. **Draft persistence** - Create → Close → Reopen → Verify draft exists
3. **Reconciliation flow** - Import → Toggle hunks → Preview → Apply
4. **Edge cases** - Empty draft, draft with no changes, expired draft

### Manual Testing Checklist

- [ ] Create experiment draft, edit, merge
- [ ] Create experiment draft, edit, discard
- [ ] Reconcile with all hunks selected
- [ ] Reconcile with some hunks selected
- [ ] Save reconciliation as named draft
- [ ] Close document with unresolved draft
- [ ] Open document with stale draft
- [ ] Compare two drafts
- [ ] Import drafts from collaborator file

---

## Migration & Compatibility

### Backward Compatibility

- Documents with drafts can be opened by older Korppi versions
- Older versions will see the main document only (drafts ignored)
- No data loss; drafts are silently preserved

### Forward Compatibility

- New Korppi opens old documents without drafts
- Migration adds drafts tables to SQLite on first open
- No user action required

### Migration Steps

When opening a document:

1. Check `format.json` version
2. If < 1.1.0, run migration:
   - Add `drafts` table to SQLite
   - Add `draft_states` table to SQLite
   - Update `format.json` to 1.1.0
3. Continue with normal open

---

## Future Extensions

### Not in Scope (But Considered)

1. **Branches of branches** - Too complex, git-like
2. **Automatic draft cleanup** - Risky data loss
3. **Draft sharing** - Security/privacy concerns
4. **Real-time draft sync** - Conflicts with offline-first

### Potential Future Features

1. **Draft templates** - Pre-defined draft configurations
2. **Draft history** - Undo/redo within a draft
3. **Draft comments** - Comments specific to a draft
4. **Draft approval workflow** - Require approval before merge

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Draft** | A temporary, named branch of the document |
| **Main** | The primary document state (not a draft) |
| **Overlay** | Draft changes shown on top of main |
| **Merge** | Apply draft changes to main |
| **Discard** | Delete draft without applying changes |
| **Reconciliation Draft** | Draft created during reconciliation |
| **Experiment Draft** | Draft created manually for experimentation |
| **Stale** | Draft older than 24 hours but less than 7 days |
| **Expired** | Draft older than 7 days |

---

## Appendix B: UI Mockups Reference

See inline ASCII mockups in [User Experience](#user-experience) section.

---

## Appendix C: Related Documents

- [KMD Specification](KMD_SPECIFICATION.md) - File format details
- [Conflict Detection](CONFLICT_DETECTION.md) - Conflict handling
- [Reconcile Documentation](docs/reconcile.md) - Current reconciliation flow
