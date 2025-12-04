# Korppi

**The smart notebook that remembers everything.**

Korppi is a simple, beautiful app for writing. It combines the clean experience of a Markdown editor with a powerful history engine that ensures you never lose an idea.

## Why Korppi?

Most text editors only remember the text you have *right now*. If you delete a paragraph and save the file, that paragraph is gone forever.

Korppi is different. It records your writing journey.

### ✨ Meaningful History
Instead of just a list of keystrokes, Korppi organizes your history into "meaningful changes." It understands when you've added a new section, fixed a typo, or rewritten a sentence. You can browse this timeline and instantly jump back to any point in the past.

### 📦 All-in-One Files
Korppi saves your document, its entire history, and your settings into a single file (ending in `.kmd`). You can:
- Email it to a friend.
- Save it to a USB drive.
- Back it up to the cloud.

The history travels with the file, so you (or your collaborators) can always see how the document evolved.

### 🛡️ Crash-Proof & Conflict-Free
Korppi is built to be robust. It saves your work automatically and uses advanced technology (similar to what Google Docs uses) to merge changes intelligently. You don't have to worry about "conflicted copies" or losing work.

### 🔒 Private & Offline
Korppi runs 100% on your computer. There is no central server, no account to sign up for, and no subscription fee. Your writing stays with you.

## Getting Started

1.  **Open Korppi.**
2.  **Start Writing.** You can use standard Markdown shortcuts (like `**bold**` or `*italic*`) or just type.
3.  **Check the Timeline.** Click the clock icon to see your history grow as you write.

## For Developers

Korppi is a desktop application built with web technologies and Rust.

*   **Frontend:** Tauri, Milkdown (Markdown editor), Yjs (Collaboration/Sync)
*   **Backend:** Rust, SQLite (History storage)

To run the project from source, you need Node.js and Rust installed.

```bash
npm install
npm run tauri dev
```
