/**
 * @file content.js
 * @description Content script for Suno Nonstop DJ.
 * Injected into suno.com pages. Monitors the audio element,
 * extracts DOM context, and orchestrates the automation pipeline.
 *
 * Depends on: constants.js, state-machine.js, selectors.js,
 *             dom-explorer.js, prompt-builder.js
 *             (all loaded before this file via manifest content_scripts)
 */

/* ========================================================================
 * IIFE wrapper — avoid polluting global scope
 * ======================================================================== */
(function () {
    'use strict';

    /* ======================================================================
     * INTERNAL STATE
     * ==================================================================== */

    /** @type {StateMachine} */
    const fsm = new StateMachine(onStateTransition);

    /** @type {HTMLAudioElement|null} */
    let audioElement = null;

    /** @type {number|null} polling timer for finding audio element */
    let audioPollingTimer = null;

    /** @type {number|null} debounce timer for timeupdate */
    let timeupdateDebounceTimer = null;

    /** @type {string|null} src of the track that already triggered threshold */
    let lastTriggeredSrc = null;

    /** @type {number} consecutive error counter */
    let consecutiveErrors = 0;

    /** @type {Object} current settings (merged with defaults) */
    let settings = { ...DEFAULT_SETTINGS };

    /** @type {Array<Object>} log buffer */
    let logBuffer = [];

    /** @type {MutationObserver|null} */
    let mutationObserver = null;

    /** @type {Object|null} last extracted context */
    let lastContext = null;

    /** @type {Object|null} built prompt ready to use */
    let pendingPrompt = null;

    /** @type {number} retry counter for playback switch */
    let playbackRetries = 0;

    /* ======================================================================
     * LOGGING
     * ==================================================================== */

    /**
     * Add a log entry and send to service worker.
     * @param {string} level - 'info' | 'warn' | 'error' | 'debug'
     * @param {string} message
     * @param {*} [data]
     */
    function log(level, message, data = null) {
        const entry = {
            ts: Date.now(),
            level,
            message,
            data,
            state: fsm.current,
        };

        logBuffer.push(entry);
        if (logBuffer.length > MAX_LOG_ENTRIES) {
            logBuffer.shift();
        }

        const prefix = `${LOG_PREFIX} [${level.toUpperCase()}]`;
        if (level === 'error') {
            console.error(prefix, message, data || '');
        } else if (level === 'warn') {
            console.warn(prefix, message, data || '');
        } else {
            console.log(prefix, message, data || '');
        }

        // Relay to service worker
        try {
            chrome.runtime.sendMessage({
                type: MSG.LOG_ENTRY,
                payload: entry,
            });
        } catch (_) {
            // Extension context may be invalidated — swallow
        }
    }

    /* ======================================================================
     * STATE TRANSITION CALLBACK
     * ==================================================================== */

    /**
     * Called on every valid state transition.
     * Sends status update to service worker / popup.
     * @param {string} newState
     */
    function onStateTransition(newState) {
        broadcastStatus();

        // Auto-progress based on state
        switch (newState) {
            case STATE.WAITING_AUDIO:
                startAudioPolling();
                break;
            case STATE.THRESHOLD_REACHED:
                handleThresholdReached();
                break;
            case STATE.EXTRACTING_CONTEXT:
                handleExtractContext();
                break;
            case STATE.COMPOSING_NEXT_PROMPT:
                handleComposePrompt();
                break;
            case STATE.TRIGGERING_GENERATION:
                handleTriggerGeneration();
                break;
            case STATE.ARMED_FOR_SWITCH:
                handleArmedForSwitch();
                break;
            case STATE.SWITCHING_PLAYBACK:
                handleSwitchPlayback();
                break;
            case STATE.ERROR:
                handleError();
                break;
            case STATE.STOPPED:
                cleanup();
                break;
            case STATE.IDLE:
                cleanup();
                break;
        }
    }

    /* ======================================================================
     * STATUS BROADCAST
     * ==================================================================== */

    /**
     * Send current status to service worker (relayed to popup).
     */
    function broadcastStatus() {
        const audioInfo = getAudioInfo();
        const status = {
            state: fsm.current,
            audio: audioInfo,
            lastContext: lastContext ? {
                title: lastContext.title,
                confidence: lastContext.confidence,
                tagCount: lastContext.tags ? lastContext.tags.length : 0,
            } : null,
            pendingPrompt: pendingPrompt ? {
                prompt: pendingPrompt.prompt,
                strategy: pendingPrompt.meta ? pendingPrompt.meta.strategy : null,
            } : null,
            consecutiveErrors,
            settings: {
                mode: settings.mode,
                strategy: settings.strategy,
                thresholdSeconds: settings.thresholdSeconds,
            },
            logCount: logBuffer.length,
        };

        try {
            chrome.runtime.sendMessage({
                type: MSG.STATUS_UPDATE,
                payload: status,
            });
        } catch (_) {
            // Extension context invalidated
        }
    }

    /* ======================================================================
     * AUDIO ELEMENT MANAGEMENT
     * ==================================================================== */

    /**
     * Get info from the current audio element.
     * @returns {Object|null}
     */
    function getAudioInfo() {
        if (!audioElement) return null;

        const duration = audioElement.duration;
        const currentTime = audioElement.currentTime;
        const remaining = (isNaN(duration) || duration === 0)
            ? null
            : Math.max(0, duration - currentTime);

        return {
            src: audioElement.src || null,
            currentTime,
            duration: isNaN(duration) ? null : duration,
            remaining,
            paused: audioElement.paused,
            ended: audioElement.ended,
        };
    }

    /**
     * Start polling for the audio element.
     */
    function startAudioPolling() {
        stopAudioPolling();
        log('info', 'Searching for audio element...');

        // Try immediately
        if (tryFindAudio()) return;

        // Poll periodically
        audioPollingTimer = setInterval(() => {
            if (tryFindAudio()) {
                stopAudioPolling();
            }
        }, settings.audioPollingIntervalMs);
    }

    /**
     * Stop audio polling timer.
     */
    function stopAudioPolling() {
        if (audioPollingTimer !== null) {
            clearInterval(audioPollingTimer);
            audioPollingTimer = null;
        }
    }

    /**
     * Attempt to find and attach to #active-audio-play.
     * @returns {boolean} true if found
     */
    function tryFindAudio() {
        const el = document.getElementById(AUDIO_ELEMENT_ID);

        if (!el) {
            log('debug', `#${AUDIO_ELEMENT_ID} not found yet`);
            return false;
        }

        if (el.id === SILENT_AUDIO_ID) {
            log('warn', 'Found silent-audio instead — ignoring');
            return false;
        }

        attachAudioListeners(el);
        audioElement = el;
        log('info', `✅ Audio element found: #${AUDIO_ELEMENT_ID}`);

        // If already playing, transition immediately
        if (!el.paused && el.currentTime > 0) {
            fsm.transition(STATE.PLAYING_CURRENT, 'audio already playing on attach');
        }

        return true;
    }

    /**
     * Attach event listeners to the audio element.
     * @param {HTMLAudioElement} el
     */
    function attachAudioListeners(el) {
        // Remove any existing listeners (idempotent attach)
        detachAudioListeners(el);

        el.addEventListener('play', onAudioPlay);
        el.addEventListener('pause', onAudioPause);
        el.addEventListener('ended', onAudioEnded);
        el.addEventListener('timeupdate', onAudioTimeUpdate);
        el.addEventListener('loadedmetadata', onAudioMetadata);
        el.addEventListener('error', onAudioError);
        el.addEventListener('emptied', onAudioEmptied);

        log('debug', 'Audio event listeners attached');
    }

    /**
     * Detach event listeners from an audio element.
     * @param {HTMLAudioElement} el
     */
    function detachAudioListeners(el) {
        if (!el) return;
        el.removeEventListener('play', onAudioPlay);
        el.removeEventListener('pause', onAudioPause);
        el.removeEventListener('ended', onAudioEnded);
        el.removeEventListener('timeupdate', onAudioTimeUpdate);
        el.removeEventListener('loadedmetadata', onAudioMetadata);
        el.removeEventListener('error', onAudioError);
        el.removeEventListener('emptied', onAudioEmptied);
    }

    /* ======================================================================
     * AUDIO EVENT HANDLERS
     * ==================================================================== */

    /** @param {Event} _e */
    function onAudioPlay(_e) {
        log('info', '▶️ Audio play event', { src: audioElement?.src });

        // Reset trigger guard when a NEW track starts
        if (audioElement && audioElement.src !== lastTriggeredSrc) {
            lastTriggeredSrc = null;
        }

        if (fsm.current === STATE.WAITING_AUDIO ||
            fsm.current === STATE.IDLE) {
            fsm.transition(STATE.PLAYING_CURRENT, 'audio play event');
        }

        // If we're in ARMED_FOR_SWITCH state after a track switch, this means
        // the new track has started playing
        if (fsm.current === STATE.SWITCHING_PLAYBACK) {
            fsm.transition(STATE.PLAYING_CURRENT, 'new track started after switch');
        }

        consecutiveErrors = 0;
        broadcastStatus();
    }

    /** @param {Event} _e */
    function onAudioPause(_e) {
        log('info', '⏸️ Audio pause event');
        broadcastStatus();
    }

    /** @param {Event} _e */
    function onAudioEnded(_e) {
        log('info', '⏹️ Audio ended event');

        if (fsm.current === STATE.ARMED_FOR_SWITCH) {
            fsm.transition(STATE.SWITCHING_PLAYBACK, 'current track ended, switching');
        }

        broadcastStatus();
    }

    /** @param {Event} _e */
    function onAudioTimeUpdate(_e) {
        // Debounce to avoid excessive processing
        if (timeupdateDebounceTimer !== null) return;

        timeupdateDebounceTimer = setTimeout(() => {
            timeupdateDebounceTimer = null;
            processTimeUpdate();
        }, TIMEUPDATE_DEBOUNCE_MS);
    }

    /** @param {Event} _e */
    function onAudioMetadata(_e) {
        if (!audioElement) return;
        const d = audioElement.duration;
        log('info', `📊 Metadata loaded — duration: ${isNaN(d) ? 'NaN' : d.toFixed(1)}s`);
        broadcastStatus();
    }

    /** @param {Event} e */
    function onAudioError(e) {
        log('error', '❌ Audio error', {
            error: audioElement?.error?.message || 'unknown',
            code: audioElement?.error?.code,
        });
        consecutiveErrors++;
        broadcastStatus();
    }

    /** @param {Event} _e */
    function onAudioEmptied(_e) {
        log('info', '🔄 Audio emptied (src changed or cleared)');
        // A new track may be loading
        if (fsm.current === STATE.SWITCHING_PLAYBACK) {
            log('info', 'Audio emptied during switch — waiting for new src');
        }
        broadcastStatus();
    }

    /* ======================================================================
     * TIME UPDATE PROCESSING — the core monitoring loop
     * ==================================================================== */

    /**
     * Process a debounced timeupdate event.
     * Checks remaining time and triggers next-track generation if threshold met.
     */
    function processTimeUpdate() {
        if (!audioElement) return;
        if (fsm.current !== STATE.PLAYING_CURRENT &&
            fsm.current !== STATE.THRESHOLD_REACHED &&
            fsm.current !== STATE.ARMED_FOR_SWITCH) {
            return;
        }

        const duration = audioElement.duration;
        const currentTime = audioElement.currentTime;

        // Skip if duration unknown
        if (isNaN(duration) || duration === 0) return;

        const remaining = Math.max(0, duration - currentTime);

        // --- THRESHOLD CHECK ---
        if (fsm.current === STATE.PLAYING_CURRENT &&
            remaining <= settings.thresholdSeconds &&
            remaining > 0) {

            // Guard: don't fire twice for the same track
            const currentSrc = audioElement.src;
            if (currentSrc && currentSrc === lastTriggeredSrc) {
                return; // already triggered for this track
            }

            lastTriggeredSrc = currentSrc;
            log('info', `⚡ Threshold reached! remaining=${remaining.toFixed(1)}s ` +
                `(threshold=${settings.thresholdSeconds}s)`);
            fsm.transition(STATE.THRESHOLD_REACHED, `remaining ${remaining.toFixed(1)}s`);
        }

        // --- ARMED: check if track ended or near-zero remaining ---
        if (fsm.current === STATE.ARMED_FOR_SWITCH && remaining <= 2) {
            log('info', '🔀 Track nearly ended while armed — initiating switch');
            fsm.transition(STATE.SWITCHING_PLAYBACK, 'track about to end');
        }

        // Periodic status broadcast (every debounce interval)
        broadcastStatus();
    }

    /* ======================================================================
     * PHASE 2+ HANDLERS — Context extraction & prompt composition
     * ==================================================================== */

    /**
     * Handle THRESHOLD_REACHED — begin context extraction.
     */
    function handleThresholdReached() {
        // Safety check first
        const safety = checkSafetyConditions();
        if (!safety.safe) {
            log('warn', '🛑 Safety check failed at threshold', safety.reasons);
            fsm.transition(STATE.STOPPED, `safety: ${safety.reasons.join(', ')}`);
            return;
        }

        if (settings.mode === MODE.DRY_RUN) {
            log('info', '🔍 [DRY-RUN] Threshold reached. Would begin context extraction.');
            const ctx = extractTrackContext();
            lastContext = ctx;
            log('info', '🔍 [DRY-RUN] Extracted context:', ctx);
            const plan = buildNextPromptPlan(ctx, settings.strategy);
            log('info', '🔍 [DRY-RUN] Prompt plan:', plan);
            // Stay at THRESHOLD_REACHED in dry-run — don't auto-progress
            broadcastStatus();
            return;
        }

        fsm.transition(STATE.EXTRACTING_CONTEXT, 'beginning context extraction');
    }

    /**
     * Handle EXTRACTING_CONTEXT — pull info from live DOM.
     */
    function handleExtractContext() {
        try {
            lastContext = extractTrackContext();
            log('info', '📋 Context extracted', {
                title: lastContext.title,
                confidence: lastContext.confidence,
                tags: lastContext.tags,
            });

            if (lastContext.confidence === 'low') {
                log('warn', '⚠️ Low confidence context — results may be poor');
            }

            fsm.transition(STATE.COMPOSING_NEXT_PROMPT, 'context extracted');
        } catch (err) {
            log('error', 'Context extraction failed', err.message);
            consecutiveErrors++;
            if (consecutiveErrors >= settings.maxConsecutiveErrors) {
                fsm.transition(STATE.STOPPED, 'max consecutive errors reached');
            } else {
                fsm.transition(STATE.ERROR, `extraction error: ${err.message}`);
            }
        }
    }

    /**
     * Handle COMPOSING_NEXT_PROMPT — build the next prompt.
     */
    function handleComposePrompt() {
        try {
            const result = buildNextPrompt(lastContext || {}, settings.strategy);
            pendingPrompt = result;
            log('info', '📝 Prompt composed', {
                prompt: result.prompt,
                styles: result.styles,
                title: result.title,
                strategy: result.meta.strategy,
                inherited: result.meta.inherited,
                evolved: result.meta.evolved,
            });

            if (settings.mode === MODE.MANUAL_CREATE) {
                log('info', '🖐️ [MANUAL-CREATE] Prompt ready. Attempting to fill input fields...');
                attemptFillPrompt(result.prompt, result.styles, result.title);
                // In manual-create, we go to ARMED_FOR_SWITCH, user clicks Create
                fsm.transition(STATE.ARMED_FOR_SWITCH, 'manual-create: prompt filled, waiting user');
            } else if (settings.mode === MODE.AUTO_CREATE) {
                fsm.transition(STATE.TRIGGERING_GENERATION, 'auto-create: triggering');
            }
        } catch (err) {
            log('error', 'Prompt composition failed', err.message);
            consecutiveErrors++;
            fsm.transition(STATE.ERROR, `compose error: ${err.message}`);
        }
    }

    /**
     * Handle TRIGGERING_GENERATION — click Create button (auto-create only).
     */
    function handleTriggerGeneration() {
        if (settings.mode !== MODE.AUTO_CREATE) {
            log('warn', 'TRIGGERING_GENERATION entered in non-auto mode — skipping');
            fsm.transition(STATE.ARMED_FOR_SWITCH, 'non-auto mode');
            return;
        }

        try {
            // Fill prompt first
            if (pendingPrompt) {
                attemptFillPrompt(pendingPrompt.prompt, pendingPrompt.styles, pendingPrompt.title);
            }

            // Find and click Create button
            const createResult = findBestCandidate(CREATE_BUTTON_CANDIDATES);
            if (!createResult) {
                log('error', '❌ Create button not found — cannot auto-create');
                fsm.transition(STATE.ERROR, 'Create button not found');
                return;
            }

            log('info', `🖱️ Clicking Create button: "${createResult.element.textContent.trim()}"`);
            createResult.element.click();
            log('info', '✅ Create button clicked — waiting for generation');
            fsm.transition(STATE.WAITING_NEXT_READY, 'generation triggered');
        } catch (err) {
            log('error', 'Trigger generation failed', err.message);
            consecutiveErrors++;
            fsm.transition(STATE.ERROR, `trigger error: ${err.message}`);
        }
    }

    /**
     * Handle ARMED_FOR_SWITCH — next track is ready, waiting for current to end.
     */
    function handleArmedForSwitch() {
        log('info', '🎯 Armed for switch — waiting for current track to end');
        playbackRetries = 0;
        // The timeupdate handler will transition to SWITCHING_PLAYBACK
    }

    /**
     * Handle SWITCHING_PLAYBACK — switch to the next track.
     */
    function handleSwitchPlayback() {
        log('info', '🔀 Attempting playback switch...');

        if (settings.mode === MODE.DRY_RUN) {
            log('info', '🔍 [DRY-RUN] Would switch playback now');
            fsm.transition(STATE.PLAYING_CURRENT, 'dry-run switch complete');
            return;
        }

        // Try to find and click the play button of the newest track
        try {
            const playResult = findBestCandidate(PLAY_BUTTON_CANDIDATES);
            if (playResult) {
                log('info', `🖱️ Clicking play button`);
                playResult.element.click();
                // Wait for audio src to change → onAudioPlay will transition
                setTimeout(() => {
                    if (fsm.current === STATE.SWITCHING_PLAYBACK) {
                        playbackRetries++;
                        if (playbackRetries >= settings.maxPlaybackRetries) {
                            log('error', 'Playback switch failed after max retries');
                            fsm.transition(STATE.ERROR, 'playback switch max retries');
                        } else {
                            log('warn', `Playback switch retry ${playbackRetries}/${settings.maxPlaybackRetries}`);
                            handleSwitchPlayback(); // retry
                        }
                    }
                }, 3000);
            } else {
                log('error', '❌ Play button not found for switch');
                fsm.transition(STATE.ERROR, 'play button not found');
            }
        } catch (err) {
            log('error', 'Playback switch failed', err.message);
            fsm.transition(STATE.ERROR, `switch error: ${err.message}`);
        }
    }

    /**
     * Handle ERROR state.
     */
    function handleError() {
        log('warn', `⚠️ Error state entered (consecutive: ${consecutiveErrors})`);

        if (consecutiveErrors >= settings.maxConsecutiveErrors) {
            log('error', '🛑 Max consecutive errors — stopping automation');
            fsm.transition(STATE.STOPPED, 'max errors');
        } else {
            // Auto-recover: go back to WAITING_AUDIO after a delay
            setTimeout(() => {
                if (fsm.current === STATE.ERROR) {
                    log('info', '🔄 Auto-recovering from error → WAITING_AUDIO');
                    fsm.transition(STATE.WAITING_AUDIO, 'auto-recovery');
                }
            }, 5000);
        }
    }

    /* ======================================================================
     * PROMPT FILL HELPER (Phase 3+)
     * ==================================================================== */

    /**
     * Attempt to fill the prompt/lyrics/styles fields on the create page.
     * Uses VERIFIED selectors from live DOM inspection.
     * @param {string} promptText - the main prompt/lyrics text
     * @param {string} [stylesText] - optional styles text
     * @param {string} [titleText] - optional song title
     */
    function attemptFillPrompt(promptText, stylesText, titleText) {
        if (settings.mode === MODE.DRY_RUN) {
            log('info', `🔍 [DRY-RUN] Would fill lyrics: "${promptText}"`);
            if (stylesText) log('info', `🔍 [DRY-RUN] Would fill styles: "${stylesText}"`);
            if (titleText) log('info', `🔍 [DRY-RUN] Would fill title: "${titleText}"`);
            return;
        }

        // --- Fill lyrics textarea (data-testid="lyrics-textarea") ---
        if (promptText) {
            const lyricsResult = findBestCandidate(LYRICS_INPUT_CANDIDATES);
            if (lyricsResult) {
                fillInputElement(lyricsResult.element, promptText, 'lyrics');
            } else {
                log('warn', '⚠️ Lyrics textarea not found — cannot fill');
            }
        }

        // --- Fill styles textarea (maxlength="1000") ---
        if (stylesText) {
            const stylesResult = findBestCandidate(STYLES_INPUT_CANDIDATES);
            if (stylesResult) {
                fillInputElement(stylesResult.element, stylesText, 'styles');
            } else {
                log('warn', '⚠️ Styles textarea not found — cannot fill');
            }
        }

        // --- Fill song title input ---
        if (titleText) {
            const titleResult = findBestCandidate(TITLE_INPUT_CANDIDATES);
            if (titleResult) {
                fillInputElement(titleResult.element, titleText, 'title');
            } else {
                log('warn', '⚠️ Title input not found — cannot fill');
            }
        }
    }

    /**
     * Fill a single input/textarea element, dispatching events for React.
     * @param {HTMLElement} el
     * @param {string} value
     * @param {string} fieldName - for logging
     */
    function fillInputElement(el, value, fieldName) {
        try {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                // Use native setter to bypass React's controlled input
                const proto = el.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

                if (nativeSetter) {
                    nativeSetter.call(el, value);
                } else {
                    el.value = value;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.contentEditable === 'true') {
                el.textContent = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }

            log('info', `✅ ${fieldName} field filled`);
        } catch (err) {
            log('error', `Failed to fill ${fieldName}`, err.message);
        }
    }

    /* ======================================================================
     * MUTATION OBSERVER (Phase 2+)
     * ==================================================================== */

    /**
     * Start observing DOM changes to detect track changes, new cards, etc.
     */
    function startMutationObserver() {
        stopMutationObserver();

        const target = document.querySelector('main') || document.body;
        if (!target) {
            log('warn', 'No mutation target found');
            return;
        }

        mutationObserver = new MutationObserver((mutations) => {
            // Check if audio element was removed/replaced
            if (audioElement && !document.contains(audioElement)) {
                log('warn', '🔄 Audio element removed from DOM — re-searching');
                audioElement = null;
                if (fsm.current === STATE.PLAYING_CURRENT) {
                    fsm.transition(STATE.WAITING_AUDIO, 'audio element lost');
                }
            }
        });

        mutationObserver.observe(target, {
            childList: true,
            subtree: true,
        });

        log('debug', 'MutationObserver started');
    }

    /**
     * Stop the mutation observer.
     */
    function stopMutationObserver() {
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
    }

    /* ======================================================================
     * START / STOP / CLEANUP
     * ==================================================================== */

    /**
     * Start the automation.
     */
    function startAutomation() {
        if (fsm.current !== STATE.IDLE && fsm.current !== STATE.STOPPED) {
            log('warn', `Cannot start from state ${fsm.current}`);
            return;
        }

        if (fsm.current === STATE.STOPPED) {
            fsm.forceReset('restarting');
        }

        log('info', '🚀 Starting Suno Nonstop DJ automation');
        consecutiveErrors = 0;
        lastTriggeredSrc = null;
        pendingPrompt = null;
        lastContext = null;
        playbackRetries = 0;

        startMutationObserver();
        fsm.transition(STATE.WAITING_AUDIO, 'user started automation');
    }

    /**
     * Stop the automation.
     */
    function stopAutomation() {
        log('info', '🛑 Stopping automation');

        if (fsm.current === STATE.IDLE) {
            return; // already idle
        }

        if (fsm.canTransition(STATE.STOPPED)) {
            fsm.transition(STATE.STOPPED, 'user stopped automation');
        } else {
            fsm.forceReset('user force-stop');
        }
    }

    /**
     * Clean up all timers and listeners.
     */
    function cleanup() {
        stopAudioPolling();
        stopMutationObserver();

        if (timeupdateDebounceTimer !== null) {
            clearTimeout(timeupdateDebounceTimer);
            timeupdateDebounceTimer = null;
        }

        if (audioElement) {
            detachAudioListeners(audioElement);
            // Don't null out audioElement here — we may want to read it still
        }

        log('debug', 'Cleanup complete');
    }

    /* ======================================================================
     * MESSAGE HANDLING — from popup / service worker
     * ==================================================================== */

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            switch (message.type) {
                case MSG.START_AUTOMATION:
                    loadSettings().then(() => {
                        startAutomation();
                        sendResponse({ ok: true, state: fsm.current });
                    });
                    return true; // async response

                case MSG.STOP_AUTOMATION:
                    stopAutomation();
                    sendResponse({ ok: true, state: fsm.current });
                    break;

                case MSG.GET_STATUS:
                    sendResponse({
                        ok: true,
                        state: fsm.current,
                        audio: getAudioInfo(),
                        lastContext: lastContext ? {
                            title: lastContext.title,
                            confidence: lastContext.confidence,
                        } : null,
                        pendingPrompt: pendingPrompt ? {
                            prompt: pendingPrompt.prompt,
                        } : null,
                        consecutiveErrors,
                        logBuffer: logBuffer.slice(-50),
                    });
                    break;

                case MSG.UPDATE_SETTINGS:
                    Object.assign(settings, message.payload || {});
                    saveSettings();
                    log('info', '⚙️ Settings updated', settings);
                    sendResponse({ ok: true });
                    break;

                case MSG.GET_SETTINGS:
                    sendResponse({ ok: true, settings });
                    break;

                case MSG.RUN_DEBUG_DUMP:
                    const dump = debugDump();
                    dump.fsmState = fsm.current;
                    dump.fsmHistory = fsm.history.slice(-20);
                    sendResponse({ ok: true, dump });
                    break;

                default:
                    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
            }
        } catch (err) {
            console.error(`${LOG_PREFIX} Message handler error:`, err);
            sendResponse({ ok: false, error: err.message });
        }

        return false; // synchronous unless explicitly async
    });

    /* ======================================================================
     * SETTINGS PERSISTENCE
     * ==================================================================== */

    /**
     * Load settings from chrome.storage.local.
     * @returns {Promise<void>}
     */
    async function loadSettings() {
        try {
            const stored = await chrome.storage.local.get('sunoDjSettings');
            if (stored.sunoDjSettings) {
                settings = { ...DEFAULT_SETTINGS, ...stored.sunoDjSettings };
            }
            log('debug', 'Settings loaded', settings);
        } catch (err) {
            log('warn', 'Failed to load settings, using defaults', err.message);
        }
    }

    /**
     * Save settings to chrome.storage.local.
     */
    function saveSettings() {
        try {
            chrome.storage.local.set({ sunoDjSettings: settings });
        } catch (err) {
            log('warn', 'Failed to save settings', err.message);
        }
    }

    /* ======================================================================
     * INITIALISATION
     * ==================================================================== */

    /**
     * Initialise the content script.
     */
    async function init() {
        log('info', '🎵 Suno Nonstop DJ content script loaded');
        log('info', `📍 URL: ${location.href}`);

        await loadSettings();

        // Expose debug helpers to window for DevTools access
        window.__sunoDJ = {
            fsm,
            getAudioInfo,
            debugDump,
            extractTrackContext,
            checkSafetyConditions,
            buildNextPrompt,
            buildNextPromptPlan,
            startAutomation,
            stopAutomation,
            get settings() { return settings; },
            get logBuffer() { return logBuffer; },
            get lastContext() { return lastContext; },
        };

        log('info', '💡 Debug: window.__sunoDJ is available in DevTools console');

        // If automation was active before page reload, we could auto-restart
        // But for safety, we default to IDLE and let user click Start
        broadcastStatus();
    }

    // Run init
    init();

})();
