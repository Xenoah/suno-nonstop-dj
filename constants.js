/**
 * @file constants.js
 * @description Shared constants for Suno Nonstop DJ extension.
 * All magic values are centralised here for easy tuning.
 */

/* ========================================================================
 * LOG PREFIX — Every console message from this extension starts with this
 * ======================================================================== */

/** @constant {string} */
const LOG_PREFIX = '[SunoDJ]';

/* ========================================================================
 * STATE NAMES — Finite state machine identifiers
 * ======================================================================== */

/** @enum {string} */
const STATE = Object.freeze({
  IDLE:                 'IDLE',
  WAITING_AUDIO:        'WAITING_AUDIO',
  PLAYING_CURRENT:      'PLAYING_CURRENT',
  THRESHOLD_REACHED:    'THRESHOLD_REACHED',
  EXTRACTING_CONTEXT:   'EXTRACTING_CONTEXT',
  COMPOSING_NEXT_PROMPT:'COMPOSING_NEXT_PROMPT',
  TRIGGERING_GENERATION:'TRIGGERING_GENERATION',
  WAITING_NEXT_READY:   'WAITING_NEXT_READY',
  ARMED_FOR_SWITCH:     'ARMED_FOR_SWITCH',
  SWITCHING_PLAYBACK:   'SWITCHING_PLAYBACK',
  ERROR:                'ERROR',
  STOPPED:              'STOPPED',
});

/* ========================================================================
 * AUTOMATION MODES
 * ======================================================================== */

/** @enum {string} */
const MODE = Object.freeze({
  DRY_RUN:       'dry-run',         // No DOM mutations — log only
  MANUAL_CREATE: 'manual-create',   // Fill prompt but don't click Create
  AUTO_CREATE:   'auto-create',     // Full automation
});

/* ========================================================================
 * PROMPT STRATEGIES
 * ======================================================================== */

/** @enum {string} */
const STRATEGY = Object.freeze({
  CONSERVATIVE: 'conservative',
  BALANCED:     'balanced',
  ADVENTUROUS:  'adventurous',
});

/* ========================================================================
 * DEFAULT SETTINGS — stored in chrome.storage.local
 * ======================================================================== */

/** @constant {Object} */
const DEFAULT_SETTINGS = Object.freeze({
  /** Remaining seconds to trigger next-track generation */
  thresholdSeconds: 120,
  /** Automation mode */
  mode: MODE.DRY_RUN,
  /** Prompt strategy */
  strategy: STRATEGY.BALANCED,
  /** Maximum consecutive errors before auto-stop */
  maxConsecutiveErrors: 5,
  /** Maximum retries for playback switch */
  maxPlaybackRetries: 3,
  /** Interval (ms) for polling fallback when MutationObserver misses */
  pollingIntervalMs: 5000,
  /** Audio element polling interval (ms) when element not yet found */
  audioPollingIntervalMs: 1000,
  /** Whether automation is active */
  automationActive: false,
});

/* ========================================================================
 * AUDIO ELEMENT
 * ======================================================================== */

/** @constant {string} ID of the primary audio element on Suno */
const AUDIO_ELEMENT_ID = 'active-audio-play';

/** @constant {string} ID of the silent audio element (to be IGNORED) */
const SILENT_AUDIO_ID = 'silent-audio';

/* ========================================================================
 * MESSAGE TYPES — chrome.runtime messaging between content ↔ popup ↔ SW
 * ======================================================================== */

/** @enum {string} */
const MSG = Object.freeze({
  // Popup → Content / SW
  START_AUTOMATION:   'START_AUTOMATION',
  STOP_AUTOMATION:    'STOP_AUTOMATION',
  GET_STATUS:         'GET_STATUS',
  UPDATE_SETTINGS:    'UPDATE_SETTINGS',
  GET_SETTINGS:       'GET_SETTINGS',
  RUN_DEBUG_DUMP:     'RUN_DEBUG_DUMP',

  // Content → SW / Popup
  STATUS_UPDATE:      'STATUS_UPDATE',
  LOG_ENTRY:          'LOG_ENTRY',
  SETTINGS_CHANGED:   'SETTINGS_CHANGED',
  DEBUG_DUMP_RESULT:  'DEBUG_DUMP_RESULT',
});

/* ========================================================================
 * TIMING CONSTANTS
 * ======================================================================== */

/** @constant {number} Debounce ms for timeupdate handler */
const TIMEUPDATE_DEBOUNCE_MS = 500;

/** @constant {number} Max log entries kept in memory */
const MAX_LOG_ENTRIES = 200;
