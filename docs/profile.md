# User Profile

Your profile is your identity in Korppi. It ensures that your contributions—whether they are document edits, comments, or patches—are correctly attributed to you.

---

## Why Set Up a Profile?

Korppi is designed for collaboration. Even if you work alone, maintaining a consistent identity helps track the history of your document.

When you set up your profile, Korppi uses this information to:

1.  **Tag Your Patches**: Every change you make is recorded as a patch. Your profile attaches your name and unique ID to these patches, so you (and others) know who did what.
2.  **Attribute Comments**: When you leave feedback or notes, your name and avatar appear next to them.
3.  **Color-Code Contributions**: You can choose a unique color. In the timeline and conflict resolution views, your changes will be highlighted in this color, making them instantly recognizable.

---

## Configuring Your Profile

You can update your profile at any time.

1.  **Open Settings**: Click on your **avatar** (or initials) in the top-left corner of the application window.
2.  **Edit Details**:
    *   **Name**: This is how you will appear to others. (Required)
    *   **Email**: Optional, but useful for contact info in shared documents.
    *   **Avatar**: Upload a picture to personalize your profile. If you don't, Korppi will generate initials for you.
    *   **Color**: Pick a color that represents you. This color will be used in the timeline and diff views.
3.  **Save**: Click **Save Profile** to apply your changes.

> [!NOTE]
> Your profile data is stored locally on your machine. When you share a `.kmd` file, only the necessary attribution data (name, ID, color) embedded in the patches and comments is shared.

---

## First-Time Setup

If you are launching Korppi for the first time, you might be prompted to set up your profile immediately. We recommend doing this right away so your initial edits are properly attributed.

If you skip this step, Korppi will assign a default "Local User" identity, but we strongly suggest personalizing it to get the most out of the collaboration features.

---

## Profile ID

Under the hood, Korppi generates a unique **Profile ID** (UUID) for you. This ID is what truly identifies you, allowing you to change your display name later without breaking the history of your past contributions. You can see this ID in the profile settings modal, though you rarely need to use it directly.

---

## Backup and Restore
 
Your profile configuration, including your unique ID, is stored in a simple text file named `profile.toml`.
 
If you move to a new computer and want to keep your identity (so your past contributions are still recognized as yours), you should back up this file.
 
### Using the Interface (Recommended)
 
1.  Open **Profile Settings** (click your avatar).
2.  Click **Backup Profile** to save your configuration to a `.toml` file.
3.  On your new machine, open Profile Settings and click **Restore Profile** to load your backup file.
 
> [!WARNING]
> Restoring a profile will overwrite your current profile settings.
 
### Manual Method (Advanced)
 
You can also manually copy the configuration file.
 
| Operating System | Path |
| :--- | :--- |
| **Linux** | `~/.config/korppi/profile.toml` |
| **macOS** | `~/Library/Application Support/korppi/profile.toml` |
| **Windows** | `%APPDATA%\korppi\profile.toml` <br> *(typically `C:\Users\<YourUser>\AppData\Roaming\korppi\profile.toml`)* |
