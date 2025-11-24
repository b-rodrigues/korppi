const { invoke } = window.__TAURI__.tauri;

// Utility: Show result message
function showResult(elementId, success, message, details = null) {
    const element = document.getElementById(elementId);
    element.className = `result ${success ? 'success' : 'error'}`;
    element.innerHTML = `
        <strong>${success ? '✅ Success' : '❌ Failed'}</strong>
        <p>${message}</p>
        ${details ? `<pre style="margin-top: 8px; font-size: 0.9em;">${details}</pre>` : ''}
    `;
}

// DAY 1: Test Pijul Initialization
document.getElementById('test-init').addEventListener('click', async () => {
    try {
        const result = await invoke('test_pijul_init');
        showResult('init-result', result.success, result.message, result.details);
    } catch (error) {
        showResult('init-result', false, 'Error calling Tauri command', error);
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
            historyElement.textContent = 'No patches yet. Record some changes first!';
        } else {
            historyElement.textContent = JSON.stringify(history, null, 2);
        }

        historyElement.classList.add('show');
    } catch (error) {
        showResult('record-result', false, 'Error fetching history', error);
    }
});

// DAY 3: Test conflict detection (THE CRITICAL TEST)
document.getElementById('test-conflict').addEventListener('click', async () => {
    try {
        const conflicts = await invoke('test_conflict_detection');

        const message = conflicts.has_conflict
            ? `Conflict detected! Found ${conflicts.locations.length} conflict location(s)`
            : 'No conflicts detected (this might be a problem!)';

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

// Utility: Reset test repository
document.getElementById('reset-repo').addEventListener('click', async () => {
    if (!confirm('This will delete the test repository. Continue?')) {
        return;
    }

    try {
        const result = await invoke('reset_test_repo');
        alert(result.message);

        // Clear all result displays
        document.querySelectorAll('.result').forEach(el => {
            el.style.display = 'none';
        });
        document.getElementById('history').classList.remove('show');
    } catch (error) {
        alert('Error resetting repository: ' + error);
    }
});
