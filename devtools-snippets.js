/**
 * @file devtools-snippets.js
 * @description DevTools Console exploration snippets for Suno's live DOM.
 *
 * HOW TO USE:
 * 1. Open Suno in Chrome
 * 2. Open DevTools (F12)
 * 3. Go to Console tab
 * 4. Copy-paste ONE of the snippets below and press Enter
 * 5. Review the output and share with the developer to tune selectors
 *
 * Each snippet is self-contained and can be run independently.
 * They are wrapped in IIFEs to avoid global pollution.
 */

// =======================================================================
// SNIPPET 1: Audio Elements — Find all <audio> elements and their state
// =======================================================================
// Copy from here ↓
(function audioElementsExplorer() {
    console.group('🎵 [SunoDJ Explorer] Audio Elements');
    const audios = document.querySelectorAll('audio');
    console.log(`Found ${audios.length} audio element(s)`);
    audios.forEach((a, i) => {
        console.log(`\n--- Audio #${i} ---`);
        console.log('  id:', a.id || '(none)');
        console.log('  src:', a.src || '(none)');
        console.log('  currentTime:', a.currentTime);
        console.log('  duration:', a.duration);
        console.log('  paused:', a.paused);
        console.log('  ended:', a.ended);
        console.log('  crossOrigin:', a.crossOrigin);
        console.log('  element:', a);
    });
    console.groupEnd();
    return { count: audios.length };
})();

// =======================================================================
// SNIPPET 2: Track Title Candidates — Find potential "now playing" title
// =======================================================================
// Copy from here ↓
(function titleCandidatesExplorer() {
    console.group('🏷️ [SunoDJ Explorer] Track Title Candidates');
    const candidates = [];

    // Strategy 1: aria-label
    document.querySelectorAll('[aria-label]').forEach(el => {
        const label = el.getAttribute('aria-label');
        if (/play|track|song|title|now/i.test(label)) {
            candidates.push({
                strategy: 'aria-label',
                label,
                text: el.textContent.trim().substring(0, 100),
                tag: el.tagName,
                el
            });
        }
    });

    // Strategy 2: data-testid
    document.querySelectorAll('[data-testid]').forEach(el => {
        const tid = el.getAttribute('data-testid');
        if (/title|track|song|name/i.test(tid)) {
            candidates.push({
                strategy: 'data-testid',
                testid: tid,
                text: el.textContent.trim().substring(0, 100),
                tag: el.tagName,
                el
            });
        }
    });

    // Strategy 3: Headings near audio
    const audio = document.getElementById('active-audio-play');
    if (audio) {
        let parent = audio.parentElement;
        for (let depth = 0; depth < 8 && parent; depth++) {
            const headings = parent.querySelectorAll('h1, h2, h3, h4');
            headings.forEach(h => {
                const text = h.textContent.trim();
                if (text.length > 0 && text.length < 200) {
                    candidates.push({
                        strategy: `heading-near-audio (depth ${depth})`,
                        text,
                        tag: h.tagName,
                        el: h
                    });
                }
            });
            parent = parent.parentElement;
        }
    }

    // Strategy 4: Elements with "marquee" or "scroll" behavior (common for titles)
    document.querySelectorAll('[class*="marquee"], [class*="scroll"], [class*="title"]').forEach(el => {
        const text = el.textContent.trim();
        if (text.length > 0 && text.length < 200) {
            candidates.push({
                strategy: 'class contains marquee/scroll/title',
                className: el.className,
                text,
                tag: el.tagName,
                el
            });
        }
    });

    console.log(`Found ${candidates.length} candidate(s):`);
    candidates.forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.strategy}] "${c.text}" <${c.tag}>`, c.el);
    });
    console.groupEnd();
    return candidates;
})();

// =======================================================================
// SNIPPET 3: Song Card Candidates — Find list/grid of song items
// =======================================================================
// Copy from here ↓
(function cardCandidatesExplorer() {
    console.group('🃏 [SunoDJ Explorer] Song Card Candidates');
    const candidates = [];

    // Strategy 1: role-based
    document.querySelectorAll('[role="listitem"], [role="row"], [role="gridcell"]').forEach(el => {
        candidates.push({
            strategy: 'role',
            role: el.getAttribute('role'),
            text: el.textContent.trim().substring(0, 100),
            childCount: el.children.length,
            el
        });
    });

    // Strategy 2: data-testid
    document.querySelectorAll('[data-testid]').forEach(el => {
        const tid = el.getAttribute('data-testid');
        if (/card|item|track|song|row/i.test(tid)) {
            candidates.push({
                strategy: 'data-testid',
                testid: tid,
                text: el.textContent.trim().substring(0, 100),
                el
            });
        }
    });

    // Strategy 3: Repeated structures (likely cards)
    // Find parent with many similar children
    const lists = document.querySelectorAll('[role="list"], ul, ol, [class*="list"], [class*="grid"]');
    lists.forEach(list => {
        if (list.children.length >= 3) {
            candidates.push({
                strategy: 'list-parent',
                tag: list.tagName,
                className: list.className.substring(0, 80),
                childCount: list.children.length,
                sampleChildText: list.children[0]?.textContent.trim().substring(0, 80),
                el: list
            });
        }
    });

    console.log(`Found ${candidates.length} candidate(s):`);
    candidates.forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.strategy}]`, c);
    });
    console.groupEnd();
    return candidates;
})();

// =======================================================================
// SNIPPET 4: Play Button Candidates
// =======================================================================
// Copy from here ↓
(function playButtonExplorer() {
    console.group('▶️ [SunoDJ Explorer] Play Button Candidates');
    const candidates = [];

    // All buttons with play-related attributes
    document.querySelectorAll('button').forEach(btn => {
        const aria = btn.getAttribute('aria-label') || '';
        const testid = btn.getAttribute('data-testid') || '';
        const text = btn.textContent.trim();
        const title = btn.getAttribute('title') || '';

        if (/play|resume|start/i.test(aria + testid + text + title)) {
            candidates.push({
                strategy: 'button text/aria/testid',
                ariaLabel: aria,
                testid,
                text: text.substring(0, 50),
                title,
                disabled: btn.disabled,
                el: btn
            });
        }
    });

    // SVG icons that might be play buttons
    document.querySelectorAll('svg').forEach(svg => {
        const parent = svg.closest('button, [role="button"], a');
        if (parent) {
            const aria = parent.getAttribute('aria-label') || '';
            if (/play/i.test(aria)) {
                candidates.push({
                    strategy: 'svg inside button with play aria',
                    ariaLabel: aria,
                    el: parent
                });
            }
        }
    });

    console.log(`Found ${candidates.length} candidate(s):`);
    candidates.forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.strategy}]`, c);
    });
    console.groupEnd();
    return candidates;
})();

// =======================================================================
// SNIPPET 5: Create / Generate Button Candidates
// =======================================================================
// Copy from here ↓
(function createButtonExplorer() {
    console.group('🎨 [SunoDJ Explorer] Create/Generate Button Candidates');
    const candidates = [];

    document.querySelectorAll('button, [role="button"], a[href*="create"]').forEach(el => {
        const text = el.textContent.trim();
        const aria = el.getAttribute('aria-label') || '';
        const testid = el.getAttribute('data-testid') || '';

        if (/^(create|generate|make|compose)$/i.test(text) ||
            /create|generate/i.test(aria + testid)) {
            candidates.push({
                text,
                ariaLabel: aria,
                testid,
                tag: el.tagName,
                disabled: el.disabled || false,
                href: el.getAttribute('href') || '',
                el
            });
        }
    });

    console.log(`Found ${candidates.length} candidate(s):`);
    candidates.forEach((c, i) => {
        console.log(`  ${i + 1}.`, c);
    });
    console.groupEnd();
    return candidates;
})();

// =======================================================================
// SNIPPET 6: Prompt Input / Lyrics / Description Candidates
// =======================================================================
// Copy from here ↓
(function inputFieldsExplorer() {
    console.group('📝 [SunoDJ Explorer] Input Fields (Prompt/Lyrics/Description)');
    const candidates = [];

    // Textareas
    document.querySelectorAll('textarea').forEach(ta => {
        candidates.push({
            type: 'textarea',
            placeholder: ta.placeholder,
            ariaLabel: ta.getAttribute('aria-label') || '',
            name: ta.name,
            id: ta.id,
            rows: ta.rows,
            value: ta.value.substring(0, 50),
            el: ta
        });
    });

    // Contenteditable
    document.querySelectorAll('[contenteditable="true"]').forEach(el => {
        candidates.push({
            type: 'contenteditable',
            tag: el.tagName,
            className: el.className.substring(0, 80),
            text: el.textContent.trim().substring(0, 50),
            el
        });
    });

    // Inputs with relevant names
    document.querySelectorAll('input[type="text"], input:not([type])').forEach(inp => {
        const ph = inp.placeholder || '';
        const name = inp.name || '';
        const aria = inp.getAttribute('aria-label') || '';
        if (/prompt|lyric|title|tag|style|genre|descri/i.test(ph + name + aria)) {
            candidates.push({
                type: 'input',
                placeholder: ph,
                name,
                ariaLabel: aria,
                value: inp.value.substring(0, 50),
                el: inp
            });
        }
    });

    console.log(`Found ${candidates.length} candidate(s):`);
    candidates.forEach((c, i) => {
        console.log(`  ${i + 1}.`, c);
    });
    console.groupEnd();
    return candidates;
})();

// =======================================================================
// SNIPPET 7: Generation Status Indicators
// =======================================================================
// Copy from here ↓
(function generationStatusExplorer() {
    console.group('⏳ [SunoDJ Explorer] Generation Status Indicators');
    const statusKeywords = [
        'generating', 'loading', 'processing', 'creating',
        'in progress', 'queued', 'complete', 'ready', 'done',
        'failed', 'error', 'waiting'
    ];

    const indicators = [];
    const bodyText = document.body.innerText.toLowerCase();

    // Check which keywords are present in the page
    statusKeywords.forEach(keyword => {
        if (bodyText.includes(keyword)) {
            // Find the actual elements containing this text
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        return node.textContent.toLowerCase().includes(keyword)
                            ? NodeFilter.FILTER_ACCEPT
                            : NodeFilter.FILTER_REJECT;
                    }
                }
            );

            let count = 0;
            let node;
            while ((node = walker.nextNode()) && count < 3) {
                const parent = node.parentElement;
                if (parent && parent.offsetHeight > 0) { // visible
                    indicators.push({
                        keyword,
                        text: node.textContent.trim().substring(0, 100),
                        parentTag: parent.tagName,
                        parentClass: parent.className.substring(0, 60),
                        el: parent
                    });
                    count++;
                }
            }
        }
    });

    // Also check for progress bars / spinners
    document.querySelectorAll(
        '[role="progressbar"], [class*="spinner"], [class*="loading"], [class*="progress"]'
    ).forEach(el => {
        indicators.push({
            keyword: '(progress/spinner element)',
            tag: el.tagName,
            role: el.getAttribute('role'),
            className: el.className.substring(0, 80),
            ariaValue: el.getAttribute('aria-valuenow'),
            el
        });
    });

    // Credit-related
    const creditTexts = [];
    const creditWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                return /credit/i.test(node.textContent)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        }
    );
    let cnode;
    while ((cnode = creditWalker.nextNode()) && creditTexts.length < 5) {
        creditTexts.push({
            text: cnode.textContent.trim().substring(0, 100),
            parentTag: cnode.parentElement?.tagName,
            el: cnode.parentElement
        });
    }
    if (creditTexts.length > 0) {
        console.log('💳 Credit-related text found:', creditTexts);
    }

    console.log(`Found ${indicators.length} status indicator(s):`);
    indicators.forEach((ind, i) => {
        console.log(`  ${i + 1}. [${ind.keyword}]`, ind);
    });
    console.groupEnd();
    return { indicators, creditTexts };
})();

// =======================================================================
// BONUS: Full Debug Dump (uses the extension's built-in function)
// =======================================================================
// Copy from here ↓  (only works when the extension is loaded)
(function fullDump() {
    if (window.__sunoDJ_debugDump) {
        const dump = window.__sunoDJ_debugDump();
        console.group('🐛 [SunoDJ] Full Debug Dump');
        console.log(JSON.stringify(dump, null, 2));
        console.groupEnd();
        return dump;
    } else if (window.__sunoDJ) {
        const dump = window.__sunoDJ.debugDump();
        console.group('🐛 [SunoDJ] Full Debug Dump');
        console.log(JSON.stringify(dump, null, 2));
        console.groupEnd();
        return dump;
    } else {
        console.warn('[SunoDJ] Extension not loaded. Run the individual snippets above instead.');
    }
})();
