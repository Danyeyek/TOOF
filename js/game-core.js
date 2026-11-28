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

/* Восстановление групп клеток для старых снимков без списка figures. */
function groupsFromOwners(locked, owners) {
    const lockedSet = new Set(locked);
    const ownerMap = new Map(owners);
    const seen = new Set();
    const groups = [];
    for (const start of lockedSet) {
        if (seen.has(start)) continue;
        const owner = ownerMap.get(start);
        const stack = [start];
        const cells = [];
        seen.add(start);
        while (stack.length) {
            const k = stack.pop();
            const [r, c] = parseKey(k);
            cells.push(k);
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                const nk = key(nr, nc);
                if (!lockedSet.has(nk) || ownerMap.get(nk) !== owner || seen.has(nk)) continue;
                seen.add(nk);
                stack.push(nk);
            }
        }
        if (cells.length) groups.push({ owner, cells });
    }
    return groups;
}

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

/* Ход может зафиксировать несколько фигур. Старый формат — одна фигура
   плоским списком клеток; новый — список таких списков. */
function figureList(value) {
    if (!Array.isArray(value) || !value.length) return [];
    if (Array.isArray(value[0]) && Array.isArray(value[0][0])) return value;
    return [value];
}

/* Приводит одну фигуру хода к списку координат. */
function figureCellsOf(item) {
    if (!Array.isArray(item)) return null;
    const cells = [];
    const seen = new Set();
    for (const cell of item) {
        if (!Array.isArray(cell) || cell.length !== 2) return null;
        const r = cell[0], c = cell[1];
        if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
        const k = key(r, c);
        if (seen.has(k)) return null;
        seen.add(k);
        cells.push([r, c]);
    }
    return cells;
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
    figures: [],
    turnFigures: [],

    /* firstSide — сторона, которая делает первый ход; по умолчанию X.
       Сторона игрока в бот-режиме задаётся цветом и может не совпадать с ней. */
    reset(firstSide) {
        this.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
        this.locked.clear();
        this.owners.clear();
        this.current = firstSide === SIDE_O ? SIDE_O : SIDE_X;
        this.over = false;
        this.winner = null;
        this.selected = [];
        this.pending = null;
        this.figures = [];
        this.turnFigures = [];
    },

    /* Снимок только «долговечного» состояния: без pending/selected. */
    snapshot() {
        return {
            board: this.board.map(row => row.slice()),
            locked: [...this.locked],
            owners: [...this.owners],
            current: this.current,
            over: this.over,
            winner: this.winner,
            figures: this.figures.map(f => ({ owner: f.owner, cells: f.cells.slice() }))
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
        this.figures = Array.isArray(snapshot.figures)
            ? snapshot.figures.map(f => ({ owner: f.owner, cells: (f.cells || []).slice() }))
            : groupsFromOwners(snapshot.locked || [], snapshot.owners || []);
        this.selected = [];
        this.pending = null;
        this.turnFigures = [];
        return true;
    },

    /* Применить сетевой ход { place:[r,c]|null, fix:[[[r,c],...], ...]|null }.
       place может быть null только у победной фигуры, закрытой до закрашивания.
       Старый формат с одной фигурой тоже понимается. Вызывать только на
       чистом состоянии: pending/selected должны быть пусты. */
    applyMove(move) {
        if (this.over) return { ok: false, reason: 'over' };
        if (!move) return { ok: false, reason: 'place' };

        const hasPlace = Array.isArray(move.place) && move.place.length === 2;
        const figures = figureList(move.fix);
        if (!hasPlace && !figures.length) return { ok: false, reason: 'place' };
        if (hasPlace && !this.place(move.place[0], move.place[1])) {
            return { ok: false, reason: 'place' };
        }

        const declarers = [];
        for (const item of figures) {
            const cells = figureCellsOf(item);
            if (!cells) return { ok: false, reason: 'fix' };
            if (cells.length !== 4 && cells.length !== 6) {
                return { ok: false, reason: 'size' };
            }
            for (const [r, c] of cells) {
                if (!this.toggle(r, c)) return { ok: false, reason: 'fix' };
            }
            const result = this.fix();
            if (!result.ok) return { ok: false, reason: result.reason };
            declarers.push(result.declarer);

            /* Победа фиксируется сразу, без закрашивания и подтверждения. */
            if (this.over) {
                this.pending = null;
                this.turnFigures = [];
                return {
                    ok: true,
                    reason: null,
                    declarer: result.declarer,
                    declarers,
                    winner: this.winner,
                    draw: false
                };
            }
        }

        /* Ход без закрашенной клетки возможен только победной фигурой. */
        if (!hasPlace) return { ok: false, reason: 'confirm' };

        const result = this.confirm();
        if (!result.ok) return { ok: false, reason: 'confirm' };
        return {
            ok: true,
            reason: null,
            declarer: declarers[declarers.length - 1] || null,
            declarers,
            winner: result.winner,
            draw: result.draw
        };
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

    /* Закрасить клетку цветом текущего игрока (или перенести уже закрашенную).
       За один ход красится ровно одна клетка: второй вызов переносит её,
       а если она уже вошла в фигуру — просто не допускается. */
    place(r, c) {
        if (this.over) return false;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
        if (this.board[r][c] !== EMPTY || this.isLocked(r, c)) return false;

        if (this.pending) {
            const [pr, pc] = this.pending;
            if (this.isLocked(pr, pc)) return false;
            this.board[pr][pc] = EMPTY;
            const pk = key(pr, pc);
            const at = this.selected.indexOf(pk);
            if (at !== -1) this.selected.splice(at, 1);
            this.pending = null;
        }

        this.board[r][c] = this.current;
        this.pending = [r, c];
        return true;
    },

    /* Добавить/убрать клетку из выделения. Не зависит от закрашивания:
       фигуру можно выбрать и до хода, и после него. */
    toggle(r, c) {
        if (this.over) return false;
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

    /* Зафиксировать выделенную фигуру. Ход НЕ переходит: его ещё нужно
       завершить кнопкой после закрашивания клетки. За ход можно зафиксировать
       несколько фигур — в том числе до закрашивания. */
    fix() {
        if (this.over) return { ok: false, reason: 'over' };
        if (this.selected.length !== 4 && this.selected.length !== 6) {
            return { ok: false, reason: 'size' };
        }

        const declarer = figureOwner(this.selected, this.board, this.locked);
        if (!declarer) return { ok: false, reason: 'not-a-figure' };

        const cells = this.selected.slice();
        for (const k of cells) {
            this.locked.add(k);
            this.owners.set(k, declarer);
        }
        this.figures.push({ owner: declarer, cells });
        this.turnFigures.push({ owner: declarer, cells });
        this.selected = [];

        /* Победная фигура завершает партию сразу, даже если клетка ещё
           не закрашена — ждать подтверждения хода не нужно. */
        const winner = this.checkVictory(declarer);
        if (winner) {
            this.pending = null;
            return { ok: true, declarer, winner };
        }
        return { ok: true, declarer };
    },

    /* Полное выделение при завершении хода фиксируется; неполное снимается. */
    settleSelection() {
        if (!this.selected.length) return null;
        const result = this.fix();
        if (!result.ok) this.clearSelection();
        return result;
    },

    /* Завершить ход. Переход хода возможен только после закрашивания клетки. */
    confirm() {
        if (this.over) return { ok: false, reason: 'over' };
        if (!this.pending) return { ok: false, reason: 'no-move' };
        const settled = this.settleSelection();
        if (this.over) {
            this.pending = null;
            this.turnFigures = [];
            this.selected = [];
            return {
                ok: true,
                winner: this.winner,
                draw: false,
                fixed: settled && settled.ok ? [settled.declarer] : []
            };
        }
        const winner = this.checkVictory(this.current);
        const draw = !winner && this.checkDraw();
        this.pending = null;
        this.turnFigures = [];
        this.selected = [];
        if (!winner && !draw) this.next();
        return { ok: true, winner, draw, fixed: settled && settled.ok ? [settled.declarer] : [] };
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
