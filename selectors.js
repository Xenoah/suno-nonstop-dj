/**
 * @file selectors.js
 * @description DOM selector candidates with scoring for Suno Nonstop DJ.
 *
 * Phase 1: Stub — only AUDIO_ELEMENT_ID is used.
 * Phase 2+: Will contain scored selector candidates for title, cards, buttons, etc.
 *
 * DESIGN PRINCIPLE: All DOM-structure-dependent logic is centralised here.
 * When Suno's DOM changes, update ONLY this file.
 */

/* ========================================================================
 * SELECTOR CANDIDATE FORMAT
 *
 * Each candidate is an object:
 * {
 *   description: string,      // human-readable explanation
 *   selector: string,         // CSS selector
 *   score: number,            // 0–100 confidence (higher = more stable)
 *   basis: string,            // why this score: 'id' | 'data-attr' | 'aria' | 'role' | 'label' | 'class'
 *   verified: boolean,        // true if confirmed against live DOM
 * }
 * ======================================================================== */

/**
 * Selector candidates for the currently playing track title.
 * ⚠️ HYPOTHETICAL — not yet verified against live DOM.
 * @type {Array<Object>}
 */
const TITLE_CANDIDATES = [
    // --- These are HYPOTHETICAL candidates. Must be verified via DevTools. ---
    {
        description: 'aria-label containing "now playing" on a heading or span',
        selector: '[aria-label*="now playing"], [aria-label*="Now Playing"]',
        score: 60,
        basis: 'aria',
        verified: false,
    },
    {
        description: 'data-testid for track title (common in React apps)',
        selector: '[data-testid="track-title"], [data-testid="song-title"]',
        score: 55,
        basis: 'data-attr',
        verified: false,
    },
    {
        description: 'Heading near the audio player area',
        selector: 'h1, h2, h3',
        score: 20,
        basis: 'tag',
        verified: false,
    },
];

/**
 * Selector candidates for song cards in the library/playlist.
 * ⚠️ HYPOTHETICAL
 * @type {Array<Object>}
 */
const CARD_CANDIDATES = [
    {
        description: 'data-testid for song card',
        selector: '[data-testid="song-card"], [data-testid="track-card"]',
        score: 55,
        basis: 'data-attr',
        verified: false,
    },
    {
        description: 'role=listitem inside a list of tracks',
        selector: '[role="listitem"], [role="row"]',
        score: 40,
        basis: 'role',
        verified: false,
    },
];

/**
 * Selector candidates for the play button on a song card.
 * ⚠️ HYPOTHETICAL
 * @type {Array<Object>}
 */
const PLAY_BUTTON_CANDIDATES = [
    {
        description: 'button with aria-label "Play"',
        selector: 'button[aria-label="Play"], button[aria-label="play"]',
        score: 65,
        basis: 'aria',
        verified: false,
    },
    {
        description: 'data-testid for play button',
        selector: '[data-testid="play-button"], [data-testid="play-btn"]',
        score: 55,
        basis: 'data-attr',
        verified: false,
    },
];

/**
 * Selector candidates for the Create / Generate button.
 * ⚠️ HYPOTHETICAL
 * @type {Array<Object>}
 */
const CREATE_BUTTON_CANDIDATES = [
    {
        description: 'button whose text content is "Create" or "Generate"',
        selector: 'button',  // filtered by textContent in dom-explorer
        score: 50,
        basis: 'label',
        verified: false,
        textMatch: /^(create|generate)$/i,
    },
    {
        description: 'data-testid for create button',
        selector: '[data-testid="create-button"], [data-testid="generate-button"]',
        score: 55,
        basis: 'data-attr',
        verified: false,
    },
];

/**
 * Selector candidates for the prompt input field.
 * ⚠️ HYPOTHETICAL
 * @type {Array<Object>}
 */
const PROMPT_INPUT_CANDIDATES = [
    {
        description: 'textarea for prompt input',
        selector: 'textarea[placeholder*="prompt" i], textarea[placeholder*="describe" i], textarea[aria-label*="prompt" i]',
        score: 60,
        basis: 'aria',
        verified: false,
    },
    {
        description: 'contenteditable div for prompt',
        selector: 'div[contenteditable="true"]',
        score: 30,
        basis: 'tag',
        verified: false,
    },
    {
        description: 'data-testid for prompt input',
        selector: '[data-testid="prompt-input"], [data-testid="prompt-textarea"]',
        score: 55,
        basis: 'data-attr',
        verified: false,
    },
];

/**
 * Selector candidates for lyrics / description fields.
 * ⚠️ HYPOTHETICAL
 * @type {Array<Object>}
 */
const LYRICS_CANDIDATES = [
    {
        description: 'textarea for lyrics',
        selector: 'textarea[placeholder*="lyrics" i], textarea[aria-label*="lyrics" i]',
        score: 55,
        basis: 'aria',
        verified: false,
    },
    {
        description: 'div with lyrics content (display, not input)',
        selector: '[data-testid="lyrics"], [data-testid="song-lyrics"]',
        score: 50,
        basis: 'data-attr',
        verified: false,
    },
];

/* ========================================================================
 * SCORING UTILITY
 * ======================================================================== */

/**
 * Find the best matching DOM element from a list of candidates.
 * Returns { element, candidate, allResults } or null.
 *
 * @param {Array<Object>} candidates - selector candidate list
 * @param {Document|Element} [root=document] - search root
 * @returns {{ element: Element, candidate: Object, allResults: Array }|null}
 */
function findBestCandidate(candidates, root = document) {
    const results = [];

    for (const cand of candidates) {
        try {
            const els = Array.from((root || document).querySelectorAll(cand.selector));

            // If candidate has a textMatch filter, apply it
            const filtered = cand.textMatch
                ? els.filter(el => cand.textMatch.test(el.textContent.trim()))
                : els;

            if (filtered.length > 0) {
                results.push({
                    candidate: cand,
                    elements: filtered,
                    count: filtered.length,
                    effectiveScore: cand.score + (cand.verified ? 20 : 0),
                });
            }
        } catch (err) {
            console.warn(`${LOG_PREFIX} Selector error for "${cand.description}":`, err.message);
        }
    }

    if (results.length === 0) return null;

    // Sort by effective score descending
    results.sort((a, b) => b.effectiveScore - a.effectiveScore);

    const best = results[0];
    return {
        element: best.elements[0],
        candidate: best.candidate,
        allResults: results.map(r => ({
            description: r.candidate.description,
            selector: r.candidate.selector,
            score: r.effectiveScore,
            count: r.count,
            verified: r.candidate.verified,
        })),
    };
}
