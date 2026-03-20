/**
 * @file selectors.js
 * @description DOM selector candidates with scoring for Suno Nonstop DJ.
 *
 * UPDATED: 2026-03-17 — Based on live DOM inspection of suno.com/create.
 * The Suno create page uses Chakra UI (CSS-in-JS with Emotion).
 * Key findings:
 *   - textarea[data-testid="lyrics-textarea"] is CONFIRMED
 *   - Styles textarea uses maxlength="1000"
 *   - Song title uses input[placeholder="Song Title (Optional)"]
 *   - Buttons use data-button-id and data-context-menu-trigger
 *   - Style tags use aria-label="Add style: ..."
 *   - Song Description textarea is in a separate section
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
 * Selector candidates for the Song Title input on the create page.
 * ✅ VERIFIED against live DOM 2026-03-17
 * @type {Array<Object>}
 */
const TITLE_INPUT_CANDIDATES = [
    {
        description: 'Song Title input by placeholder (verified)',
        selector: 'input[placeholder="Song Title (Optional)"]',
        score: 90,
        basis: 'placeholder',
        verified: true,
    },
    {
        description: 'Song Title input — fallback by class pattern near music note SVG',
        selector: '.e1ri0ifz1 input',
        score: 30,
        basis: 'class',
        verified: true,
    },
];

/**
 * Selector candidates for the currently playing track title.
 * These are for the PLAYER BAR (bottom), not the create form.
 * ⚠️ PARTIALLY VERIFIED — player bar DOM not yet provided.
 * @type {Array<Object>}
 */
const TITLE_CANDIDATES = [
    {
        description: 'aria-label containing "now playing" on a heading or span',
        selector: '[aria-label*="now playing" i], [aria-label*="Now Playing"]',
        score: 60,
        basis: 'aria',
        verified: false,
    },
    {
        description: 'data-testid for track title',
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
 * ⚠️ PARTIALLY VERIFIED — library page DOM not yet provided.
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
 * ⚠️ PARTIALLY VERIFIED
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
 * The create page has a "Create" button at the bottom of the form.
 * ⚠️ PARTIALLY VERIFIED — button text confirmed but full selector not confirmed.
 * @type {Array<Object>}
 */
const CREATE_BUTTON_CANDIDATES = [
    {
        description: 'Button with text "Create" (case-insensitive)',
        selector: 'button',
        score: 60,
        basis: 'label',
        verified: false,
        textMatch: /^create$/i,
    },
    {
        description: 'Button with aria-label containing "Create"',
        selector: 'button[aria-label*="Create" i]',
        score: 65,
        basis: 'aria',
        verified: false,
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
 * Selector candidates for the LYRICS textarea on the create page.
 * ✅ VERIFIED against live DOM 2026-03-17
 * @type {Array<Object>}
 */
const LYRICS_INPUT_CANDIDATES = [
    {
        description: 'Lyrics textarea by data-testid (VERIFIED)',
        selector: 'textarea[data-testid="lyrics-textarea"]',
        score: 100,
        basis: 'data-attr',
        verified: true,
    },
    {
        description: 'Lyrics textarea by placeholder content',
        selector: 'textarea[placeholder*="lyrics" i]',
        score: 75,
        basis: 'placeholder',
        verified: true,
    },
];

/**
 * Selector candidates for the STYLES textarea on the create page.
 * ✅ VERIFIED against live DOM 2026-03-17
 * The styles textarea has maxlength="1000" and is in the "Styles" section.
 * @type {Array<Object>}
 */
const STYLES_INPUT_CANDIDATES = [
    {
        description: 'Styles textarea by maxlength=1000 (VERIFIED)',
        selector: 'textarea[maxlength="1000"]',
        score: 85,
        basis: 'attr',
        verified: true,
    },
];

/**
 * Selector candidates for the SONG DESCRIPTION textarea.
 * ✅ PARTIALLY VERIFIED — present in "Song Description" collapsible section.
 * @type {Array<Object>}
 */
const DESCRIPTION_INPUT_CANDIDATES = [
    {
        description: 'Song Description textarea (third textarea, no data-testid or maxlength)',
        selector: '.efvek1x1 textarea, .efvek1x0 textarea',
        score: 50,
        basis: 'class',
        verified: true,
    },
];

/**
 * Selector candidates for style suggestion buttons.
 * ✅ VERIFIED against live DOM 2026-03-17
 * @type {Array<Object>}
 */
const STYLE_TAG_CANDIDATES = [
    {
        description: 'Style suggestion buttons by aria-label "Add style: ..." (VERIFIED)',
        selector: 'button[aria-label^="Add style:"]',
        score: 95,
        basis: 'aria',
        verified: true,
    },
];

/**
 * Selector candidates for display of lyrics (read only, in player/detail view).
 * ⚠️ NOT YET VERIFIED
 * @type {Array<Object>}
 */
const LYRICS_CANDIDATES = [
    {
        description: 'Lyrics textarea by data-testid (VERIFIED)',
        selector: 'textarea[data-testid="lyrics-textarea"]',
        score: 100,
        basis: 'data-attr',
        verified: true,
    },
    {
        description: 'Lyrics display or input by placeholder',
        selector: 'textarea[placeholder*="lyrics" i]',
        score: 70,
        basis: 'placeholder',
        verified: true,
    },
];

/**
 * Selector candidates for the prompt-like input (Song Description in "simple" mode).
 * ✅ VERIFIED — the "Song Description" section acts as the main prompt.
 * @type {Array<Object>}
 */
const PROMPT_INPUT_CANDIDATES = [
    {
        description: 'Song Description textarea in simple create mode',
        selector: '.efvek1x1 textarea',
        score: 55,
        basis: 'class',
        verified: true,
    },
    {
        description: 'Lyrics textarea by data-testid (use as fallback prompt input)',
        selector: 'textarea[data-testid="lyrics-textarea"]',
        score: 90,
        basis: 'data-attr',
        verified: true,
    },
    {
        description: 'Styles textarea by maxlength=1000',
        selector: 'textarea[maxlength="1000"]',
        score: 60,
        basis: 'attr',
        verified: true,
    },
];

/**
 * Selector candidates for the "Enhance lyrics" input.
 * ✅ VERIFIED against live DOM 2026-03-17
 * @type {Array<Object>}
 */
const ENHANCE_INPUT_CANDIDATES = [
    {
        description: 'Enhance lyrics input by placeholder (VERIFIED)',
        selector: 'input[placeholder*="Enhance lyrics" i]',
        score: 90,
        basis: 'placeholder',
        verified: true,
    },
];

/**
 * Selector candidates for the "Exclude styles" input.
 * ✅ VERIFIED against live DOM 2026-03-17
 * @type {Array<Object>}
 */
const EXCLUDE_STYLES_CANDIDATES = [
    {
        description: 'Exclude styles input by placeholder (VERIFIED)',
        selector: 'input[placeholder="Exclude styles"]',
        score: 90,
        basis: 'placeholder',
        verified: true,
    },
];

/**
 * Selector candidates for detecting instrumental mode.
 * On Suno's create page, the Lyrics section header ("Lyrics") has a
 * collapse/expand toggle. When it says "leave blank for instrumental"
 * and the textarea is hidden or the placeholder indicates instrumental,
 * we consider it instrumental mode.
 *
 * Detection strategy:
 *   - Check if lyrics textarea placeholder contains "instrumental"
 *   - Check if a toggle/switch near "Lyrics" is in "off" state
 *   - Check for aria-checked or data-state on a switch element
 * @type {Array<Object>}
 */
const INSTRUMENTAL_TOGGLE_CANDIDATES = [
    {
        description: 'Switch/toggle near Lyrics section with data-state',
        selector: '[data-testid="instrumental-toggle"], button[role="switch"]',
        score: 70,
        basis: 'role',
        verified: false,
    },
    {
        description: 'Chakra Switch input checkbox',
        selector: 'input[type="checkbox"][role="switch"]',
        score: 65,
        basis: 'role',
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
