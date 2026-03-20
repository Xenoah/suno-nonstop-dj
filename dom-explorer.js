/**
 * @file dom-explorer.js
 * @description Live DOM exploration and context extraction for Suno Nonstop DJ.
 *
 * UPDATED: 2026-03-17 — Uses verified selectors from real Suno DOM.
 *
 * Suno create page structure (verified):
 * - Song Title:  input[placeholder="Song Title (Optional)"]
 * - Lyrics:      textarea[data-testid="lyrics-textarea"]
 * - Styles:      textarea[maxlength="1000"]
 * - Style tags:  button[aria-label^="Add style:"]
 * - Song Desc:   .efvek1x1 textarea
 * - Create btn:  button with text "Create"
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

    // --- Song Title (from create form input) ---
    try {
        const titleResult = findBestCandidate(TITLE_INPUT_CANDIDATES);
        if (titleResult) {
            const val = titleResult.element.value || titleResult.element.textContent;
            context.title = (val || '').trim() || null;
            context._candidates.titleInput = titleResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // --- Also look for "now playing" title from player bar ---
    if (!context.title) {
        try {
            const titleResult = findBestCandidate(TITLE_CANDIDATES);
            if (titleResult) {
                context.title = titleResult.element.textContent.trim();
                context._candidates.title = titleResult.allResults;
            }
        } catch (_) { /* swallow */ }
    }

    // --- Lyrics (from lyrics textarea) ---
    try {
        const lyricsResult = findBestCandidate(LYRICS_INPUT_CANDIDATES);
        if (lyricsResult) {
            const val = lyricsResult.element.value || lyricsResult.element.textContent;
            context.lyrics = (val || '').trim() || null;
            context._candidates.lyrics = lyricsResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // --- Styles (from styles textarea) ---
    try {
        const stylesResult = findBestCandidate(STYLES_INPUT_CANDIDATES);
        if (stylesResult) {
            const val = stylesResult.element.value || stylesResult.element.textContent;
            context.style = (val || '').trim() || null;
            context._candidates.styles = stylesResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // --- Style tags (from aria-label="Add style: ..." buttons) ---
    try {
        const tagResult = findBestCandidate(STYLE_TAG_CANDIDATES);
        if (tagResult) {
            const tagButtons = document.querySelectorAll('button[aria-label^="Add style:"]');
            context.tags = Array.from(tagButtons)
                .map(btn => {
                    const label = btn.getAttribute('aria-label') || '';
                    return label.replace(/^Add style:\s*/i, '').trim();
                })
                .filter(t => t.length > 0);
            context._candidates.tags = { count: tagButtons.length, verified: true };
        }
    } catch (_) { /* swallow */ }

    // --- Song Description ---
    try {
        const descResult = findBestCandidate(DESCRIPTION_INPUT_CANDIDATES);
        if (descResult) {
            const val = descResult.element.value || descResult.element.textContent;
            context.description = (val || '').trim() || null;
            context._candidates.description = descResult.allResults;
        }
    } catch (_) { /* swallow */ }

    // --- Prompt (Song Description textarea as main prompt) ---
    try {
        const promptResult = findBestCandidate(PROMPT_INPUT_CANDIDATES);
        if (promptResult) {
            const val = promptResult.element.value || promptResult.element.textContent;
            context.prompt = (val || '').trim() || null;
            context._candidates.prompt = promptResult.allResults;
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
    const hasLyrics = !!context.lyrics;
    const hasStyle = !!context.style;
    const hasPrompt = !!context.prompt;
    const hasDescription = !!context.description;

    const infoCount = [hasTitle, hasTags, hasLyrics, hasStyle, hasPrompt, hasDescription]
        .filter(Boolean).length;

    if (infoCount >= 3) {
        context.confidence = 'high';
    } else if (infoCount >= 1) {
        context.confidence = 'medium';
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
        lyricsInput: null,
        stylesInput: null,
        titleInput: null,
        playButtons: null,
        styleTags: [],
        trackQueue: null,
        pendingSwitchTarget: null,
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

    // Title input
    try {
        const r = findBestCandidate(TITLE_INPUT_CANDIDATES);
        dump.titleInput = r ? { found: true, value: r.element.value, allResults: r.allResults } : { found: false };
    } catch (err) {
        dump.titleInput = { error: err.message };
    }

    // Lyrics input (VERIFIED selector)
    try {
        const r = findBestCandidate(LYRICS_INPUT_CANDIDATES);
        dump.lyricsInput = r ? { found: true, value: r.element.value, tagName: r.element.tagName, allResults: r.allResults } : { found: false };
    } catch (err) {
        dump.lyricsInput = { error: err.message };
    }

    // Styles input (VERIFIED selector)
    try {
        const r = findBestCandidate(STYLES_INPUT_CANDIDATES);
        dump.stylesInput = r ? { found: true, value: r.element.value, allResults: r.allResults } : { found: false };
    } catch (err) {
        dump.stylesInput = { error: err.message };
    }

    // Style tags (VERIFIED selector)
    try {
        const buttons = document.querySelectorAll('button[aria-label^="Add style:"]');
        dump.styleTags = Array.from(buttons).map(b => b.getAttribute('aria-label').replace(/^Add style:\s*/i, ''));
    } catch (err) {
        dump.styleTags = { error: err.message };
    }

    // Create button
    try {
        const r = findBestCandidate(CREATE_BUTTON_CANDIDATES);
        dump.createButton = r ? { found: true, text: r.element.textContent.trim(), allResults: r.allResults } : { found: false };
    } catch (err) {
        dump.createButton = { error: err.message };
    }

    // Prompt input (Song Description)
    try {
        const r = findBestCandidate(PROMPT_INPUT_CANDIDATES);
        dump.promptInput = r ? { found: true, tagName: r.element.tagName, value: r.element.value || '(no value)', allResults: r.allResults } : { found: false };
    } catch (err) {
        dump.promptInput = { error: err.message };
    }

    // Play buttons
    try {
        const r = findBestCandidate(PLAY_BUTTON_CANDIDATES);
        dump.playButtons = r ? { found: true, count: r.allResults.reduce((s, x) => s + x.count, 0), allResults: r.allResults } : { found: false };
    } catch (err) {
        dump.playButtons = { error: err.message };
    }

    // Track queue snapshot from content.js helpers
    try {
        if (window.__sunoDJ && typeof window.__sunoDJ.collectTrackCandidates === 'function') {
            const tracks = window.__sunoDJ.collectTrackCandidates();
            dump.trackQueue = tracks.map(track => ({
                index: track.index,
                text: track.text,
                signature: track.signature,
            }));
            dump.pendingSwitchTarget = window.__sunoDJ.pendingSwitchTarget || null;
        }
    } catch (err) {
        dump.trackQueue = { error: err.message };
    }

    return dump;
}

// Expose debugDump globally for DevTools console access
if (typeof window !== 'undefined') {
    window.__sunoDJ_debugDump = debugDump;
}
