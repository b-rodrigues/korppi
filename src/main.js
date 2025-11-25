const { invoke } = window.__TAURI__.tauri;

// Utility: normalize details (Error, object, string) for display
function stringifyDetails(details) {
    if (!details) return null;
    if (typeof details === "string") return details;
    if (details instanceof Error) {
        return details.stack || details.message || String(details);
    }
    try {
        return JSON.stringify(details, null, 2);
    } catch (_) {
        return String(details);
    }
}

// Utility: Show result message
function showResult(elementId, success, message, details = null) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const normalizedDetails = stringifyDetails(details);

    element.style.display = "block";
    element.className = `result ${success ? 'success' : 'error'}`;
    element.innerHTML = `
        <strong>${success ? '✅ Success' : '❌ Failed'}</strong>
        <p>${message}</p>
        ${
            normalizedDetails
                ? `<pre style="margin-top: 8px; font-size: 0.9em; white-space: pre-wrap;">${normalizedDetails}</pre>`
                : ''
        }
    `;
}


// Clear a result display
function clearResult(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Do not permanently hide; just reset content and classes.
    element.style.display = 'none';
    element.className = 'result';
    element.innerHTML = '';
}

// DAY 1: Test Pijul Initialization (PRIMARY TEST)
document.getElementById('test-init').addEventListener('click', async () => {
    const button = document.getElementById('test-init');
    button.disabled = true;
    button.textContent = '⏳ Initializing...';

    clearResult('init-result');

    try {
        const result = await invoke('test_pijul_init');
        showResult('init-result', result.success, result.message, result.details);

        if (result.success) {
            // Celebrate Day 1 completion!
            setTimeout(() => {
                const celebration = document.createElement('div');
                celebration.className = 'celebration';
                celebration.textContent = '🎉 Day 1 Complete! 🎉';
                document.querySelector('.priority').appendChild(celebration);

                setTimeout(() => celebration.remove(), 3000);
            }, 500);
        }
    } catch (error) {
        showResult('init-result', false, 'Error calling Tauri command', error);
    } finally {
        button.disabled = false;
        button.textContent = '▶️ Test Pijul Init';
    }
});

// Check repository status (for debugging)
document.getElementById('repo-status').addEventListener('click', async () => {
    const button = document.getElementById('repo-status');
    button.disabled = true;

    clearResult('status-result');

    try {
        const status = await invoke('get_repo_status');
        showResult('status-result', true, 'Repository Status', status);
    } catch (error) {
        showResult('status-result', false, 'Error checking status', error);
    } finally {
        button.disabled = false;
    }
});

// Reset test repository
document.getElementById('reset-repo').addEventListener('click', async () => {
    if (!confirm('This will delete the test repository. Continue?')) {
        return;
    }

    const button = document.getElementById('reset-repo');
    button.disabled = true;

    try {
        const result = await invoke('reset_test_repo');

        // Clear all result displays
        clearResult('init-result');
        clearResult('status-result');
        clearResult('record-result');
        clearResult('conflict-result');
        document.getElementById('history').classList.remove('show');

        alert('✅ ' + result.message);
    } catch (error) {
        alert('❌ Error resetting repository: ' + error);
    } finally {
        button.disabled = false;
    }
});

// DAY 2: Record a change
document.getElementById('record-change').addEventListener('click', async () => {
    const content = document.getElementById('content').value;
    const message = document.getElementById('message').value;

    try {
        const result = await invoke('record_edit', { content, message });
        showResult('record-result', result.success, result.message, result.details);
    } catch (error) {
        showResult('record-result', false, 'Error recording change', error);
    }
});

// DAY 2: Show patch history
document.getElementById('show-history').addEventListener('click', async () => {
    try {
        const history = await invoke('get_history');
        const historyElement = document.getElementById('history');

        if (history.length === 0) {
            historyElement.textContent = '📝 No patches yet.\n\nDay 2 implementation needed to record actual changes.';
        } else {
            // Simple, human-friendly rendering of history
            historyElement.textContent = history
                .map(
                    (p) =>
                        `${p.timestamp} – ${p.description} (${p.hash.slice(0, 8)}…)`
                )
                .join('\n');
        }

        historyElement.classList.add('show');
    } catch (error) {
        showResult('record-result', false, 'Error fetching history', error);
    }
});

// DAY 3: Test conflict detection
document.getElementById('test-conflict').addEventListener('click', async () => {
    try {
        const result = await invoke('test_conflict_detection');

        const message = result.has_conflict
            ? `Conflict detected! Found ${result.locations.length} conflict location(s).`
            : '✅ No conflicts detected.';

        // Format the structured conflict data for display.
        const details = result.locations.map(loc => {
            const lineInfo = loc.line ? ` on line ${loc.line}` : '';
            return `[${loc.conflict_type}] in "${loc.path}"${lineInfo}: ${loc.description}`;
        }).join('<br>');

        showResult(
            'conflict-result',
            true, // The operation was successful, even if conflicts were found
            message,
            details
        );
    } catch (error) {
        showResult('conflict-result', false, 'Error running conflict simulation', error);
    }
});

// Debug information
document.getElementById('show-debug').addEventListener('click', async () => {
    const debugOutput = document.getElementById('debug-output');
    debugOutput.style.display = 'block';

    try {
        const status = await invoke('get_repo_status');

        debugOutput.textContent = `
Debug Information
=================

Tauri Version: ${window.__TAURI_METADATA__?.version || 'unknown'}
Platform: ${navigator.platform}
User Agent: ${navigator.userAgent}

${status}
        `.trim();
    } catch (error) {
        debugOutput.textContent = 'Error getting debug info: ' + error;
    }
});

// Initial load message
window.addEventListener('DOMContentLoaded', () => {
    console.log('🦀 Korppi Prototype loaded');
    console.log('📋 Focus: Day 1 - Repository Initialization');
    console.log('🎯 Goal: Verify Pijul can create a repository in Tauri');
});
