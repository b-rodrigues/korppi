# The Korppi Rationale

Why did we build Korppi? To solve the "Reconciliation Hell" that plagues
business users and writers who need version control but cannot use Git.

---

## The Problem: Reconciliation Hell

Collaborating on documents is often a messy process. You email a Word document
to a colleague, they make changes and email it back. Meanwhile, you've made your
own changes. Now you have `report_v2.docx` and `report_final_bob_edits.docx`.
Merging them is a manual, error-prone nightmare.

### The "Git Gap"

Developers solved this problem decades ago with Git. Git allows for:
- **Granular history** (commits)
- **Branching and merging**
- **Conflict resolution**

However, Git is too complex for most non-technical users. The command line,
concepts like "staging areas" and "rebasing," and the fear of "breaking the
repo" make it inaccessible.

We've tried for 15 years to teach everyone Git. It hasn't worked.

---

## The Solution: Git Power, Human Interface

Korppi brings the power of a Git-like workflow to a tool that feels familiar to
anyone who has used a word processor.

### 1. Patches, Not Just Versions

In traditional editors, "Track Changes" is a mode you turn on or off. In Korppi, **everything is a patch**.
- Every time you save or pause, Korppi records the difference (diff) as a discrete unit of change.
- These patches are stored in the document history, allowing you to replay, undo, or cherry-pick specific changes.
- **Why?** This allows for granular control. You can accept *just* the paragraph your editor fixed without accepting their deletion of your favorite section.

### 2. The Timeline

Instead of a cryptic list of commit hashes, Korppi presents a visual **Timeline**.
- See the evolution of your document chronologically.
- Filter changes by author or date.
- "Time travel" to any previous state of the document instantly.

### 3. Asynchronous Reconciliation

Real-time collaboration (Google Docs style) is great, but not everyone has
access to such a tool, and many still work asynchronously the old school way, by
emailing documents back and forth.

Korppi promotes an **Asynchronous Workflow**:
1. **Draft** in peace on your local machine.
2. **Send** your `.kmd` file to a collaborator.
3. **Reconcile** their changes when you get the file back.

You can either accept their changes wholesale, or go *hunk by hunk*. And you can
reconcile as many files at the same time as needed!

### 4. Content First, Formatting Later

Korppi is a **Markdown-based** editor. We believe that writing and formatting are separate tasks.
- **Write** in Korppi to focus on structure and content.
- **Export** to Word for the final polish.

This separation prevents the "fighting with the margin" syndrome and ensures
your content is clean, portable, and future-proof.

---

## Technical Underpinnings

For the technically curious, Korppi is built on modern, robust technologies:

- **Tauri**: For a lightweight, secure, and cross-platform desktop application.
- **CRDTs (Yjs)**: We use Conflict-free Replicated Data Types to handle document state. This ensures that even complex merges can be handled mathematically correctly before human review.
- **.kmd Format**: Your document is just a ZIP file containing standard Markdown and JSON metadata. You are never locked in. You can unzip a `.kmd` file and read your text with Notepad.

---

## Summary

Korppi is not trying to replace Word for formatting. It is trying to replace the *process* of emailing "final_v2_revised.docx" back and forth. It is version control for the normies.
