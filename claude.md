# Suno Nonstop DJ - Working Progress

Last updated: 2026-03-20

## Purpose

Build a Chrome extension for `suno.com` that watches the currently playing track, starts preparing the next generation before the current track ends, and aims to keep playback going with a safe, stepwise rollout.

This document is the internal working log. It tracks:

- what the user actually asked for
- what is confirmed
- what is still only a hypothesis
- what has already been implemented
- what is still missing before the intended nonstop loop is trustworthy

## User Intent Summary

The requested end state is:

1. Watch `#active-audio-play` on Suno pages.
2. When remaining time falls below the threshold, begin next-track generation work.
3. Read live DOM only after hydration.
4. Build the next prompt from current track context, without blindly copying.
5. Prepare next playback, then switch into the next track when appropriate.
6. Expose clear user controls and a safe stop path at all times.
7. Progress in phases, without pretending unverified DOM assumptions are complete.

## Non-Negotiable Constraints

These came directly from the user request and must stay true:

- No OCR
- No page-source scraping as the primary source of truth
- Read hydrated live DOM
- Ignore `#silent-audio`
- Do not implement CAPTCHA bypass, bot bypass, auth bypass, hidden API calls, or rate-limit evasion
- Operate only as an assistive tool on the page the user actually has open
- Do not turn this into bulk scraping or mass automation
- Always provide Start / Stop controls
- Prefer robust MVP over aggressive full automation
- Do not overstate what is implemented
- Keep DOM-dependent logic centralized
- Keep `dry-run` safe: no clicks, no input mutation

## Confirmed Facts

- Suno is client-rendered after hydration, so live DOM is the source of truth.
- `#active-audio-play` is the primary playback target.
- `#silent-audio` must be ignored.
- Selector priority should remain:
  1. `id`
  2. `data-*`
  3. `aria-*`
  4. `role`
  5. explicit text / labels
  6. `class` as last resort

## Current Repository Shape

- `manifest.json`
  Manifest V3 entrypoint.
- `constants.js`
  Shared constants, states, modes, strategies, defaults.
- `state-machine.js`
  FSM transitions and history logging.
- `selectors.js`
  Candidate selectors and scoring logic.
- `dom-explorer.js`
  Live DOM extraction, safety checks, debug dump.
- `prompt-builder.js`
  Prompt composition logic.
- `content.js`
  Main runtime and orchestration.
- `service_worker.js`
  Message relay, settings bridge, log storage.
- `popup.html`, `popup.js`, `popup.css`
  Operator UI.
- `devtools-snippets.js`
  Console exploration helpers.
- `README.md`
  External-facing usage and debugging guide.

## Implementation Status by Phase

### Phase 1

Goal:

- find `#active-audio-play`
- monitor remaining seconds
- Start/Stop from popup
- log threshold reached once per track

Status: implemented

Notes:

- audio attach and monitoring exist in `content.js`
- `play`, `pause`, `ended`, `timeupdate`, `loadedmetadata`, `error`, `emptied` are handled
- remaining time is computed from `duration - currentTime`
- duplicate threshold triggering is guarded by `lastTriggeredSrc`

### Phase 2

Goal:

- inspect live DOM
- extract title/card/play-button candidates
- show dry-run planning instead of acting

Status: partially implemented, partially verified

Implemented:

- candidate-based selector system in `selectors.js`
- `findBestCandidate()` scoring helper
- `debugDump()` in `dom-explorer.js`
- `extractTrackContext()`
- `devtools-snippets.js` for live inspection

Still uncertain:

- current track title selector in player area
- card selector on library/list views
- play button selector on newest generated item

### Phase 3

Goal:

- find prompt / lyrics / styles / title inputs
- generate next prompt
- support `manual-create`

Status: mostly implemented, still needs live verification

Implemented:

- `buildNextPrompt()` and strategy handling
- prompt, styles, title filling logic
- `manual-create` mode
- dry-run logging of intended actions

Verified enough to use as candidates:

- lyrics textarea
- styles textarea
- song title input
- prompt-like song description textarea
- style suggestion tags

Still uncertain:

- exact reliability of prompt input choice across Suno variants
- whether instrumental mode needs branching before filling

### Phase 4

Goal:

- `auto-create`
- detect generation completion
- switch playback or recover if autoplay happens

Status: partially implemented, not fully validated end-to-end

Implemented:

- `auto-create` mode
- `WAITING_NEXT_READY`
- `generationSrcSnapshot`
- polling-based generation waiting
- direct recovery to `PLAYING_CURRENT` when Suno auto-plays a new track
- `ARMED_FOR_SWITCH` and `SWITCHING_PLAYBACK`

Still uncertain:

- exact create button selector
- exact play button selector for switching
- whether loading/progress fallback is reliable enough
- whether different Suno pages change autoplay behavior

## Acceptance Criteria Tracking

1. Correctly get `#active-audio-play` on library/play pages
   Status: implemented, needs live re-check on current Suno UI

2. Detect play / pause / end
   Status: implemented

3. Trigger once when remaining time goes below 120 seconds
   Status: implemented

4. Observe live DOM and extract title candidates etc.
   Status: implemented as candidate-based exploration, not fully verified

5. Toggle automation from popup
   Status: implemented

6. In `dry-run`, show current state and next planned action
   Status: implemented, but UX can still be improved

7. Gracefully stop when selector resolution fails or DOM changes too much
   Status: partially implemented through error flow and safety checks

8. In `manual-create`, reach prompt autofill
   Status: implemented in code, still needs live validation on current DOM

## Current FSM Shape

States currently defined:

- `IDLE`
- `WAITING_AUDIO`
- `PLAYING_CURRENT`
- `THRESHOLD_REACHED`
- `EXTRACTING_CONTEXT`
- `COMPOSING_NEXT_PROMPT`
- `TRIGGERING_GENERATION`
- `WAITING_NEXT_READY`
- `ARMED_FOR_SWITCH`
- `SWITCHING_PLAYBACK`
- `ERROR`
- `STOPPED`

Important recent change:

- `WAITING_NEXT_READY -> PLAYING_CURRENT` is now allowed when Suno auto-plays the new track
- `ARMED_FOR_SWITCH -> PLAYING_CURRENT` is also allowed for the same reason

## Current Working Assumptions

These are useful, but still not guaranteed:

- generic `button` matching with text `"Create"` can still find the correct Create button
- generic play button candidates are sufficient to switch to the newest generated track
- `audio.src` is the most trustworthy indicator that the newly generated song has become active
- loading/progress disappearance may help as a fallback completion signal

## Verified vs Unverified Selector Areas

More stable / verified enough:

- `#active-audio-play`
- lyrics textarea
- styles textarea
- title input
- style suggestion tags
- prompt-like description textarea

Still weak / candidate only:

- now-playing title in the player bar
- song cards
- play buttons for switching
- create button
- instrumental mode toggle

## Safety and Stop Strategy

Currently implemented safety checks:

- credits exhaustion text detection
- CAPTCHA / human verification text detection
- rate-limit text detection
- maximum consecutive error threshold

Still missing or weak:

- explicit login-expired detection that is stronger than generic page text search
- richer surfaced stop reason in popup UI
- more deterministic stop path when multiple selectors degrade at once

## Current Progress Focus

The current code changes are centered on nonstop loop behavior after `Create`.

Specifically:

- keep track of the audio source before generation
- wait for the next track to appear
- detect if Suno auto-started the new track
- avoid unnecessary manual switching when autoplay already happened
- snapshot visible track cards before generation
- diff the visible queue after generation to prefer the newly appeared card
- avoid clicking the first generic Play button when switching
- when the new card cannot be identified directly, fall back to an adjacent card relative to the current one, biased toward older -> latest progression
- stop routing generated prompt text into the lyrics field; only fill a dedicated prompt-like field when one is safely identified

This is the most important implementation shift since the initial MVP.

## Known Gaps Relative to the Original Ask

- `Pause automation` is requested conceptually in the original brief, but the current popup centers on `Start` and `Stop`
- popup status could expose clearer `last error` and stop reason fields
- not all graceful-stop scenarios are surfaced cleanly in UI yet
- README is now closer to reality, but future code changes will require keeping it in sync

## Immediate Next Steps

1. Validate `dry-run` on current Suno UI with real playback.
2. Use `debugDump()` and `devtools-snippets.js` to confirm Create and Play selectors.
3. Tighten `selectors.js` so fewer actions depend on generic `button` searches.
4. Verify `manual-create` input filling end-to-end.
5. Verify `auto-create` plus autoplay recovery end-to-end.
6. Improve popup status for stop reason / last error / paused state if needed.

## If Work Resumes Later

Start from these files first:

1. `content.js`
2. `selectors.js`
3. `dom-explorer.js`
4. `popup.js`

And validate in this order:

1. audio detection
2. dry-run threshold
3. context extraction
4. manual-create input fill
5. auto-create
6. autoplay recovery / playback switch
