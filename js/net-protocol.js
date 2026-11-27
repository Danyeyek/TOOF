'use strict';

/* ============================================================
   TOOF — сетевой протокол.
   Ход = { place:[r,c], fix:[[r,c],...]|null }.
   Всё, что нужно для сети: снимок, проверка/применение хода, реплей.
   ============================================================ */

const NetProtocol = (() => {
    const OTHER = { X: 'O', O: 'X' };

    function otherSide(side) {
        return OTHER[side] || null;
    }

    function initialSnapshot() {
        const game = makeGame();
        game.reset();
        return game.snapshot();
    }

    function isCell(value) {
        return Array.isArray(value) &&
            value.length === 2 &&
            Number.isInteger(value[0]) &&
            Number.isInteger(value[1]) &&
            value[0] >= 0 && value[0] < BOARD_SIZE &&
            value[1] >= 0 && value[1] < BOARD_SIZE;
    }

    /* Приводит ход с провода к строгому виду. Возвращает null, если структура битая. */
    function normalizeMove(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (!isCell(raw.place)) return null;

        let fix = raw.fix;
        if (fix === undefined || fix === null) {
            fix = null;
        } else {
            if (!Array.isArray(fix)) return null;
            if (fix.length === 0) {
                fix = null;
            } else {
                const seen = new Set();
                const normalized = [];
                for (const cell of fix) {
                    if (!isCell(cell)) return null;
                    const id = cell[0] + ',' + cell[1];
                    if (seen.has(id)) return null;
                    seen.add(id);
                    normalized.push([cell[0], cell[1]]);
                }
                fix = normalized;
            }
        }

        return { place: [raw.place[0], raw.place[1]], fix };
    }

    /* Чистый редьюсер: не трогает глобальный Game. */
    function reduce(snapshot, side, rawMove) {
        const move = normalizeMove(rawMove);
        if (!move) return { ok: false, reason: 'shape', snapshot };

        const game = makeGame();
        if (!game.restore(snapshot)) return { ok: false, reason: 'snapshot', snapshot };
        if (game.over) return { ok: false, reason: 'over', snapshot };
        if (game.current !== side) return { ok: false, reason: 'turn', snapshot };

        const result = game.applyMove(move);
        if (!result.ok) {
            return { ok: false, reason: result.reason || 'move', snapshot };
        }

        return {
            ok: true,
            snapshot: game.snapshot(),
            winner: game.winner,
            declarer: result.declarer || null
        };
    }

    /* moves: [{ side, move }] или [{ side, place, fix }] */
    function replay(initial, moves) {
        let snapshot = initial || initialSnapshot();
        let winner = null;
        const list = Array.isArray(moves) ? moves : [];

        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const side = item.side;
            const move = item.move || item;
            const result = reduce(snapshot, side, move);
            if (!result.ok) {
                return { ok: false, reason: result.reason, at: i, snapshot, winner };
            }
            snapshot = result.snapshot;
            winner = result.winner;
        }

        return { ok: true, snapshot, winner, applied: list.length };
    }

    function stateHash(snapshot) {
        if (!snapshot) return '';
        return JSON.stringify({
            board: snapshot.board,
            locked: [...(snapshot.locked || [])].sort(),
            owners: [...(snapshot.owners || [])].slice().sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
            current: snapshot.current,
            over: !!snapshot.over,
            winner: snapshot.winner || null
        });
    }

    /* Собирает ход из текущего локального выбора (pending + selected). */
    function moveFromGame(game) {
        if (!game || !game.pending) return null;
        return {
            place: game.pending.slice(),
            fix: game.selected.length ? game.selected.map(cell => parseKey(cell)) : null
        };
    }

    return {
        otherSide,
        initialSnapshot,
        normalizeMove,
        reduce,
        replay,
        stateHash,
        moveFromGame
    };
})();
