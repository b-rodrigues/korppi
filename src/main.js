const { invoke } = window.__TAURI__.tauri;

/* ---------- Utility helpers ---------- */

function stringifyDetails(details) {
    if (!details) return null;
    if (typeof details === "string") return details;
    if (details instanceof Error) return details.stack || details.message;

    try {
        return JSON.stringify(details, null, 2);
    } catch {
        return String(details);
    }
}

function showResult(id, success, message, details = null) {
    const el = document.getElementById(id);
    if (!el) return;

    const formatted = stringifyDetails(details);

    el.style.display = "block";
    el.className = `result ${success ? "success" : "error"}`;
    el.innerHTML = `
        <strong>${success ? "Success" : "Failed"}</strong>
        <p>${message}</p>
        ${formatted ? `<pre>${formatted}</pre>` : ""}
    `;
}

function clearResult(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = "none";
    el.className = "result";
    el.innerHTML = "";
}

function disableButton(btn, label) {
    btn.disabled = true;
    if (label) btn.dataset.original = btn.textContent;
    if (label) btn.textContent = label;
}

function enableButton(btn) {
    btn.disabled = false;
    if (btn.dataset.original) {
        btn.textContent = btn.dataset.original;
        delete btn.dataset.original;
    }
}

/* ---------- Conflict formatting ---------- */

function formatConflict(loc) {
    const line = loc.line ? ` (line ${loc.line})` : "";
    return `[${loc.conflict_type}] ${loc.path}${line}: ${loc.description}`;
}

/* ---------- Event handlers ---------- */

// INIT
document.getElementById("test-init").addEventListener("click", async () => {
    const btn = document.getElementById("test-init");
    disableButton(btn, "⏳ Initializing...");
    clearResult("init-result");

    try {
        const r = await invoke("test_pijul_init");
        showResult("init-result", r.success, r.message, r.details);
    } catch (err) {
        showResult("init-result", false, "Error initializing repository", err);
    } finally {
        enableButton(btn);
    }
});

// STATUS
document.getElementById("repo-status").addEventListener("click", async () => {
    const btn = document.getElementById("repo-status");
    disableButton(btn);
    clearResult("status-result");

    try {
        const status = await invoke("get_repo_status");
        showResult("status-result", true, "Repository Status", status);
    } catch (err) {
        showResult("status-result", false, "Error fetching status", err);
    } finally {
        enableButton(btn);
    }
});

// RESET
document.getElementById("reset-repo").addEventListener("click", async () => {
    if (!confirm("This will delete the test repository. Continue?")) return;

    const btn = document.getElementById("reset-repo");
    disableButton(btn);

    try {
        const r = await invoke("reset_test_repo");
        clearResult("init-result");
        clearResult("status-result");
        clearResult("record-result");
        clearResult("conflict-result");
        document.getElementById("history").style.display = "none";
        alert("✔ " + r.message);
    } catch (err) {
        alert("Error: " + err);
    } finally {
        enableButton(btn);
    }
});

// RECORD CHANGE
document.getElementById("record-change").addEventListener("click", async () => {
    const content = document.getElementById("content").value;
    const message = document.getElementById("message").value;

    try {
        const r = await invoke("record_edit", { content, message });
        showResult("record-result", r.success, r.message, r.details);
    } catch (err) {
        showResult("record-result", false, "Error recording change", err);
    }
});

// HISTORY
document.getElementById("show-history").addEventListener("click", async () => {
    const out = document.getElementById("history");

    try {
        const history = await invoke("get_history");

        if (!history.length) {
            out.textContent = "No patches yet.";
        } else {
            out.textContent = history
                .map(p => `${p.timestamp} — ${p.description} (${p.hash.slice(0, 8)}…)`)
                .join("\n");
        }

        out.style.display = "block";
    } catch (err) {
        showResult("record-result", false, "Error fetching history", err);
    }
});

// CONFLICTS
document.getElementById("test-conflict").addEventListener("click", async () => {
    try {
        const r = await invoke("test_conflict_detection");

        const message = r.has_conflict
            ? `Detected ${r.locations.length} conflict(s).`
            : "No conflicts detected.";

        const details = r.locations
            .map(formatConflict)
            .join("\n");

        showResult("conflict-result", true, message, details);
    } catch (err) {
        showResult("conflict-result", false, "Error simulating conflict", err);
    }
});

// DEBUG
document.getElementById("show-debug").addEventListener("click", async () => {
    const out = document.getElementById("debug-output");
    out.style.display = "block";

    try {
        const status = await invoke("get_repo_status");
        out.textContent = [
            "Debug Information",
            "=================",
            "",
            `Platform: ${navigator.platform}`,
            `User Agent: ${navigator.userAgent}`,
            "",
            status
        ].join("\n");
    } catch (err) {
        out.textContent = "Error fetching debug info: " + err;
    }
});

// Startup
document.addEventListener("DOMContentLoaded", () => {
    console.log("Korppi Prototype Loaded.");
});
