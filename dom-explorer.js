/**
 * @file dom-explorer.js
 * @description Live DOM exploration and context extraction for Suno Nonstop DJ.
 *
 * Phase 1: Provides debugDump() and stub extraction.
 * Phase 2+: Full context extraction with scored candidates.
 *
 * PRINCIPLE: All DOM-reading logic is here. content.js calls these functions
 * but never queries DOM selectors directly (except #active-audio-play by ID).
 */

/* ========================================================================
 * CONTEXT EXTRACTION
 * ======================================================================== */

/**
 * Extract current track context from live DOM.
 * Returns an object with all available information, each field annotated
 * with confidence level.
 *
 * @returns {Object} extracted context
 */
function extractTrackContext() {
    const context = {
        title: null,
        subtitle: null,
        tags: [],
        genre: null,
        mood: null,
        style: null,
        prompt: null,
        lyrics: null,
        description: null,
        cardTexts: [],
        confidence: 'low',
        _candidates: {},  // raw candidate data for debugging
    };

    // --- Title ---
    const titleResult = findBestCandidate(TITLE_CANDIDATES);
    if (titleResult) {
        context.title = titleResult.element.textContent.trim();
        context._candidates.title = titleResult.allResults;
    }

    // --- Tags / Genre / Mood / Style ---
    // Phase 2: Will parse tag-like elements near the current track
    // For now, attempt to find any visible tag-like info
    try {
        const tagEls = document.querySelectorAll(
            '[data-testid*="tag"], [data-testid*="genre"], [class*="tag" i], [class*="chip" i]'
        );
        context.tags = Array.from(tagEls)
            .map(el => el.textContent.trim())
            .filter(t => t.length > 0 && t.length < 50);
        context._candidates.tags = { count: tagEls.length, verified: false };
    } catch (_) { /* swallow */ }

    // --- Prompt (display, not input) ---
    // Look for visible prompt text in the player area
    try {
        const promptResult = findBestCandidate(PROMPT_INPUT_CANDIDATES);
        if (promptResult) {
            const val = promptResult.element.value || promptResult.element.textContent;
            context.prompt = (val || '').trim() || null;
            context._candidates.prompt = promptResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // --- Lyrics ---
    try {
        const lyricsResult = findBestCandidate(LYRICS_CANDIDATES);
        if (lyricsResult) {
            context.lyrics = lyricsResult.element.textContent.trim() || null;
            context._candidates.lyrics = lyricsResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // --- Card texts (nearby song cards) ---
    try {
        const cardResult = findBestCandidate(CARD_CANDIDATES);
        if (cardResult) {
            const cards = document.querySelectorAll(cardResult.candidate.selector);
            context.cardTexts = Array.from(cards)
                .slice(0, 10)
                .map(c => c.textContent.trim().substring(0, 200));
            context._candidates.cards = cardResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // Confidence assessment
    const hasTitle = !!context.title;
    const hasTags = context.tags.length > 0;
    const hasPrompt = !!context.prompt;
    if (hasTitle && (hasTags || hasPrompt)) {
        context.confidence = 'medium';
    }
    if (hasTitle && hasTags && hasPrompt) {
        context.confidence = 'high';
    }

    return context;
}

/* ========================================================================
 * SAFETY CHECKS — Detect error conditions in the page
 * ======================================================================== */

/**
 * Check for safety-stop conditions in the live DOM.
 * @returns {{ safe: boolean, reasons: string[] }}
 */
function checkSafetyConditions() {
    const reasons = [];

    try {
        const bodyText = document.body ? document.body.innerText : '';

        // Check for login issues
        if (/sign\s*in|log\s*in|create\s+an?\s+account/i.test(bodyText) &&
            !/sign\s*out|log\s*out|profile/i.test(bodyText)) {
            // Only flag if sign-in text present WITHOUT sign-out (indicating logged-out state)
            // This is heuristic — may need tuning
        }

        // Check for credit-related messages
        if (/insufficient\s+credits|no\s+credits|out\s+of\s+credits|credits?\s*:\s*0\b/i.test(bodyText)) {
            reasons.push('Credits insufficient or exhausted');
        }

        // Check for CAPTCHA
        if (/captcha|verify\s+you\s+are\s+human|i\s+am\s+not\s+a\s+robot/i.test(bodyText)) {
            reasons.push('CAPTCHA or human verification detected');
        }

        // Check for rate limiting
        if (/rate\s*limit|too\s+many\s+requests|slow\s+down/i.test(bodyText)) {
            reasons.push('Rate limiting detected');
        }

    } catch (err) {
        console.warn(`${LOG_PREFIX} Safety check error:`, err.message);
    }

    return {
        safe: reasons.length === 0,
        reasons,
    };
}

/* ========================================================================
 * DEBUG DUMP — for DevTools and dry-run logging
 * ======================================================================== */

/**
 * Produce a comprehensive JSON dump of all detectable DOM elements.
 * Users can run this via DevTools console or trigger from popup.
 *
 * @returns {Object} complete debug information
 */
function debugDump() {
    const dump = {
        timestamp: new Date().toISOString(),
        url: location.href,
        audioElements: [],
        trackContext: null,
        safetyCheck: null,
        selectorCandidates: {},
        createButton: null,
        promptInput: null,
        playButtons: null,
    };

    // Audio elements
    try {
        const audios = document.querySelectorAll('audio');
        dump.audioElements = Array.from(audios).map(a => ({
            id: a.id || '(no id)',
            src: a.src || '(no src)',
            currentTime: a.currentTime,
            duration: a.duration,
            paused: a.paused,
            ended: a.ended,
        }));
    } catch (_) { /* swallow */ }

    // Track context
    try {
        dump.trackContext = extractTrackContext();
    } catch (err) {
        dump.trackContext = { error: err.message };
    }

    // Safety
    try {
        dump.safetyCheck = checkSafetyConditions();
    } catch (err) {
        dump.safetyCheck = { error: err.message };
    }

    // Create button
    try {
        dump.createButton = findBestCandidate(CREATE_BUTTON_CANDIDATES);
        if (dump.createButton) {
            dump.createButton = {
                found: true,
                text: dump.createButton.element.textContent.trim(),
                allResults: dump.createButton.allResults,
            };
        } else {
            dump.createButton = { found: false };
        }
    } catch (err) {
        dump.createButton = { error: err.message };
    }

    // Prompt input
    try {
        dump.promptInput = findBestCandidate(PROMPT_INPUT_CANDIDATES);
        if (dump.promptInput) {
            dump.promptInput = {
                found: true,
                tagName: dump.promptInput.element.tagName,
                allResults: dump.promptInput.allResults,
            };
        } else {
            dump.promptInput = { found: false };
        }
    } catch (err) {
        dump.promptInput = { error: err.message };
    }

    // Play buttons
    try {
        dump.playButtons = findBestCandidate(PLAY_BUTTON_CANDIDATES);
        if (dump.playButtons) {
            dump.playButtons = {
                found: true,
                count: dump.playButtons.allResults.reduce((s, r) => s + r.count, 0),
                allResults: dump.playButtons.allResults,
            };
        } else {
            dump.playButtons = { found: false };
        }
    } catch (err) {
        dump.playButtons = { error: err.message };
    }

    return dump;
}

// Expose debugDump globally for DevTools console access
if (typeof window !== 'undefined') {
    window.__sunoDJ_debugDump = debugDump;
}
