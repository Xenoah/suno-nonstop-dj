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

    /** @type {string|null} audio src snapshot taken before clicking Create */
    let generationSrcSnapshot = null;

    /** @type {number|null} polling timer for generation completion */
    let generationPollTimer = null;

    /** @type {Array<{signature: string, text: string, index: number}>} snapshot before generation */
    let generationTrackSnapshot = [];

    /** @type {{signature: string, text: string, index: number}|null} preferred next track to switch to */
    let pendingSwitchTarget = null;

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
            case STATE.WAITING_NEXT_READY:
                handleWaitingNextReady();
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
     * Normalise text for fuzzy DOM comparisons.
     * @param {string} text
     * @returns {string}
     */
    function normalizeComparisonText(text) {
        return String(text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    /**
     * Check whether a node is visible enough to be interacted with.
     * @param {Element|null} el
     * @returns {boolean}
     */
    function isInteractableElement(el) {
        if (!el || !(el instanceof Element)) return false;
        const htmlEl = /** @type {HTMLElement} */ (el);
        if (htmlEl.hidden) return false;
        if (htmlEl.getAttribute('aria-hidden') === 'true') return false;
        if ('disabled' in htmlEl && htmlEl.disabled) return false;

        const rect = htmlEl.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * Build a stable-enough signature for a track card / play button pair.
     * @param {Element|null} card
     * @param {Element} playButton
     * @param {string} cardText
     * @returns {string}
     */
    function buildTrackSignature(card, playButton, cardText) {
        const parts = [];
        const normalizedText = normalizeComparisonText(cardText).slice(0, 160);
        const playAria = playButton.getAttribute('aria-label') || '';
        const playTestId = playButton.getAttribute('data-testid') || '';
        const href = playButton.getAttribute('href') || playButton.closest('a[href]')?.getAttribute('href') || '';

        if (card) {
            const cardTestId = card.getAttribute('data-testid') || '';
            const cardRole = card.getAttribute('role') || '';
            if (cardTestId) parts.push(`card:${cardTestId}`);
            if (cardRole) parts.push(`role:${cardRole}`);
        }

        if (playTestId) parts.push(`btn:${playTestId}`);
        if (playAria) parts.push(`aria:${playAria}`);
        if (href) parts.push(`href:${href}`);
        if (normalizedText) parts.push(`text:${normalizedText}`);

        return parts.join('|');
    }

    /**
     * Collect play-ready track candidates in DOM order.
     * Prefers play buttons scoped inside track cards, then falls back globally.
     * @returns {Array<{signature: string, text: string, normalizedText: string, index: number, card: Element|null, playButton: Element}>}
     */
    function collectTrackCandidates() {
        const tracks = [];
        const cardResult = findBestCandidate(CARD_CANDIDATES);

        if (cardResult) {
            const cards = Array.from(document.querySelectorAll(cardResult.candidate.selector));
            cards.forEach((card, index) => {
                const playResult = findBestCandidate(PLAY_BUTTON_CANDIDATES, card);
                if (!playResult || !isInteractableElement(playResult.element)) return;

                const cardText = (card.textContent || '').trim();
                if (!cardText) return;

                tracks.push({
                    signature: buildTrackSignature(card, playResult.element, cardText),
                    text: cardText.substring(0, 200),
                    normalizedText: normalizeComparisonText(cardText),
                    index,
                    card,
                    playButton: playResult.element,
                });
            });
        }

        if (tracks.length > 0) {
            return tracks;
        }

        const seen = new Set();
        const fallbackTracks = [];

        for (const cand of PLAY_BUTTON_CANDIDATES) {
            let elements = [];
            try {
                elements = Array.from(document.querySelectorAll(cand.selector));
            } catch (_) {
                continue;
            }

            for (const element of elements) {
                if (seen.has(element) || !isInteractableElement(element)) continue;
                seen.add(element);

                const nearestCard = element.closest('[role="listitem"], [role="row"], [data-testid*="card"], [data-testid*="track"], [data-testid*="song"]');
                const contextText = (nearestCard?.textContent || element.textContent || '').trim();
                fallbackTracks.push({
                    signature: buildTrackSignature(nearestCard, element, contextText),
                    text: contextText.substring(0, 200),
                    normalizedText: normalizeComparisonText(contextText),
                    index: fallbackTracks.length,
                    card: nearestCard,
                    playButton: element,
                });
            }
        }

        return fallbackTracks;
    }

    /**
     * Capture the visible track queue before generation starts.
     * @param {string} reason
     */
    function snapshotTrackQueue(reason) {
        const tracks = collectTrackCandidates();
        generationTrackSnapshot = tracks.map(track => ({
            signature: track.signature,
            text: track.text,
            index: track.index,
        }));
        pendingSwitchTarget = null;
        log('debug', `Captured track queue snapshot (${reason})`, {
            count: tracks.length,
            sample: tracks.slice(0, 5).map(track => ({
                index: track.index,
                text: track.text,
            })),
        });
    }

    /**
     * Find a newly appeared track by diffing against the pre-generation snapshot.
     * @param {Array<{signature: string, text: string, normalizedText: string, index: number, card: Element|null, playButton: Element}>} tracks
     * @returns {{signature: string, text: string, normalizedText: string, index: number, card: Element|null, playButton: Element}|null}
     */
    function findNewlyGeneratedTrack(tracks) {
        if (!generationTrackSnapshot.length) return null;

        const before = new Set(generationTrackSnapshot.map(track => track.signature));
        const addedTracks = tracks.filter(track => !before.has(track.signature));

        if (addedTracks.length === 0) {
            return null;
        }

        const target = addedTracks[0];
        pendingSwitchTarget = {
            signature: target.signature,
            text: target.text,
            index: target.index,
        };

        return target;
    }

    /**
     * Try to locate the currently playing track in the visible card list.
     * @param {Array<{signature: string, text: string, normalizedText: string, index: number, card: Element|null, playButton: Element}>} tracks
     * @returns {number}
     */
    function findCurrentTrackIndex(tracks) {
        const currentTitle = normalizeComparisonText(lastContext?.title || '');

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const card = track.card;
            if (!card) continue;

            if (card.matches('[aria-current="true"]') || card.querySelector('[aria-current="true"]')) {
                return i;
            }

            if (card.querySelector('button[aria-label*="Pause" i], button[aria-label*="pause" i]')) {
                return i;
            }

            if (currentTitle && track.normalizedText.includes(currentTitle)) {
                return i;
            }
        }

        return -1;
    }

    /**
     * Resolve the best switch target.
     * Preference:
     *   1. newly generated track
     *   2. previously captured pending target
     *   3. card immediately above the current one (older -> newer progression)
     * @returns {{signature: string, text: string, normalizedText: string, index: number, card: Element|null, playButton: Element}|null}
     */
    function resolveNextTrackToPlay() {
        const tracks = collectTrackCandidates();
        if (tracks.length === 0) return null;

        const newlyGenerated = findNewlyGeneratedTrack(tracks);
        if (newlyGenerated) {
            log('info', 'Queued newly generated track for next switch', {
                index: newlyGenerated.index,
                text: newlyGenerated.text,
            });
            return newlyGenerated;
        }

        if (pendingSwitchTarget) {
            const pending = tracks.find(track => track.signature === pendingSwitchTarget.signature);
            if (pending) {
                return pending;
            }
        }

        const currentIndex = findCurrentTrackIndex(tracks);
        if (currentIndex >= 0) {
            const preferred = tracks[currentIndex - 1] || tracks[currentIndex + 1] || null;
            if (preferred) {
                log('warn', 'Falling back to adjacent track selection', {
                    currentIndex,
                    targetIndex: preferred.index,
                    targetText: preferred.text,
                    assumption: 'DOM order is treated as old -> latest when moving upward',
                });
            }
            return preferred;
        }

        return tracks[0] || null;
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
        const newSrc = audioElement?.src || '';
        log('info', '▶️ Audio play event', { src: newSrc });

        // Reset trigger guard when a NEW track starts
        if (audioElement && newSrc !== lastTriggeredSrc) {
            lastTriggeredSrc = null;
        }

        if (fsm.current === STATE.WAITING_AUDIO ||
            fsm.current === STATE.IDLE) {
            fsm.transition(STATE.PLAYING_CURRENT, 'audio play event');
        }

        // *** NONSTOP LOOP: Suno auto-plays the newly created song ***
        // If we're waiting for generation or armed, and a NEW src starts playing,
        // that means the new song is ready — go straight to PLAYING_CURRENT.
        if (fsm.current === STATE.WAITING_NEXT_READY ||
            fsm.current === STATE.ARMED_FOR_SWITCH) {
            const isNewTrack = generationSrcSnapshot && newSrc && newSrc !== generationSrcSnapshot;
            if (isNewTrack) {
                log('info', '🎉 New track auto-playing! Looping back to PLAYING_CURRENT');
                stopGenerationPolling();
                pendingPrompt = null;
                lastContext = null;
                pendingSwitchTarget = null;
                generationTrackSnapshot = [];
                fsm.transition(STATE.PLAYING_CURRENT, 'new song auto-played (nonstop loop)');
            } else {
                log('debug', 'Audio play during wait, but same src — ignoring');
            }
        }

        // If we're in SWITCHING_PLAYBACK, the new track has started
        if (fsm.current === STATE.SWITCHING_PLAYBACK) {
            stopGenerationPolling();
            pendingSwitchTarget = null;
            generationTrackSnapshot = [];
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
                // Snapshot src so we can detect when user clicks Create and new song starts
                generationSrcSnapshot = audioElement ? audioElement.src : null;
                snapshotTrackQueue('manual-create armed');
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

            // Snapshot the current audio src BEFORE clicking Create
            generationSrcSnapshot = audioElement ? audioElement.src : null;
            snapshotTrackQueue('before auto-create click');
            log('info', `📸 Src snapshot: ${generationSrcSnapshot}`);

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

    /* ======================================================================
     * GENERATION COMPLETION POLLING (WAITING_NEXT_READY)
     * ==================================================================== */

    /**
     * Handle WAITING_NEXT_READY — poll for generation completion.
     * Detection methods:
     *   1. Audio src changes (Suno auto-plays the new song) — detected in onAudioPlay
     *   2. New song cards appear in the list
     *   3. Timeout fallback
     */
    function handleWaitingNextReady() {
        log('info', '⏳ Waiting for generation to complete...');
        stopGenerationPolling();

        let pollCount = 0;
        const maxPolls = 120; // 120 * 3s = 6 minutes max wait

        generationPollTimer = setInterval(() => {
            pollCount++;

            if (fsm.current !== STATE.WAITING_NEXT_READY) {
                // State changed (e.g. onAudioPlay detected auto-play)
                stopGenerationPolling();
                return;
            }

            // Method 1: Check if audio src changed (most reliable)
            if (audioElement && generationSrcSnapshot) {
                const currentSrc = audioElement.src;
                if (currentSrc && currentSrc !== generationSrcSnapshot) {
                    log('info', '🎉 Audio src changed — new song detected!');
                    stopGenerationPolling();
                    pendingPrompt = null;
                    lastContext = null;
                    pendingSwitchTarget = null;
                    generationTrackSnapshot = [];
                    // If audio is already playing, go to PLAYING_CURRENT
                    if (!audioElement.paused) {
                        fsm.transition(STATE.PLAYING_CURRENT, 'new song auto-playing (poll detected)');
                    } else {
                        // New src but not playing yet — arm for switch
                        fsm.transition(STATE.ARMED_FOR_SWITCH, 'new song ready but not playing');
                    }
                    return;
                }
            }

            // Method 2: Check if loading indicator disappeared
            // (Suno shows a spinner or progress during generation)
            try {
                const tracks = collectTrackCandidates();
                const newlyGenerated = findNewlyGeneratedTrack(tracks);
                if (newlyGenerated) {
                    log('info', '🎵 Newly generated track card detected', {
                        index: newlyGenerated.index,
                        text: newlyGenerated.text,
                    });
                    stopGenerationPolling();
                    fsm.transition(STATE.ARMED_FOR_SWITCH, 'newly generated track detected in list');
                    return;
                }

                const loadingIndicators = document.querySelectorAll(
                    '[class*="animate-spin"], [class*="loading"], [class*="generating"], [class*="progress"]'
                );
                // If we previously saw loading indicators and now they're gone,
                // generation likely completed
                if (pollCount > 3 && loadingIndicators.length === 0) {
                    // Also check if any new song cards appeared
                    // Look for cards with very recent timestamps or "just now" text
                    const allButtons = document.querySelectorAll('button[aria-label="Play"], button[aria-label="play"]');
                    if (allButtons.length > 0) {
                        log('info', '🎵 Generation appears complete (no loading + play buttons found)');
                    }
                }
            } catch (_) { /* swallow */ }

            // Timeout
            if (pollCount >= maxPolls) {
                log('warn', '⏰ Generation polling timeout — giving up');
                stopGenerationPolling();
                fsm.transition(STATE.ERROR, 'generation timeout');
                return;
            }

            // Periodic status log
            if (pollCount % 10 === 0) {
                log('info', `⏳ Still waiting for generation... (${pollCount * 3}s elapsed)`);
            }

            broadcastStatus();
        }, 3000);
    }

    /**
     * Stop generation polling timer.
     */
    function stopGenerationPolling() {
        if (generationPollTimer !== null) {
            clearInterval(generationPollTimer);
            generationPollTimer = null;
        }
    }

    /**
     * Handle ARMED_FOR_SWITCH — next track is ready, waiting for current to end.
     */
    function handleArmedForSwitch() {
        log('info', '🎯 Armed for switch — waiting for current track to end or new track to auto-play');
        playbackRetries = 0;
        // onAudioPlay will detect if new track starts playing
        // timeupdate handler will transition to SWITCHING_PLAYBACK if current track ends
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

        // Try to find and click the most appropriate next track
        try {
            const nextTrack = resolveNextTrackToPlay();
            if (nextTrack && nextTrack.playButton) {
                log('info', '🖱️ Clicking resolved next-track play button', {
                    index: nextTrack.index,
                    text: nextTrack.text,
                });
                nextTrack.playButton.click();
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
                log('error', '❌ No suitable next track found for switch', {
                    snapshotCount: generationTrackSnapshot.length,
                    pendingSwitchTarget,
                });
                fsm.transition(STATE.ERROR, 'next track not found');
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
        generationSrcSnapshot = null;
        generationTrackSnapshot = [];
        pendingSwitchTarget = null;
        stopGenerationPolling();

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
        stopGenerationPolling();

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
            collectTrackCandidates,
            get settings() { return settings; },
            get logBuffer() { return logBuffer; },
            get lastContext() { return lastContext; },
            get generationTrackSnapshot() { return generationTrackSnapshot; },
            get pendingSwitchTarget() { return pendingSwitchTarget; },
        };

        log('info', '💡 Debug: window.__sunoDJ is available in DevTools console');

        // If automation was active before page reload, we could auto-restart
        // But for safety, we default to IDLE and let user click Start
        broadcastStatus();
    }

    // Run init
    init();

})();
