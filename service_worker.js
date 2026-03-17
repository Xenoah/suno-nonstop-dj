/**
 * @file service_worker.js
 * @description Background service worker for Suno Nonstop DJ (Manifest V3).
 *
 * Responsibilities:
 * - Persistent state management via chrome.storage
 * - Message hub between content script and popup
 * - Log aggregation
 * - Settings management
 */

/* ========================================================================
 * SERVICE WORKER STATE
 * ======================================================================== */

/** @type {Array<Object>} aggregated log entries */
let swLogBuffer = [];

/** @constant {number} max log entries to keep in memory */
const SW_MAX_LOGS = 300;

/** @type {Object|null} latest status from content script */
let latestStatus = null;

/* ========================================================================
 * MESSAGE HANDLING
 * ======================================================================== */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        switch (message.type) {
            case 'LOG_ENTRY':
                // Store log from content script
                if (message.payload) {
                    swLogBuffer.push(message.payload);
                    if (swLogBuffer.length > SW_MAX_LOGS) {
                        swLogBuffer.shift();
                    }
                }
                // No response needed for log entries
                break;

            case 'STATUS_UPDATE':
                latestStatus = message.payload;
                // Forward to popup if open
                try {
                    chrome.runtime.sendMessage({
                        type: 'STATUS_UPDATE',
                        payload: message.payload,
                    });
                } catch (_) {
                    // Popup not open — that's fine
                }
                break;

            case 'GET_STATUS':
                // Popup requesting status — forward to content script
                forwardToContentScript(message, sender, sendResponse);
                return true; // async

            case 'START_AUTOMATION':
            case 'STOP_AUTOMATION':
            case 'UPDATE_SETTINGS':
            case 'GET_SETTINGS':
            case 'RUN_DEBUG_DUMP':
                // Forward these to the content script
                forwardToContentScript(message, sender, sendResponse);
                return true; // async

            case 'GET_LOGS':
                // Popup requesting logs
                sendResponse({
                    ok: true,
                    logs: swLogBuffer.slice(-(message.count || 50)),
                });
                break;

            case 'CLEAR_LOGS':
                swLogBuffer = [];
                sendResponse({ ok: true });
                break;

            default:
                // Ignore unknown messages from other extensions
                break;
        }
    } catch (err) {
        console.error('[SunoDJ SW] Message handler error:', err);
        try {
            sendResponse({ ok: false, error: err.message });
        } catch (_) { /* swallow */ }
    }

    return false;
});

/**
 * Forward a message to the active Suno tab's content script.
 * @param {Object} message
 * @param {Object} sender
 * @param {function} sendResponse
 */
async function forwardToContentScript(message, sender, sendResponse) {
    try {
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });

        if (tabs.length === 0) {
            sendResponse({ ok: false, error: 'No active tab found' });
            return;
        }

        const tab = tabs[0];

        // Verify it's a Suno tab
        if (!tab.url || (!tab.url.includes('suno.com'))) {
            sendResponse({ ok: false, error: 'Active tab is not suno.com' });
            return;
        }

        const response = await chrome.tabs.sendMessage(tab.id, message);
        sendResponse(response);
    } catch (err) {
        console.error('[SunoDJ SW] Forward error:', err);
        sendResponse({
            ok: false,
            error: `Cannot reach content script: ${err.message}. Is Suno open?`,
        });
    }
}

/* ========================================================================
 * INSTALLATION / UPDATE
 * ======================================================================== */

chrome.runtime.onInstalled.addListener((details) => {
    console.log('[SunoDJ SW] Installed/updated:', details.reason);

    // Set default settings on first install
    if (details.reason === 'install') {
        chrome.storage.local.set({
            sunoDjSettings: {
                thresholdSeconds: 120,
                mode: 'dry-run',
                strategy: 'balanced',
                maxConsecutiveErrors: 5,
                maxPlaybackRetries: 3,
                pollingIntervalMs: 5000,
                audioPollingIntervalMs: 1000,
                automationActive: false,
            },
        });
    }
});

console.log('[SunoDJ SW] Service worker loaded');
