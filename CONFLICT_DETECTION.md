# Conflict Detection and Visualization Feature

## Overview

This feature automatically detects conflicts between patches that modify the same text regions and provides visual indicators and tabbed comparison views to help users resolve conflicts.

## Key Features

### 1. Automatic Conflict Detection

When a document is opened or after reconciliation imports patches, the system:
- Analyzes all patches with snapshot content
- Identifies overlapping edits based on character ranges
- Groups conflicting patches together
- Displays an alert summarizing detected conflicts

### 2. Visual Timeline Indicators

Patches involved in conflicts are highlighted in the timeline with:
- **Red border** on the timeline item
- **Red background tint** for visibility
- **Warning text** showing which other patches conflict (e.g., "⚠️ Conflicts with #3, #5")

### 3. Tabbed Diff Preview

When previewing a patch that's part of a conflict group:
- **Conflict tabs** appear in the preview banner
- Each tab represents a patch in the conflict group
- Clicking a tab switches the diff view to that patch
- The active patch is highlighted in red
- Users can compare all conflicting patches side-by-side

### 4. Alert Notifications

When conflicts are detected:
- An alert appears showing the number of conflict groups
- Details about each group are listed (e.g., "Patches #3, #5 modify the same text")
- Alerts are rate-limited to avoid spam during filtering/sorting

## Implementation Details

### Files Modified/Created

| File | Purpose |
|------|---------|
| `src/conflict-detection.js` | **NEW** - Core conflict detection logic |
| `src/timeline.js` | Updated to integrate conflict detection and display indicators |
| `src/diff-preview.js` | Updated to show conflict tabs and enable tab switching |
| `src/reconcile.js` | Updated to trigger conflict detection after import |
| `src/styles.css` | Added styles for conflict indicators and tabs |

### Conflict Detection Algorithm

The algorithm works as follows:

1. **Extract Edit Ranges**: For each patch, calculate character ranges affected by changes
   - Compare current snapshot with previous patch snapshot
   - Use character-level diff to identify insertions, deletions, and modifications
   - Merge adjacent/overlapping ranges

2. **Find Overlaps**: Compare edit ranges between patches from different authors
   - Skip comparisons between patches from the same author
   - Check if character ranges overlap
   - Record conflict relationships

3. **Group Conflicts**: Use breadth-first search to group related conflicts
   - If A conflicts with B, and B conflicts with C, they form one group [A, B, C]
   - Separate groups are maintained for independent conflicts

### Key Functions

#### `conflict-detection.js`

```javascript
// Main detection function
detectPatchConflicts(patches)
// Returns: { conflictGroups, patchConflicts }

// Check if a patch is in conflict
isInConflict(patchId, patchConflicts)
// Returns: boolean

// Get conflict group for a patch
getConflictGroup(patchId, conflictGroups)
// Returns: Array of patch IDs or null

// Format conflict info for display
formatConflictInfo(patchId, conflictingPatchIds)
// Returns: string like "⚠️ Conflicts with #3, #5"
```

#### `timeline.js`

```javascript
// Get current conflict state
getConflictState()
// Returns: { conflictGroups, patchConflicts }
```

## User Experience Flow

1. **Document Open or Reconciliation**
   - System automatically detects conflicts
   - Alert appears if conflicts found

2. **Timeline View**
   - Conflicting patches show red borders
   - Warning text indicates which patches conflict
   - Users can see at a glance which edits need attention

3. **Preview Mode**
   - Click "Preview" on any conflicting patch
   - Tabs appear for all patches in that conflict group
   - Switch between tabs to compare changes
   - Accept or reject individual patches

4. **Resolution**
   - Accept one patch (merges it into the document)
   - Reject others or keep for later review
   - Conflicts resolved by accepting/rejecting decisions

## Styling

### Timeline Conflict Indicators

```css
.timeline-item.has-conflict {
    border-left: 3px solid #f44336;
    border-color: #f44336;
    background: rgba(244, 67, 54, 0.1);
}

.conflict-warning {
    color: #f44336;
    font-size: 0.75rem;
    font-weight: 500;
}
```

### Conflict Tabs

```css
.conflict-tab {
    border: 1px solid #f44336;
    background: var(--bg-panel);
}

.conflict-tab.active {
    background: #f44336;
    color: white;
    font-weight: bold;
}
```

## Testing

### Manual Testing Scenarios

1. **No Conflicts**
   - Open document with patches from one author
   - Verify no red indicators appear
   - Verify no alert is shown

2. **Simple Conflict**
   - Import patches where two authors edit the same paragraph
   - Verify red borders appear on both patches
   - Verify alert shows conflict group
   - Click preview - verify tabs appear
   - Switch tabs - verify diff updates

3. **Multiple Conflict Groups**
   - Import patches with:
     - Patches A & B editing line 1 (Group 1)
     - Patches C & D editing line 10 (Group 2)
   - Verify each group is separate
   - Preview A - should only show A & B tabs
   - Preview C - should only show C & D tabs

4. **Three-Way Conflict**
   - Import patches where 3+ authors edit same text
   - Verify all appear in same conflict group
   - Preview any - verify all tabs appear

### Automated Testing

A test HTML file is provided at `test-conflict-detection.html` which can be opened in a browser to verify:
- Non-overlapping patches detection
- Overlapping edits detection
- Same-author filtering
- Multiple conflict groups
- Edge cases (empty, single patch)

## Performance Considerations

- Conflict detection runs on every timeline refresh
- Algorithm is O(n²) where n = number of patches
- For typical documents (< 100 patches), this is negligible
- Alert is rate-limited to once per 5 seconds
- Conflict state is cached and only recalculated on data changes

## Future Enhancements

Potential improvements:
1. Persist conflict resolutions across sessions
2. Add "Accept All" / "Reject All" for conflict groups
3. Show diff between conflicting versions side-by-side
4. Highlight exact overlapping text regions in preview
5. Suggest automatic merge strategies
6. Add conflict statistics/dashboard

## Dependencies

- `diff-highlighter.js` - Character-level diff calculation
- `timeline.js` - Patch list and filtering
- `diff-preview.js` - Preview mode and banner
- `three-way-merge.js` - Merge logic for accepting patches

## Browser Compatibility

Requires modern browsers with ES6+ support:
- Chrome/Edge 88+
- Firefox 78+
- Safari 14+

## Credits

Implemented as part of the Korppi collaborative editing system.
Based on the existing ConflictDetector in Rust (`src-tauri/src/conflict_detector.rs`).
