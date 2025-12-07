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
- **Description** - What changed
- **Status** - Pending, approved, or rejected
- **Lines affected** - Which parts of the document

---

## Viewing History

### Preview a Version

1. Click any patch in the timeline
2. The **Details** panel expands
3. Click **Preview** to see that version

The editor shows the document as it was at that point.

### Exit Preview

Click **Exit Preview** or select a different patch to return to the current version.

---

## Restoring Versions

### Restore a Past Version

1. Select a patch
2. Click **Restore**
3. Confirm the action

⚠️ **Warning:** This replaces your current document with the historical version!

### What Gets Restored

- Document content at that point
- Formatting and structure

### What Doesn't Get Restored

- Comments (they maintain their own state)
- Future patches (they're preserved)

---

## Patch Status

### Pending

New patches from reconciliation are "pending" until you review them:

- **Approve** - Accept the change
- **Reject** - Discard the change

### Approved

Patches you've accepted. They're part of your document history.

### Rejected

Changes you've declined. They're hidden but not deleted.

---

## Filtering the Timeline

### By Status

Use the dropdown to filter:

- **All** - Show everything
- **Pending** - Only unreviewed
- **Approved** - Only accepted

### By Line Range

Filter patches that affect specific lines:

1. Open line range filter
2. Enter start and end lines
3. Only matching patches appear

---

## Sorting Options

Sort patches by:

- **Newest First** - Most recent at top
- **Oldest First** - Chronological order
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
