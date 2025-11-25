const { invoke } = window.__TAURI__.tauri;

// Utility: Show result message
function showResult(elementId, success, message, details = null) {
    const element = document.getElementById(elementId);
    element.className = `result ${success ? 'success' : 'error'}`;
    element.innerHTML = `
        <strong>${success ? '✅ Success' : '❌ Failed'}</strong>
        <p>${message}</p>
        ${details ? `<pre style="margin-top: 8px; font-size: 0.9em; white-space: pre-wrap;">${details}</pre>` : ''}
    `;
}

// Clear a result display
function clearResult(elementId) {
    const element = document.getElementById(elementId);
    element.style.display = 'none';
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

// DAY 2: Record a change (PLACEHOLDER - will return mock data)
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

// DAY 2: Show patch history (PLACEHOLDER - will return empty list)
document.getElementById('show-history').addEventListener('click', async () => {
    try {
        const history = await invoke('get_history');
        const historyElement = document.getElementById('history');

        if (history.length === 0) {
            historyElement.textContent = '📝 No patches yet.\n\nDay 2 implementation needed to record actual changes.';
        } else {
            historyElement.textContent = JSON.stringify(history, null, 2);
        }

        historyElement.classList.add('show');
    } catch (error) {
        showResult('record-result', false, 'Error fetching history', error);
    }
});

// DAY 3: Test conflict detection (PLACEHOLDER)
document.getElementById('test-conflict').addEventListener('click', async () => {
    try {
        const conflicts = await invoke('test_conflict_detection');

        const message = conflicts.has_conflict
            ? `Conflict detected! Found ${conflicts.locations.length} conflict location(s)`
            : '⚠️ No conflicts detected (Day 3 not implemented yet)';

        showResult(
            'conflict-result',
            conflicts.has_conflict,
            message,
            JSON.stringify(conflicts, null, 2)
        );
    } catch (error) {
        showResult('conflict-result', false, 'Error testing conflicts', error);
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
