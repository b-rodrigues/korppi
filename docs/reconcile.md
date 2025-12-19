# Reconciliation & Version Control

Korppi provides powerful tools to manage document history and collaborate with
others through **Reconciliation**. This allows you to import changes from other
`.kmd` files, review them, and manage versions.

---

## 1. The Workflow

### Step 1: Import Changes
1.  Save your current document.
2.  Click **Reconcile** in the left sidebar.
3.  Select the `.kmd` file (or files) you want to import (e.g., a version from a reviewer).

### Step 2: Review Process
Once reconciliation starts, you will see a notification guiding you to two key tabs in the right sidebar:

*   **Track Changes:** For reviewing individual text edits.
*   **Timeline:** For managing the entire document history.

---

## 2. Visualizing Changes

### Track Changes Tab (Individual Edits)
This tab focuses on the *specifics*. It breaks down the difference between your document and the imported version into small "Hunks".

*   **View:** See exactly which lines were added (Green), removed (Red), or modified.
*   **Review:** Scroll through the list to understand the granular impact of the import.
*   **Reset:** If the changes aren't what you expected, click **Reset to Original** to discard the import and revert to your pre-reconciliation state.

### Timeline Tab (Whole History)
The Timeline acts as your **Version Control**. Here, you can visualize different versions of your document saved at different points
in time, or other versions that you’ve imported during reconciliation.

---

## 3. Restoring Versions

You have multiple ways to undo or revert changes:

### Reset to Original
Located in the **Track Changes** and **Timeline** tabs.
*   **Action:** Instantly reverts the document to the state *before* you started the current reconciliation.
*   **Use Case:** You imported the wrong file or want to restart the review process from scratch.

### Restore from Timeline
Located on each item in the **Timeline**.
*   **Action:** Replaces your *entire* current document with that specific historical version.
*   **Use Case:** Recovering an old draft or undoing a series of bad edits.
*   **Warning:** This overwrites your current content (though the overwrite itself becomes a new history entry).

---

## 4. Best Practices

1.  **Save Often:** Frequent saves create more timeline entries, giving you more "undo points".
2.  **Review Before Accepted:** Use the **Track Changes** tab to verify imported text before considering it "done".
3.  **Collaborate:** Use the Export/Import workflow to share `.kmd` files with others. Reconciliation handles the merging logic for you.

---

## Related
-   [File Format](file-format.html) - About .kmd files
-   [Comments](comments.html) - managing feedback
