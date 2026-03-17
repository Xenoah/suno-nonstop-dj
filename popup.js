/**
 * @file popup.js
 * @description Popup UI logic for Suno Nonstop DJ.
 * Communicates with content script via chrome.runtime messaging.
 */

(function () {
    'use strict';

    /* ======================================================================
     * DOM REFERENCES
     * ==================================================================== */

    const els = {
        stateBadge: document.getElementById('state-badge'),
        currentTrack: document.getElementById('current-track'),
        remainingTime: document.getElementById('remaining-time'),
        nextGenStatus: document.getElementById('next-gen-status'),
        errorCount: document.getElementById('error-count'),
        progressContainer: document.getElementById('progress-container'),
        progressBar: document.getElementById('progress-bar'),
        btnStart: document.getElementById('btn-start'),
        btnStop: document.getElementById('btn-stop'),
        threshold: document.getElementById('threshold'),
        modeSelect: document.getElementById('mode-select'),
        strategySelect: document.getElementById('strategy-select'),
        promptPanel: document.getElementById('prompt-panel'),
        promptPreview: document.getElementById('prompt-preview'),
        logContainer: document.getElementById('log-container'),
        btnClearLog: document.getElementById('btn-clear-log'),
        debugToggle: document.getElementById('debug-toggle'),
        debugBody: document.getElementById('debug-body'),
        btnDebugDump: document.getElementById('btn-debug-dump'),
        debugOutput: document.getElementById('debug-output'),
    };

    /* ======================================================================
     * STATE
     * ==================================================================== */

    let currentState = 'IDLE';
    let pollTimer = null;

    /* ======================================================================
     * MESSAGE HELPERS
     * ==================================================================== */

    /**
     * Send a message to the service worker / content script.
     * @param {Object} msg
     * @returns {Promise<Object>}
     */
    function sendMsg(msg) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(msg, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({
                        ok: false,
                        error: chrome.runtime.lastError.message,
                    });
                } else {
                    resolve(response || { ok: false, error: 'No response' });
                }
            });
        });
    }

    /* ======================================================================
     * UI UPDATE
     * ==================================================================== */

    /**
     * @param {Object} status - status payload from content script
     */
    function updateUI(status) {
        if (!status) return;

        // State badge
        currentState = status.state || 'IDLE';
        els.stateBadge.textContent = currentState;
        els.stateBadge.className = 'state-badge state-' + currentState.toLowerCase().replace(/_/g, '-');

        // Buttons
        const isActive = currentState !== 'IDLE' && currentState !== 'STOPPED';
        els.btnStart.disabled = isActive;
        els.btnStop.disabled = !isActive;

        // Audio info
        if (status.audio) {
            const a = status.audio;

            // Remaining time
            if (a.remaining !== null && a.remaining !== undefined) {
                const mins = Math.floor(a.remaining / 60);
                const secs = Math.floor(a.remaining % 60);
                els.remainingTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

                // Progress bar
                if (a.duration && a.duration > 0) {
                    const pct = ((a.duration - a.remaining) / a.duration) * 100;
                    els.progressContainer.style.display = 'block';
                    els.progressBar.style.width = pct + '%';

                    // Color based on threshold
                    const settings = status.settings || {};
                    const threshold = settings.thresholdSeconds || 120;
                    if (a.remaining <= threshold) {
                        els.progressBar.classList.add('threshold');
                    } else {
                        els.progressBar.classList.remove('threshold');
                    }
                }
            } else {
                els.remainingTime.textContent = a.paused ? '⏸ Paused' : '—';
                els.progressContainer.style.display = 'none';
            }
        } else {
            els.remainingTime.textContent = '—';
            els.progressContainer.style.display = 'none';
        }

        // Track title
        if (status.lastContext && status.lastContext.title) {
            els.currentTrack.textContent = status.lastContext.title;
        } else {
            els.currentTrack.textContent = currentState === 'PLAYING_CURRENT' ? '(playing)' : '—';
        }

        // Next generation status
        if (status.pendingPrompt) {
            els.nextGenStatus.textContent = '✅ Prompt ready';
            els.promptPanel.style.display = 'block';
            els.promptPreview.textContent = status.pendingPrompt.prompt || '—';
        } else if (currentState === 'THRESHOLD_REACHED') {
            els.nextGenStatus.textContent = '⚡ Threshold reached';
        } else if (currentState === 'EXTRACTING_CONTEXT') {
            els.nextGenStatus.textContent = '🔍 Extracting...';
        } else if (currentState === 'WAITING_NEXT_READY') {
            els.nextGenStatus.textContent = '⏳ Generating...';
        } else if (currentState === 'ARMED_FOR_SWITCH') {
            els.nextGenStatus.textContent = '🎯 Armed';
        } else {
            els.nextGenStatus.textContent = '—';
            els.promptPanel.style.display = 'none';
        }

        // Error count
        els.errorCount.textContent = status.consecutiveErrors || 0;

        // Settings sync
        if (status.settings) {
            els.modeSelect.value = status.settings.mode || 'dry-run';
            els.strategySelect.value = status.settings.strategy || 'balanced';
            els.threshold.value = status.settings.thresholdSeconds || 120;
        }
    }

    /* ======================================================================
     * LOG DISPLAY
     * ==================================================================== */

    /**
     * @param {Array<Object>} logs
     */
    function renderLogs(logs) {
        if (!logs || logs.length === 0) {
            els.logContainer.innerHTML =
                '<div class="log-empty">No log entries yet. Start automation to begin.</div>';
            return;
        }

        const fragment = document.createDocumentFragment();

        // Show latest 50 entries
        const entries = logs.slice(-50);
        for (const entry of entries) {
            const div = document.createElement('div');
            div.className = `log-entry log-${entry.level || 'info'}`;

            const time = new Date(entry.ts).toLocaleTimeString();
            const stateTag = entry.state ? `[${entry.state}]` : '';
            div.textContent = `${time} ${stateTag} ${entry.message}`;

            if (entry.data && typeof entry.data === 'object') {
                const pre = document.createElement('pre');
                pre.className = 'log-data';
                pre.textContent = JSON.stringify(entry.data, null, 2);
                div.appendChild(pre);
            } else if (entry.data) {
                div.textContent += ` ${entry.data}`;
            }

            fragment.appendChild(div);
        }

        els.logContainer.innerHTML = '';
        els.logContainer.appendChild(fragment);
        els.logContainer.scrollTop = els.logContainer.scrollHeight;
    }

    /* ======================================================================
     * POLLING — keep popup up to date
     * ==================================================================== */

    function startPolling() {
        stopPolling();
        poll(); // immediate first poll
        pollTimer = setInterval(poll, 1000);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function poll() {
        const resp = await sendMsg({ type: 'GET_STATUS' });
        if (resp.ok) {
            updateUI(resp);
            if (resp.logBuffer) {
                renderLogs(resp.logBuffer);
            }
        } else {
            els.stateBadge.textContent = 'DISCONNECTED';
            els.stateBadge.className = 'state-badge state-error';
        }
    }

    /* ======================================================================
     * EVENT LISTENERS
     * ==================================================================== */

    // Start
    els.btnStart.addEventListener('click', async () => {
        // Save settings first
        await saveSettings();
        const resp = await sendMsg({ type: 'START_AUTOMATION' });
        if (!resp.ok) {
            alert('Failed to start: ' + (resp.error || 'unknown'));
        }
        poll();
    });

    // Stop
    els.btnStop.addEventListener('click', async () => {
        const resp = await sendMsg({ type: 'STOP_AUTOMATION' });
        if (!resp.ok) {
            alert('Failed to stop: ' + (resp.error || 'unknown'));
        }
        poll();
    });

    // Settings changes
    els.threshold.addEventListener('change', saveSettings);
    els.modeSelect.addEventListener('change', saveSettings);
    els.strategySelect.addEventListener('change', saveSettings);

    // Clear log
    els.btnClearLog.addEventListener('click', async () => {
        await sendMsg({ type: 'CLEAR_LOGS' });
        els.logContainer.innerHTML =
            '<div class="log-empty">Logs cleared.</div>';
    });

    // Debug toggle
    els.debugToggle.addEventListener('click', () => {
        const body = els.debugBody;
        const icon = els.debugToggle.querySelector('.collapse-icon');
        if (body.classList.contains('collapsed')) {
            body.classList.remove('collapsed');
            icon.textContent = '▾';
        } else {
            body.classList.add('collapsed');
            icon.textContent = '▸';
        }
    });

    // Debug dump
    els.btnDebugDump.addEventListener('click', async () => {
        els.debugOutput.textContent = 'Running...';
        const resp = await sendMsg({ type: 'RUN_DEBUG_DUMP' });
        if (resp.ok && resp.dump) {
            els.debugOutput.textContent = JSON.stringify(resp.dump, null, 2);
        } else {
            els.debugOutput.textContent = 'Error: ' + (resp.error || 'no response');
        }
    });

    // Listen for pushed status updates
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'STATUS_UPDATE' && message.payload) {
            updateUI(message.payload);
        }
    });

    /* ======================================================================
     * SETTINGS SAVE
     * ==================================================================== */

    async function saveSettings() {
        const payload = {
            thresholdSeconds: parseInt(els.threshold.value, 10) || 120,
            mode: els.modeSelect.value,
            strategy: els.strategySelect.value,
        };
        await sendMsg({ type: 'UPDATE_SETTINGS', payload });
    }

    /* ======================================================================
     * LOAD SETTINGS ON OPEN
     * ==================================================================== */

    async function loadSettings() {
        const resp = await sendMsg({ type: 'GET_SETTINGS' });
        if (resp.ok && resp.settings) {
            els.threshold.value = resp.settings.thresholdSeconds || 120;
            els.modeSelect.value = resp.settings.mode || 'dry-run';
            els.strategySelect.value = resp.settings.strategy || 'balanced';
        }
    }

    /* ======================================================================
     * INIT
     * ==================================================================== */

    loadSettings();
    startPolling();

})();
