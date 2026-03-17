/**
 * @file state-machine.js
 * @description Finite state machine for Suno Nonstop DJ.
 *
 * Every state transition is logged. Invalid transitions are rejected
 * with an error log but do NOT throw — the system degrades gracefully.
 */

/* ========================================================================
 * TRANSITION TABLE
 * Keys   = current state
 * Values = Set of allowed next states
 * ======================================================================== */

const TRANSITIONS = Object.freeze({
    [STATE.IDLE]: new Set([
        STATE.WAITING_AUDIO,
        STATE.STOPPED,
    ]),
    [STATE.WAITING_AUDIO]: new Set([
        STATE.PLAYING_CURRENT,
        STATE.IDLE,
        STATE.ERROR,
        STATE.STOPPED,
    ]),
    [STATE.PLAYING_CURRENT]: new Set([
        STATE.THRESHOLD_REACHED,
        STATE.WAITING_AUDIO,   // audio element lost → re-search
        STATE.IDLE,
        STATE.ERROR,
        STATE.STOPPED,
    ]),
    [STATE.THRESHOLD_REACHED]: new Set([
        STATE.EXTRACTING_CONTEXT,
        STATE.PLAYING_CURRENT, // threshold un-reached (e.g. seek)
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.EXTRACTING_CONTEXT]: new Set([
        STATE.COMPOSING_NEXT_PROMPT,
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.COMPOSING_NEXT_PROMPT]: new Set([
        STATE.TRIGGERING_GENERATION,
        STATE.ARMED_FOR_SWITCH, // manual-create skips trigger
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.TRIGGERING_GENERATION]: new Set([
        STATE.WAITING_NEXT_READY,
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.WAITING_NEXT_READY]: new Set([
        STATE.ARMED_FOR_SWITCH,
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.ARMED_FOR_SWITCH]: new Set([
        STATE.SWITCHING_PLAYBACK,
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.SWITCHING_PLAYBACK]: new Set([
        STATE.PLAYING_CURRENT,
        STATE.ERROR,
        STATE.IDLE,
        STATE.STOPPED,
    ]),
    [STATE.ERROR]: new Set([
        STATE.IDLE,
        STATE.STOPPED,
        STATE.WAITING_AUDIO,
    ]),
    [STATE.STOPPED]: new Set([
        STATE.IDLE,
    ]),
});

/* ========================================================================
 * StateMachine Class
 * ======================================================================== */

class StateMachine {
    /**
     * @param {function(string): void} [onTransition] - callback(newState)
     */
    constructor(onTransition) {
        /** @type {string} */
        this._state = STATE.IDLE;
        /** @type {function(string): void|null} */
        this._onTransition = onTransition || null;
        /** @type {Array<{from: string, to: string, ts: number, reason: string}>} */
        this._history = [];
    }

    /** @returns {string} current state */
    get current() {
        return this._state;
    }

    /** @returns {Array} transition history */
    get history() {
        return this._history;
    }

    /**
     * Attempt a state transition.
     * @param {string} nextState - target state
     * @param {string} [reason=''] - human-readable reason for the transition
     * @returns {boolean} true if transition succeeded
     */
    transition(nextState, reason = '') {
        const allowed = TRANSITIONS[this._state];

        if (!allowed || !allowed.has(nextState)) {
            console.warn(
                `${LOG_PREFIX} ⛔ Invalid transition: ${this._state} → ${nextState}` +
                (reason ? ` (reason: ${reason})` : '')
            );
            return false;
        }

        const prev = this._state;
        this._state = nextState;

        const entry = {
            from: prev,
            to: nextState,
            ts: Date.now(),
            reason,
        };
        this._history.push(entry);

        // Keep history bounded
        if (this._history.length > MAX_LOG_ENTRIES) {
            this._history.shift();
        }

        console.log(
            `${LOG_PREFIX} 🔄 ${prev} → ${nextState}` +
            (reason ? ` | ${reason}` : '')
        );

        if (this._onTransition) {
            try {
                this._onTransition(nextState);
            } catch (err) {
                console.error(`${LOG_PREFIX} onTransition callback error:`, err);
            }
        }

        return true;
    }

    /**
     * Force-reset to IDLE (e.g. after unrecoverable error).
     * This bypasses transition validation.
     * @param {string} [reason='force reset']
     */
    forceReset(reason = 'force reset') {
        const prev = this._state;
        this._state = STATE.IDLE;
        this._history.push({ from: prev, to: STATE.IDLE, ts: Date.now(), reason });
        console.warn(`${LOG_PREFIX} ⚠️ Force reset: ${prev} → IDLE | ${reason}`);
    }

    /**
     * Check whether a transition to the given state would be valid.
     * @param {string} nextState
     * @returns {boolean}
     */
    canTransition(nextState) {
        const allowed = TRANSITIONS[this._state];
        return allowed ? allowed.has(nextState) : false;
    }

    /**
     * Serialise for storage / messaging.
     * @returns {{state: string, historyLength: number, lastTransition: Object|null}}
     */
    toJSON() {
        return {
            state: this._state,
            historyLength: this._history.length,
            lastTransition: this._history.length > 0
                ? this._history[this._history.length - 1]
                : null,
        };
    }
}
