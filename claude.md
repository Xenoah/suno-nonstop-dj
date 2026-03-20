# Suno Nonstop DJ - Internal Progress

## Snapshot

Updated: 2026-03-20

This repository is a build-free Chrome Extension using Manifest V3.
It runs on `suno.com`, watches the active audio element, and tries to keep playback flowing by preparing the next generation before the current track ends.

## Current Architecture

- `manifest.json`
  Loads the extension popup, service worker, and content script bundle.
- `content.js`
  Main runtime. Owns audio monitoring, finite state transitions, DOM extraction, prompt composition, generation triggering, and playback switching.
- `state-machine.js`
  Transition table and bounded transition history.
- `selectors.js`
  Central source of Suno DOM selector candidates and scoring.
- `dom-explorer.js`
  DOM reading, safety checks, and `debugDump()`.
- `prompt-builder.js`
  Next-track prompt generation for `conservative`, `balanced`, and `adventurous`.
- `service_worker.js`
  Popup/content-script relay plus in-memory log aggregation.
- `popup.html`, `popup.js`, `popup.css`
  Operator UI for start/stop, settings, logs, and debug dump.
- `devtools-snippets.js`
  Console helpers for live DOM inspection.

## Implemented Flow

1. Popup sends `START_AUTOMATION`.
2. `content.js` enters `WAITING_AUDIO` and attaches to `#active-audio-play`.
3. Playback enters `PLAYING_CURRENT`.
4. When remaining time is below threshold, state moves to `THRESHOLD_REACHED`.
5. In `dry-run`, context extraction and prompt planning are logged only.
6. In active modes, DOM context is extracted, next prompt is built, and fields are filled.
7. In `auto-create`, the extension clicks `Create` and waits in `WAITING_NEXT_READY`.
8. If Suno auto-plays the new track, the FSM can now return directly to `PLAYING_CURRENT`.
9. If autoplay does not happen, the extension arms playback switching and tries the next play button near track end.

## Confirmed / Stable Enough

- Active audio lookup by `#active-audio-play`
- Popup to service worker to content-script messaging
- FSM-based orchestration with transition logging
- Threshold guard using `lastTriggeredSrc`
- `dry-run`, `manual-create`, `auto-create` modes
- Safety stop checks for credits, CAPTCHA, and rate limiting
- Verified selector candidates for:
  - Lyrics textarea
  - Styles textarea
  - Song title input
  - Style suggestion tags
  - Prompt-like song description textarea

## Recent Progress

### 2026-03-20

- Added `generationSrcSnapshot` handling in `content.js`
- Added generation polling while in `WAITING_NEXT_READY`
- Allowed direct recovery to `PLAYING_CURRENT` when Suno auto-plays the newly generated track
- Extended FSM transitions in `state-machine.js` for autoplay-based loop continuation
- Added experimental selector candidates for future instrumental-mode detection in `selectors.js`

## Known Risks

- `PLAY_BUTTON_CANDIDATES` are still not verified against live DOM
- `CREATE_BUTTON_CANDIDATES` still rely on generic button matching and text heuristics
- `CARD_CANDIDATES` and now-playing title extraction are still weak
- Generation completion fallback uses broad loading/progress class matching and may be noisy
- README had fallen behind the implementation and needed to be brought back in sync

## Working Tree Notes

Observed local modifications before this update:

- `content.js`
- `selectors.js`
- `state-machine.js`
- `claude.md`

The main code change theme is nonstop loop reliability after `Create`, especially when Suno starts the new song automatically instead of requiring an explicit playback switch.

## What Still Needs Live Verification

- Exact Create button selector on current Suno UI
- Exact Play button selector for the newest generated card
- Current track title selector in the player area
- Card/list selector on library or queue views
- Whether instrumental mode needs dedicated handling before prompt filling
- Whether `WAITING_NEXT_READY` should also watch for a stronger generation-complete signal than class-based loading checks

## Next Practical Steps

1. Load the unpacked extension and validate `dry-run` on a real Suno session.
2. Use `window.__sunoDJ.debugDump()` and `devtools-snippets.js` to confirm Create and Play selectors.
3. Tighten `selectors.js` so fewer operations depend on generic `button` matching.
4. Re-run the full loop in `manual-create`, then `auto-create`.
5. If autoplay behavior differs by page, split selectors or switching logic by page context.
