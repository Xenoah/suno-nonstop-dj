/**
 * @file prompt-builder.js
 * @description Next-track prompt generation for Suno Nonstop DJ.
 *
 * Phase 1–2: Stub — returns placeholder prompts.
 * Phase 3+:  Full implementation with 3 strategies.
 *
 * DESIGN: Prompts are built by decomposing the previous track's context into
 * three categories:
 *   - inherit   : elements to keep (world, language, instruments, tempo)
 *   - evolve    : elements to change (energy, structure, hooks)
 *   - avoid     : elements to NOT repeat (same title words, same lyrics)
 */

/* ========================================================================
 * PROMPT TEMPLATES — Phase 3 will expand these significantly
 * ======================================================================== */

/** @constant {Object} Energy progression hints per strategy */
const ENERGY_HINTS = Object.freeze({
    [STRATEGY.CONSERVATIVE]: [
        'maintain the same energy level',
        'keep the same tempo and mood',
    ],
    [STRATEGY.BALANCED]: [
        'slightly increase the energy',
        'add a new instrumental layer',
        'introduce a subtle variation in the rhythm',
    ],
    [STRATEGY.ADVENTUROUS]: [
        'significantly shift the energy',
        'change the time signature',
        'introduce an unexpected genre fusion',
        'add a dramatic key change',
    ],
});

/** @constant {Object} Structure hints per strategy */
const STRUCTURE_HINTS = Object.freeze({
    [STRATEGY.CONSERVATIVE]: [
        'follow a similar song structure',
    ],
    [STRATEGY.BALANCED]: [
        'extend the bridge section',
        'add a stronger chorus',
        'introduce a new verse pattern',
    ],
    [STRATEGY.ADVENTUROUS]: [
        'completely reimagine the song structure',
        'start with the chorus',
        'use a progressive build-up',
    ],
});

/* ========================================================================
 * PROMPT BUILDER
 * ======================================================================== */

/**
 * Build a next-track prompt from the extracted context.
 *
 * @param {Object} context - from extractTrackContext()
 * @param {string} strategy - one of STRATEGY values
 * @returns {{ prompt: string, meta: Object }}
 */
function buildNextPrompt(context, strategy = STRATEGY.BALANCED) {
    const meta = {
        strategy,
        inherited: [],
        evolved: [],
        avoided: [],
        contextConfidence: context.confidence || 'low',
    };

    const styleParts = [];
    const lyricsParts = [];
    let title = '';

    // --- INHERIT: carry over core elements ---
    if (context.style) {
        // Carry over existing style text (from styles textarea)
        styleParts.push(context.style);
        meta.inherited.push(`styles: ${context.style}`);
    } else if (context.tags && context.tags.length > 0) {
        // Use tags as styles
        const kept = context.tags.slice(0, 5);
        styleParts.push(kept.join(', '));
        meta.inherited.push(`tags as styles: ${kept.join(', ')}`);
    }

    if (context.genre) {
        styleParts.push(context.genre);
        meta.inherited.push(`genre: ${context.genre}`);
    }

    if (context.mood) {
        styleParts.push(context.mood);
        meta.inherited.push(`mood: ${context.mood}`);
    }

    // --- EVOLVE: add variation ---
    const energyPool = ENERGY_HINTS[strategy] || ENERGY_HINTS[STRATEGY.BALANCED];
    const structPool = STRUCTURE_HINTS[strategy] || STRUCTURE_HINTS[STRATEGY.BALANCED];

    const energyHint = energyPool[Math.floor(Math.random() * energyPool.length)];
    const structHint = structPool[Math.floor(Math.random() * structPool.length)];

    // Add energy/structure hints to lyrics instead of styles
    lyricsParts.push(energyHint);
    lyricsParts.push(structHint);
    meta.evolved.push(energyHint, structHint);

    // --- AVOID: prevent repetition ---
    if (context.title) {
        meta.avoided.push(`Avoid repeating title words from: "${context.title}"`);
        // Generate a continuation title
        title = `${context.title} (continuation)`;
    }

    if (context.lyrics) {
        const firstLine = context.lyrics.split('\n')[0] || '';
        if (firstLine.length > 0) {
            meta.avoided.push(`Avoid repeating opening lyric: "${firstLine.substring(0, 60)}"`);
        }
    }

    // --- ASSEMBLE ---
    let styles = styleParts.filter(Boolean).join(', ');
    let prompt = lyricsParts.filter(Boolean).join(', ');

    // If context was very thin, produce a generic continuation prompt
    if (!prompt || prompt.length < 10) {
        prompt = 'A continuation track that flows naturally from the previous song';
        meta.inherited.push('(fallback — insufficient context)');
    }

    // Strategy-specific prefix for the lyrics/prompt
    if (strategy === STRATEGY.ADVENTUROUS) {
        prompt = `An adventurous evolution: ${prompt}`;
    } else if (strategy === STRATEGY.CONSERVATIVE) {
        prompt = `A natural continuation: ${prompt}`;
    }

    return { prompt, styles, title, meta };
}

/**
 * Build a prompt and return a full plan (for dry-run / logging).
 *
 * @param {Object} context
 * @param {string} strategy
 * @returns {Object} plan with prompt, meta, and action descriptions
 */
function buildNextPromptPlan(context, strategy = STRATEGY.BALANCED) {
    const result = buildNextPrompt(context, strategy);
    return {
        ...result,
        actions: [
            `1. Find prompt input field`,
            `2. Clear existing text`,
            `3. Enter: "${result.prompt}"`,
            `4. ${strategy === STRATEGY.CONSERVATIVE ? 'Wait for user to click Create (manual)' : 'Locate and click Create button'}`,
        ],
        dryRun: true,
    };
}
