'use strict';

/* ============================================================
   TOOF — игровое ядро.
   Чистая логика без DOM: поле, фигуры, секторы, ходы.
   ============================================================ */

const EMPTY = '';
const SIDE_X = 'X';
const SIDE_O = 'O';

const key = (r, c) => r + ',' + c;
const parseKey = k => {
    const i = k.indexOf(',');
    return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

/* ---------- Геометрия фигур ---------- */

const SHAPES = {
    cornerCenter: [[-1, 0], [0, -1], [0, 0], [0, 1], [1, -1], [1, 1]],
    cornerEdge: [[-1, -1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 1]],
    diagA: [[-1, -1], [-1, 1], [0, 0], [0, 2], [1, -1], [2, 0]],
    diagB: [[-1, 1], [0, -2], [0, 0], [0, 2], [1, -1], [2, 0]]
};

/* Смешанные фигуры: три «угловые» клетки принадлежат объявившему. */
const MIXED_SHAPES = [
    { shape: 'cornerCenter', owners: [0, 4, 5] },
    { shape: 'diagA', owners: [0, 3, 5] }
];

/* Все повороты (0/90/180/270) и зеркальные отражения, без дублей. */
function buildOrientations(points) {
    const seen = new Set();
    const result = [];
    let current = points.map(p => [p[0], p[1]]);

    for (let turn = 0; turn < 4; turn++) {
        for (const variant of [current, current.map(([x, y]) => [x, -y])]) {
            const id = variant.map(([x, y]) => x + ':' + y).sort().join('|');
            if (seen.has(id)) continue;
            seen.add(id);
            result.push(variant);
        }
        current = current.map(([x, y]) => [y, -x]);
    }
    return result;
}

const ORIENTATIONS = {};
for (const name of Object.keys(SHAPES)) ORIENTATIONS[name] = buildOrientations(SHAPES[name]);

/* ---------- Проверка фигур ---------- */

function isLine4(keys, board, locked) {
    const cells = keys.map(parseKey);
    const symbol = board[cells[0][0]][cells[0][1]];
    if (symbol !== SIDE_X && symbol !== SIDE_O) return null;

    for (const [r, c] of cells) {
        if (board[r][c] !== symbol || locked.has(key(r, c))) return null;
    }

    const rows = new Set(cells.map(p => p[0]));
    const cols = new Set(cells.map(p => p[1]));

    if (rows.size === 1) {
        const values = cells.map(p => p[1]).sort((a, b) => a - b);
        for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1] + 1) return null;
        return symbol;
    }
    if (cols.size === 1) {
        const values = cells.map(p => p[0]).sort((a, b) => a - b);
        for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1] + 1) return null;
        return symbol;
    }
    if (rows.size === 4 && cols.size === 4) {
        const sorted = cells.slice().sort((a, b) => a[0] - b[0]);
        const dr = sorted[1][0] - sorted[0][0];
        const dc = sorted[1][1] - sorted[0][1];
        if (Math.abs(dr) !== 1 || Math.abs(dc) !== 1) return null;
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i][0] !== sorted[i - 1][0] + dr) return null;
            if (sorted[i][1] !== sorted[i - 1][1] + dc) return null;
        }
        return symbol;
    }
    return null;
}

function matchesShape(set, anchor, orientation, test) {
    const cells = [];
    for (const [dr, dc] of orientation) {
        const r = anchor[0] + dr;
        const c = anchor[1] + dc;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
        const k = key(r, c);
        if (!set.has(k)) return false;
        cells.push(k);
    }
    if (cells.length !== set.size) return false;
    return test(cells);
}

function matchesAny(shapeName, set, player, board, locked, mixed) {
    const other = player === SIDE_X ? SIDE_O : SIDE_X;

    for (const anchor of [...set].map(parseKey)) {
        for (const orientation of ORIENTATIONS[shapeName]) {
            const ok = matchesShape(set, anchor, orientation, cells => {
                for (let i = 0; i < cells.length; i++) {
                    const [r, c] = parseKey(cells[i]);
                    if (locked.has(cells[i])) return false;
                    const expected = mixed
                        ? (MIXED_SHAPES.find(m => m.shape === shapeName).owners.includes(i) ? player : other)
                        : player;
                    if (board[r][c] !== expected) return false;
                }
                return true;
            });
            if (ok) return true;
        }
    }
    return false;
}

/*
   Возвращает 'X' | 'O' | null — кому принадлежит фигура из этих клеток.
   keys: массив строк "r,c", 4 или 6 штук.
*/
function figureOwner(keys, board, locked) {
    if (!Array.isArray(keys)) return null;
    if (keys.length !== 4 && keys.length !== 6) return null;
    if (new Set(keys).size !== keys.length) return null;

    const set = new Set(keys);
    for (const k of keys) {
        const [r, c] = parseKey(k);
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
        if (locked.has(k)) return null;
    }

    if (keys.length === 4) {
        return isLine4(keys, board, locked);
    }

    for (const player of [SIDE_X, SIDE_O]) {
        for (const name of Object.keys(SHAPES)) {
            if (matchesAny(name, set, player, board, locked, false)) return player;
        }
        for (const mixed of MIXED_SHAPES) {
            if (matchesAny(mixed.shape, set, player, board, locked, true)) return player;
        }
    }
    return null;
}

/* ---------- Состояние партии ---------- */

function makeGame() {
    return {
    board: [],
    locked: new Set(),
    owners: new Map(),
    current: SIDE_X,
    over: false,
    winner: null,
    selected: [],
    pending: null,

    reset() {
        this.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
        this.locked.clear();
        this.owners.clear();
        this.current = SIDE_X;
        this.over = false;
        this.winner = null;
        this.selected = [];
        this.pending = null;
    },

    /* Снимок только «долговечного» состояния: без pending/selected. */
    snapshot() {
        return {
            board: this.board.map(row => row.slice()),
            locked: [...this.locked],
            owners: [...this.owners],
            current: this.current,
            over: this.over,
            winner: this.winner
        };
    },

    restore(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.board)) return false;
        this.board = snapshot.board.map(row => row.slice());
        this.locked = new Set(snapshot.locked || []);
        this.owners = new Map(snapshot.owners || []);
        this.current = snapshot.current === SIDE_O ? SIDE_O : SIDE_X;
        this.over = !!snapshot.over;
        this.winner = snapshot.winner || null;
        this.selected = [];
        this.pending = null;
        return true;
    },

    /* Применить сетевой ход { place:[r,c], fix:[[r,c],...]|null }.
       Вызывать только на чистом состоянии: pending/selected должны быть пусты. */
    applyMove(move) {
        if (this.over) return { ok: false, reason: 'over' };
        if (!move || !Array.isArray(move.place) || move.place.length !== 2) {
            return { ok: false, reason: 'place' };
        }
        if (!this.place(move.place[0], move.place[1])) {
            return { ok: false, reason: 'place' };
        }

        if (move.fix && move.fix.length) {
            if (move.fix.length !== 4 && move.fix.length !== 6) {
                return { ok: false, reason: 'size' };
            }
            for (const cell of move.fix) {
                if (!Array.isArray(cell) || !this.toggle(cell[0], cell[1])) {
                    return { ok: false, reason: 'fix' };
                }
            }
            const result = this.fix();
            if (!result.ok) return result;
            return Object.assign({}, result, { draw: this.checkDraw() });
        }

        if (!this.confirm()) return { ok: false, reason: 'confirm' };
        return { ok: true, reason: null, draw: this.checkDraw() };
    },

    at(r, c) { return this.board[r][c]; },
    isLocked(r, c) { return this.locked.has(key(r, c)); },
    isSelected(r, c) { return this.selected.indexOf(key(r, c)) !== -1; },

    sectorIndex(r, c) {
        return (r < SECTOR_SIZE ? 0 : 2) + (c < SECTOR_SIZE ? 0 : 1);
    },

    sectorsOf(player) {
        const result = new Set();
        for (const [k, owner] of this.owners) {
            if (owner !== player) continue;
            const [r, c] = parseKey(k);
            result.add(this.sectorIndex(r, c));
        }
        return result;
    },

    hasMoves() {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c] === EMPTY && !this.isLocked(r, c)) return true;
            }
        }
        return false;
    },

    /* Закрасить клетку цветом текущего игрока (или перенести уже закрашенную). */
    place(r, c) {
        if (this.over) return false;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
        if (this.board[r][c] !== EMPTY || this.isLocked(r, c)) return false;

        if (this.pending) {
            const [pr, pc] = this.pending;
            this.board[pr][pc] = EMPTY;
            this.pending = null;
            this.selected = [];
        }

        this.board[r][c] = this.current;
        this.pending = [r, c];
        return true;
    },

    /* Добавить/убрать клетку из выделения. Только после закрашивания. */
    toggle(r, c) {
        if (this.over || !this.pending) return false;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
        if (this.board[r][c] === EMPTY || this.isLocked(r, c)) return false;

        const k = key(r, c);
        const index = this.selected.indexOf(k);
        if (index !== -1) {
            this.selected.splice(index, 1);
            return true;
        }
        if (this.selected.length >= MAX_FIGURE) return false;
        this.selected.push(k);
        return true;
    },

    clearSelection() { this.selected = []; },

    /* Зафиксировать выделенную фигуру. Возвращает {ok, reason?, declarer?, winner?}. */
    fix() {
        if (this.over) return { ok: false, reason: 'over' };
        if (!this.pending) return { ok: false, reason: 'no-move' };
        if (this.selected.length !== 4 && this.selected.length !== 6) {
            return { ok: false, reason: 'size' };
        }

        const declarer = figureOwner(this.selected, this.board, this.locked);
        if (!declarer) return { ok: false, reason: 'not-a-figure' };

        for (const k of this.selected) {
            this.locked.add(k);
            this.owners.set(k, declarer);
        }
        this.pending = null;
        this.selected = [];

        const winner = this.checkVictory(declarer);
        if (!winner) this.next();
        return { ok: true, declarer, winner };
    },

    /* Подтвердить ход без фиксации. */
    confirm() {
        if (this.over || !this.pending) return false;
        this.pending = null;
        this.selected = [];
        this.next();
        return true;
    },

    next() {
        this.current = this.current === SIDE_X ? SIDE_O : SIDE_X;
        this.selected = [];
    },

    /* Победа объявившего фигуру имеет приоритет при одновременном захвате. */
    checkVictory(declarer) {
        if (this.sectorsOf(declarer).size >= SECTORS_TO_WIN) {
            this.over = true;
            this.winner = declarer;
            return declarer;
        }
        const other = declarer === SIDE_X ? SIDE_O : SIDE_X;
        if (this.sectorsOf(other).size >= SECTORS_TO_WIN) {
            this.over = true;
            this.winner = other;
            return other;
        }
        return null;
    },

    checkDraw() {
        if (this.over || this.hasMoves()) return false;
        this.over = true;
        this.winner = null;
        return true;
    }
    };
}

const Game = makeGame();
Game.reset();
