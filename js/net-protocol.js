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
        const hasPlace = isCell(raw.place);
        if (!hasPlace && raw.place != null) return null;

        let fix = null;
        const items = figureList(raw.fix);
        /* За ход нельзя закрыть больше нескольких фигур; ограничение также
           не даёт завалить реплей длинным списком от злоумышленника. */
        if (items.length > 6) return null;
        if (items.length) {
            fix = [];
            for (const item of items) {
                const cells = figureCellsOf(item);
                if (!cells) return null;
                fix.push(cells);
            }
        }
        /* Без закрашенной клетки отправляется только победная фигура. */
        if (!hasPlace && !fix) return null;

        return { place: hasPlace ? [raw.place[0], raw.place[1]] : null, fix };
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
            owners: [...(snapshot.owners || [])].slice()
                .sort((a, b) => String(a[0]).localeCompare(String(b[0])) ||
                                 String(a[1]).localeCompare(String(b[1]))),
            current: snapshot.current,
            over: !!snapshot.over,
            winner: snapshot.winner || null,
            figures: (snapshot.figures || [])
                .map(f => ({ owner: f.owner, cells: [...(f.cells || [])].sort() }))
                .sort((a, b) => (a.owner + ':' + a.cells.join('|')).localeCompare(b.owner + ':' + b.cells.join('|')))
        });
    }

    /* Собирает ход: закрашенная клетка плюс все фигуры, закрытые в этом ходу. */
    function moveFromGame(game) {
        if (!game) return null;
        const figures = (game.turnFigures || []).map(figure => figure.cells.map(parseKey));
        if (game.selected && (game.selected.length === 4 || game.selected.length === 6)) {
            figures.push(game.selected.map(parseKey));
        }
        /* Победная фигура может быть закрыта до закрашивания клетки. */
        if (!game.pending && !(game.over && figures.length)) return null;
        return {
            place: game.pending ? game.pending.slice() : null,
            fix: figures.length ? figures : null
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
