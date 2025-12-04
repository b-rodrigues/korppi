# Korppi

Korppi is a text editor that tries to focus on one problem, and one problem only: how to 
easily integrate changes from various collaborators into a main document. 
It is meant for business users that aren’t familiar with Git and use Microsoft Office’s
*track changes* functionality for asynchronous collaboration. 

## Why Korppi?

Most text editors only remember the text you have *right now*. 
If you delete a paragraph and save the file, that paragraph is gone forever.
Korppi is different. It records everything you do as "patches".

### A document is just a series of patches

Instead of just a list of keystrokes, Korppi organizes your history into patches, and a document
is nothing but a series of patches. It is posible to browse patches in a timeline and and instantly jump back to any point in the past.

### All-in-One Files
Korppi saves your document, its entire history, and your settings into a single file (ending in `.kmd`). You can:
- Email it to a friend.
- Save it to a USB drive.
- Back it up to the cloud.

The history travels with the file, so you (or your collaborators) can always see how the document evolved.

### Asynchronous collaboration
Because each document incorporates its own history, when your colleagues edit their copies of the file, you can
import their patches into your main document, and reconcile all versions of the document back into one, clean document.
All patch can be either accepted or rejected, but rejected patches aren’t deleted: they’re just not going to be used
to create the final, clean document.

### Crash-Proof & Conflict-Free
Korppi is built to be robust. It saves your work automatically and uses advanced technology (similar to what Google Docs uses) 
to merge changes intelligently. You don't have to worry about "conflicted copies" or losing work.

### Private & Offline
Korppi runs 100% on your computer. There is no central server, no account to sign up for, and no subscription fee. 
Also it’s open source.

## Getting Started

Start by dowloading Korppi [here]().

1.  **Open Korppi.**
2.  **Start Writing.** You can use standard Markdown shortcuts (like `**bold**` or `*italic*`) or just type.
3.  **Check the Timeline.** Click the clock icon to see your history grow as you write.
4.  **Send a copy.** Collaborators can then add their changes to their own copies and send them back to you.
5.  **Reconcile versions.** You can now easily reconcile all versions of the document easily into one clean document.

## For Developers

Korppi is a desktop application built with web technologies and Rust.

*   **Frontend:** Tauri, Milkdown (Markdown editor), Yjs (Collaboration/Sync)
*   **Backend:** Rust, SQLite (History storage)

To run the project from source, you only need to have Nix installed.

```bash
nix develop
```

The first time you build the project, run:

```bash
npm install
```

then:

```bash
korppi-dev
```
