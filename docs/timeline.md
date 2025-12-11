# Timeline & History

Every change you make is tracked in Korppi's timeline.

---

## What is the Timeline?

The Timeline is your document's history. It shows:

- Every significant edit as a "patch"
- When changes were made
- What was added, removed, or modified

Think of it as **version control for writers**.

---

## The Timeline Panel

Find the timeline in the **right sidebar**:

```
┌─────────────────────┐
│  TIMELINE           │
├─────────────────────┤
│  Dec 7, 2:30 PM     │
│  Added introduction │
│                     │
│  Dec 7, 2:15 PM     │
│  Created document   │
└─────────────────────┘
```

---

## Understanding Patches

### What Creates a Patch?

Patches are created automatically when you:

- Pause typing for a moment
- Make a significant change
- Switch focus away from the editor

### Patch Information

Each patch shows:

- **Timestamp** - When it was created
- **Kind** - Type of change (e.g., Save)
- **Author** - Who made the change
- **Status** - Pending, accepted, or rejected (indicated by badges)
- **Conflict** - Warning if the patch conflicts with others

---

## Viewing History

### Preview a Version

1. Click the **Preview** button (🔍) on any patch.
2. The editor shows a diff view:
    - **Red**: Content removed
    - **Green**: Content added
    - **Grey**: Unchanged context

### Exit Preview

Click **Exit Preview** in the editor or click the preview button again to return to the current version.

---

## Restoring Versions

### Restore a Past Version

1. Find the version you want to restore.
2. Click the **Restore** button (↩).
3. Confirm the action.

⚠️ **Warning:** This replaces your current document with the historical version!

### What Gets Restored

- Document content at that point
- Formatting and structure

### What Doesn't Get Restored

- Comments (they maintain their own state)
- Future patches (they're preserved in history)

---

## Patch Status

### Pending

New patches from other authors are "pending" until you review them.

### Accepted

Patches that have been merged into the document.

### Rejected

Patches that were declined. They remain in the history but are not applied.

---

## Conflict Resolution

If a patch conflicts with your current version (e.g., you both edited the same line), it will be flagged with a **Conflict** warning.

Use the **Merge Wizard** (accessible via the "Reconcile" button) to resolve these conflicts step-by-step.

---

## Filtering the Timeline

### By Status

Use the dropdown to filter:

- **All** - Show everything
- **Pending** - Only unreviewed
- **Accepted** - Only accepted
- **Rejected** - Only rejected

### By Author

Filter patches to show only changes made by a specific author.

---

## Sorting Options

Sort patches by:

- **Newest First** - Most recent at top
- **Oldest First** - Chronological order
- **By Author** - Grouped by author
- **By Line Order** - Sorted by affected lines

---

## Pending Patches Counter

The status bar shows:

```
📋 5 patches
```

This counts **pending** patches that need review.

---

## Best Practices

### Regular Checkpoints

- Save frequently to create restore points
- Major edits create clear patches

### Review Pending Patches

- Check the timeline after reconciliation
- Approve or reject imported changes

### Use Preview

- Always preview before restoring
- Check what you'll lose vs. gain

---

## Related

- [Reconciliation](reconciliation.html) - Importing changes
- [Comments](comments.html) - Adding review comments
