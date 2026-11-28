'use strict';

/* ============================================================
   Бот TOOF — ядро «до уровней сложности», собранное по BOT_SPEC.md.

   Сила бота — в каскаде мгновенных тактических приоритетов:
   победа → достройка победы → блок → своя фигура → своя достройка → поиск.
   Поиск работает только финальным арбитром.

   Уровни сложности ограничивают лишь число рассматриваемых кандидатов
   и глубину поиска: бот всегда берёт лучший из рассмотренных ходов.
   Никаких ранговых лотерей, шансов пропустить блок, шпаргалок с штрафами
   и принудительных фильтров «только блокировщики» — всё это заставляло
   бота только блокировать и перестать строить свои фигуры.
   ============================================================ */

const OTHER_OF = { X: 'O', O: 'X' };
const SECTOR_OF = (r, c) => (r < SECTOR_SIZE ? 0 : 2) + (c < SECTOR_SIZE ? 0 : 1);

/* Сколько разных секторов задевает фигура. */
function sectorSpan(cells) {
    const sectors = new Set();
    for (const [r, c] of cells) sectors.add(SECTOR_OF(r, c));
    return sectors.size;
}

/* Настройки задают только объём перебора, а не качество выбора.
   По умолчанию — полное ядро «Непобедимого»; load()/applyLevel() могут
   сузить перебор для остальных уровней. */
const PROFILE = {
    searchDepth: 3,
    rootMoves: 14,
    limits: [10, 6, 4],
    attention: 1,
    winAttention: 1
};

/* Детерминированный хэш: одна и та же позиция даёт одни и те же «пропуски»,
   поэтому бенчмарки воспроизводимы и не зависят от Math.random. */
function hashOf(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function boardSignature(board) {
    let text = '';
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] !== EMPTY) text += key(r, c) + board[r][c] + ';';
        }
    }
    return hashOf(text);
}

/* ---------- Шаблоны фигур ---------- */

const TEMPLATES = [];

function addTemplate(cells, owners, mixed) {
    const rows = cells.map(p => p[0]);
    const cols = cells.map(p => p[1]);
    TEMPLATES.push({
        cells,
        owners,
        mixed: !!mixed,
        minR: -Math.min.apply(null, rows),
        maxR: BOARD_SIZE - 1 - Math.max.apply(null, rows),
        minC: -Math.min.apply(null, cols),
        maxC: BOARD_SIZE - 1 - Math.max.apply(null, cols)
    });
}

/* Линия: все повороты и две диагонали. */
for (const orientation of buildOrientations([[0, 0], [0, 1], [0, 2], [0, 3]])) {
    addTemplate(orientation, ['me', 'me', 'me', 'me'], false);
}
addTemplate([[0, 0], [1, 1], [2, 2], [3, 3]], ['me', 'me', 'me', 'me'], false);
addTemplate([[0, 0], [1, -1], [2, -2], [3, -3]], ['me', 'me', 'me', 'me'], false);

/* Остальные фигуры: чистая версия и версия со смешанными владельцами. */
for (const name of Object.keys(SHAPES)) {
    const mixed = MIXED_SHAPES.find(m => m.shape === name);
    for (const orientation of ORIENTATIONS[name]) {
        addTemplate(orientation, orientation.map(() => 'me'), false);
        if (mixed) {
            addTemplate(orientation,
                orientation.map((p, i) => mixed.owners.includes(i) ? 'me' : 'other'), true);
        }
    }
}

/* Статическая карта «через клетку доступно максимум N секторов».
   Геометрия шаблонов не зависит от партии, поэтому считается один раз. */
const CELL_SPAN = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));

(function buildCellSpan() {
    for (const tpl of TEMPLATES) {
        for (let ar = tpl.minR; ar <= tpl.maxR; ar++) {
            for (let ac = tpl.minC; ac <= tpl.maxC; ac++) {
                const cells = tpl.cells.map(([dr, dc]) => [ar + dr, ac + dc]);
                const span = sectorSpan(cells);
                for (const [r, c] of cells) CELL_SPAN[r][c] = Math.max(CELL_SPAN[r][c], span);
            }
        }
    }
})();

/* ---------- «Скоба» — общее основание машины и стула ----------
   Машина, стул и зеркальный стул отличаются только верхней клеткой
   над одним и тем же основанием из пяти клеток. Если основание тянется
   на три сектора, любая из трёх верхних клеток даёт мгновенную победу,
   а перекрыть все три за один ход невозможно. Поэтому бот уровня
   «Невыносимый» не даёт построить само основание. */

/* Два основания: прямое (машина/стул) и диагональное
   (диагональные фигуры). У каждого по три варианта завершения. */
const BRACKET_BASES = [
    [[0, -1], [0, 0], [0, 1], [1, -1], [1, 1]],
    [[-1, 1], [0, 0], [0, 2], [1, -1], [2, 0]]
];
const BRACKETS = [];

(function buildBrackets() {
    const figures = [];
    for (const name of Object.keys(ORIENTATIONS)) {
        for (const orientation of ORIENTATIONS[name]) figures.push(orientation);
    }
    const seen = new Set();
    const variants = [];
    for (const base of BRACKET_BASES) variants.push.apply(variants, buildOrientations(base));
    for (const cells of variants) {
        const uid = cells.map(p => key(p[0], p[1])).sort().join('|');
        if (seen.has(uid)) continue;
        seen.add(uid);

        const spots = [];
        for (const figure of figures) {
            const figureKeys = new Set(figure.map(p => key(p[0], p[1])));
            if (!cells.every(p => figureKeys.has(key(p[0], p[1])))) continue;
            for (const p of figure) {
                if (cells.some(c => c[0] === p[0] && c[1] === p[1])) continue;
                const sk = key(p[0], p[1]);
                if (!spots.some(s => key(s[0], s[1]) === sk)) spots.push(p);
            }
        }
        if (spots.length < 2) continue;

        /* Границы учитывают и точки завершения: они тоже читаются с поля. */
        const shape = cells.concat(spots);
        const rows = shape.map(p => p[0]);
        const cols = shape.map(p => p[1]);
        BRACKETS.push({
            cells,
            spots,
            minR: -Math.min.apply(null, rows),
            maxR: BOARD_SIZE - 1 - Math.max.apply(null, rows),
            minC: -Math.min.apply(null, cols),
            maxC: BOARD_SIZE - 1 - Math.max.apply(null, cols)
        });
    }
})();

/* Опасная скоба: чужих клеток уже достаточно, свободных клеток основы
   не более двух, и как минимум два верхних хода дают третий сектор. */
function dangerousBrackets(state, me, oppSec, blind) {
    const other = OTHER_OF[me];
    const result = [];
    for (const tpl of BRACKETS) {
        for (let ar = tpl.minR; ar <= tpl.maxR; ar++) {
            for (let ac = tpl.minC; ac <= tpl.maxC; ac++) {
                const cells = tpl.cells.map(([dr, dc]) => [ar + dr, ac + dc]);
                let opp = 0;
                const empties = [];
                let dead = false;
                for (const [r, c] of cells) {
                    const k = key(r, c);
                    if (state.locked.has(k) || (blind && blind.has(k)) ||
                        state.board[r][c] === me) { dead = true; break; }
                    if (state.board[r][c] === other) opp++;
                    else empties.push([r, c]);
                }
                if (dead || opp < 3) continue;

                const sectors = new Set();
                for (const [r, c] of cells) sectors.add(SECTOR_OF(r, c));
                const winners = [];
                for (const [dr, dc] of tpl.spots) {
                    const r = ar + dr, c = ac + dc;
                    const k = key(r, c);
                    if (state.locked.has(k) || (blind && blind.has(k)) ||
                        state.board[r][c] === me) continue;
                    let gain = 0;
                    for (const s of sectors) if (!oppSec.has(s)) gain++;
                    if (!oppSec.has(SECTOR_OF(r, c))) gain++;
                    if (oppSec.size + gain >= SECTORS_TO_WIN) winners.push([r, c]);
                }
                if (winners.length >= 2) result.push({ cells, empties, winners });
            }
        }
    }
    return result;
}

/* Занять пустую клетку внутри скобы — этим убиваются все варианты
   завершения сразу. Если несколько скоб, берём клетку, покрывающую больше. */
function bracketDefense(state, me, oppSec, blind) {
    const dangers = dangerousBrackets(state, me, oppSec, blind);
    if (!dangers.length) return null;

    /* Если одна клетка убивает все опасные скобы сразу — берём её. */
    let common = null;
    for (const danger of dangers) {
        const holes = new Set(danger.empties.map(c => key(c[0], c[1])));
        common = common ? new Set(Array.from(common).filter(k => holes.has(k))) : holes;
    }
    if (common && common.size) {
        let best = null, bestSpan = -1;
        for (const k of common) {
            const [r, c] = parseKey(k);
            if (CELL_SPAN[r][c] > bestSpan) { bestSpan = CELL_SPAN[r][c]; best = [r, c]; }
        }
        if (best) return { place: best, fix: null };
    }

    const counts = new Map();
    for (const danger of dangers) {
        /* Скоба с одной пустой клеткой играется сегодня же — она важнее
           нескольких заготовок, до которых ещё ход-другой. */
        const urgency = Math.pow(2, 5 - danger.empties.length);
        const add = (cell, weight) => {
            if (state.board[cell[0]][cell[1]] !== EMPTY) return;
            const k = key(cell[0], cell[1]);
            counts.set(k, (counts.get(k) || 0) + weight);
        };
        for (const cell of danger.empties) add(cell, urgency);
        /* Если осталось два выхода, занятие одного из них тоже убивает
           скобу как двойную угрозу — и часто сразу для нескольких скоб. */
        if (danger.winners.length === 2) {
            for (const cell of danger.winners) add(cell, urgency * 0.5);
        }
    }
    if (!counts.size) return null;

    let best = null, bestScore = -Infinity;
    for (const [k, count] of counts) {
        const [r, c] = parseKey(k);
        const score = count * 100 + CELL_SPAN[r][c] * 8 + (oppSec.has(SECTOR_OF(r, c)) ? 0 : 4);
        if (score > bestScore) { bestScore = score; best = [r, c]; }
    }
    return best ? { place: best, fix: null } : null;
}

/* ---------- Разведка позиции ---------- */

function scan(board, locked, me, blind) {
    const other = OTHER_OF[me];
    const complete = [];
    const one = [];
    const developing = [];
    const potential = Object.create(null);
    const cellSpan = Object.create(null);
    const threats = new Map();     // точка достройки → все фигуры, которые она закрывает
    const seen = new Set();

    for (const tpl of TEMPLATES) {
        for (let ar = tpl.minR; ar <= tpl.maxR; ar++) {
            for (let ac = tpl.minC; ac <= tpl.maxC; ac++) {
                let empty = 0;
                let bad = false;
                const flat = [];

                for (let i = 0; i < tpl.cells.length; i++) {
                    const r = ar + tpl.cells[i][0];
                    const c = ac + tpl.cells[i][1];
                    if (locked.has(key(r, c)) || (blind && blind.has(key(r, c)))) {
                        bad = true;
                        break;
                    }
                    const value = board[r][c];

                    if (tpl.owners[i] === 'other') {
                        if (value !== other) { bad = true; break; }
                    } else {
                        if (value === other) { bad = true; break; }
                        if (value === EMPTY) {
                            empty++;
                            if (empty > 3) { bad = true; break; }
                        }
                    }
                    flat.push(r, c);
                }
                if (bad) continue;

                const cells = [];
                const ids = [];
                for (let i = 0; i < flat.length; i += 2) {
                    cells.push([flat[i], flat[i + 1]]);
                    ids.push(key(flat[i], flat[i + 1]));
                }
                ids.sort();
                const uid = ids.join('|');
                if (seen.has(uid)) continue;
                seen.add(uid);

                if (empty === 0) {
                    complete.push(cells);
                    continue;
                }

                const span = sectorSpan(cells);
                const spots = cells.filter(p => board[p[0]][p[1]] === EMPTY);

                if (empty === 1) {
                    one.push({ cells, spot: spots[0], mixed: tpl.mixed });
                    const sk = key(spots[0][0], spots[0][1]);
                    if (!threats.has(sk)) threats.set(sk, []);
                    threats.get(sk).push(cells);
                } else {
                    developing.push({ cells, spots, span, empty, mixed: tpl.mixed });
                    const weight = span >= 3 ? 5 : span >= 2 ? 2 : 1;
                    for (const p of spots) {
                        const k = key(p[0], p[1]);
                        potential[k] = (potential[k] || 0) + weight;
                        cellSpan[k] = Math.max(cellSpan[k] || 0, span);
                    }
                }
            }
        }
    }

    return { complete, one, developing, potential, cellSpan, threats };
}

/* ---------- Оценки ---------- */

function ownedSectors(owners, player) {
    const result = new Set();
    if (!owners) return result;
    for (const [k, who] of owners) {
        if (who === player) {
            const [r, c] = parseKey(k);
            result.add(SECTOR_OF(r, c));
        }
    }
    return result;
}

function gainCount(cells, owned) {
    const sectors = new Set();
    for (const [r, c] of cells) sectors.add(SECTOR_OF(r, c));
    let n = 0;
    for (const sector of sectors) if (!owned.has(sector)) n++;
    return n;
}

function figureScore(cells, ctx, otherScan) {
    const gain = gainCount(cells, ctx.mySec);
    let score = gain * gain * 150 + gain * 100;
    if (ctx.mySec.size + gain >= SECTORS_TO_WIN) score += 100000;

    /* Чужие клетки внутри нашей фигуры уходят под блокировку. */
    for (const [r, c] of cells) {
        if (ctx.board[r][c] === ctx.other) score += 5;
    }

    const ownKeys = new Set(cells.map(p => key(p[0], p[1])));
    for (const threat of otherScan.one) {
        if (threat.cells.some(p => ownKeys.has(key(p[0], p[1])))) score += 10;
    }
    return score;
}

function placementScore(r, c, ctx) {
    const k = key(r, c);
    let score = (ctx.potential[k] || 0) * 6 + CELL_SPAN[r][c] * 8;

    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
            if (ctx.board[nr][nc] === ctx.me) score += 3;
        }
    }

    if (!ctx.mySec.has(SECTOR_OF(r, c))) score += 4;
    if (ctx.threatCells.has(k)) score += 40;
    if (ctx.criticalThreatCells.has(k)) score += 10000;
    return score;
}

function topPlacements(board, locked, ctx, limit) {
    const list = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] !== EMPTY || locked.has(key(r, c))) continue;
            list.push({ cell: [r, c], score: placementScore(r, c, ctx) });
        }
    }
    list.sort((a, b) => b.score - a.score);
    return list.slice(0, limit).map(x => x.cell);
}

/* ---------- Кандидаты ---------- */

function generateMoves(state, me, limit) {
    const board = state.board;
    const locked = state.locked;
    const other = OTHER_OF[me];
    const mySec = ownedSectors(state.owners, me);
    const oppSec = ownedSectors(state.owners, other);
    const blind = state.blind;
    const my = scan(board, locked, me, blind);
    const opp = scan(board, locked, other, blind);

    const threatCells = new Set(opp.threats.keys());
    const critical = new Set();
    const threatGain = new Map();
    for (const [sk, figures] of opp.threats) {
        let gain = 0;
        for (const cells of figures) {
            const g = gainCount(cells, oppSec);
            if (g > gain) gain = g;
            if (oppSec.size + g >= SECTORS_TO_WIN) critical.add(sk);
        }
        threatGain.set(sk, gain);
    }

    const ctx = {
        board, me, other, mySec,
        potential: my.potential,
        threatCells,
        criticalThreatCells: critical
    };
    const placements = topPlacements(board, locked, ctx, 8);
    const moves = [];
    const push = (place, fix, score) => {
        if (place) moves.push({ place, fix: fix || null, score });
    };

    for (const cells of my.complete) {
        const base = figureScore(cells, ctx, opp);
        if (base <= 0) continue;
        for (const place of placements.slice(0, 2)) push(place, cells, base + 2);
    }

    for (const option of my.one) {
        push(option.spot, option.cells, figureScore(option.cells, ctx, opp) + 3);
    }

    for (const sk of threatCells) {
        const [r, c] = parseKey(sk);
        const gain = threatGain.get(sk) || 0;
        const weight = critical.has(sk) ? 100000 : 200 + gain * 50;
        push([r, c], null, weight + placementScore(r, c, ctx) * 0.01);
    }

    /* Раннее предупреждение: только заготовки, которые уже тянутся минимум
       в два новых сектора. Обычные односекторные линии не блокируются —
       иначе бот снова превратится в стену и перестанет строить свои фигуры.
       глубокие заготовки не берём: они слишком размыты и заставляют только блокировать. */
    const early = new Map();
    for (const option of opp.developing) {
        if (option.empty > 3) continue;
        const gain = gainCount(option.cells, oppSec);
        if (oppSec.size + gain < 2 && !(option.mixed && gain >= 2)) continue;
        const weight = 300 + option.span * 20;
        for (const [r, c] of option.spots) {
            const k = key(r, c);
            if (early.has(k) && early.get(k) >= weight) continue;
            early.set(k, weight);
        }
    }
    const earlySpots = [...early].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [sk, weight] of earlySpots) {
        if (threatCells.has(sk)) continue;
        const [r, c] = parseKey(sk);
        push([r, c], null, weight + placementScore(r, c, ctx) * 0.01);
    }

    for (const place of placements) {
        push(place, null, placementScore(place[0], place[1], ctx));
    }

    const idOf = move => key(move.place[0], move.place[1]) + '|' +
        (move.fix ? move.fix.map(p => key(p[0], p[1])).sort().join('|') : '');
    const seen = new Set();
    const selected = [];
    moves.sort((a, b) => b.score - a.score);
    for (const move of moves) {
        if (selected.length >= limit) break;
        const id = idOf(move);
        if (seen.has(id)) continue;
        seen.add(id);
        selected.push(move);
    }
    return selected;
}

/* ---------- Симуляция и оценка листа ---------- */

function applyMove(state, move, me) {
    const board = state.board.map(row => row.slice());
    const locked = new Set(state.locked);
    const owners = new Map(state.owners);
    const blind = state.blind ? new Set(state.blind) : null;
    const [r, c] = move.place;
    board[r][c] = me;
    if (move.fix) {
        for (const [fr, fc] of move.fix) {
            const k = key(fr, fc);
            locked.add(k);
            owners.set(k, me);
        }
    }
    return { board, locked, owners, blind };
}

function terminalScore(state, me) {
    const mySec = ownedSectors(state.owners, me);
    const oppSec = ownedSectors(state.owners, OTHER_OF[me]);
    if (mySec.size >= SECTORS_TO_WIN) return 100000;
    if (oppSec.size >= SECTORS_TO_WIN) return -100000;
    return null;
}

function evaluate(state, me) {
    const other = OTHER_OF[me];
    const mySec = ownedSectors(state.owners, me);
    const oppSec = ownedSectors(state.owners, other);
    let score = (mySec.size - oppSec.size) * 2000;

    const my = scan(state.board, state.locked, me, state.blind);
    const opp = scan(state.board, state.locked, other, state.blind);

    let ready = 0, danger = 0, threat = 0, risk = 0;
    for (const cells of my.complete) {
        const level = mySec.size + gainCount(cells, mySec);
        if (level > mySec.size) ready += level * level;
    }
    for (const cells of opp.complete) {
        const level = oppSec.size + gainCount(cells, oppSec);
        if (level > oppSec.size) danger += level * level;
    }
    for (const option of my.one) {
        const level = mySec.size + gainCount(option.cells, mySec);
        if (level > mySec.size) threat += level * level;
    }
    for (const option of opp.one) {
        const level = oppSec.size + gainCount(option.cells, oppSec);
        if (level > oppSec.size) risk += level * level;
    }
    score += ready * 90 - danger * 100 + threat * 30 - risk * 40;

    let mySpan = 0, oppSpan = 0;
    for (const k in my.cellSpan) mySpan += my.cellSpan[k];
    for (const k in opp.cellSpan) oppSpan += opp.cellSpan[k];
    score += (mySpan - oppSpan) * 4;

    for (const k in my.potential) score += Math.min(my.potential[k], 4) * 3;
    for (const k in opp.potential) score -= Math.min(opp.potential[k], 4) * 3;

    let denied = 0;
    for (const [k, who] of state.owners) {
        if (who !== me) continue;
        const [r, c] = parseKey(k);
        if (state.board[r][c] === other) denied++;
    }
    score += denied * 3;

    return score;
}

/* ---------- Альфа-бета ---------- */

function search(state, me, toMove, depth, alpha, beta, branch) {
    const terminal = terminalScore(state, me);
    if (terminal !== null) return terminal + depth;
    if (depth <= 0) return evaluate(state, me);

    const limits = branch || PROFILE.limits;
    const moves = generateMoves(state, toMove, limits[limits.length - depth] || limits[limits.length - 1]);
    if (!moves.length) return evaluate(state, me);

    if (toMove === me) {
        let best = -Infinity;
        for (const move of moves) {
            const value = search(applyMove(state, move, toMove), me, OTHER_OF[toMove], depth - 1, alpha, beta, limits);
            if (value > best) best = value;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    }

    let best = Infinity;
    for (const move of moves) {
        const value = search(applyMove(state, move, toMove), me, OTHER_OF[toMove], depth - 1, alpha, beta, limits);
        if (value < best) best = value;
        if (best < beta) beta = best;
        if (alpha >= beta) break;
    }
    return best;
}

/* ---------- Ранги игрока ---------- */

/* Ранг даётся только за органический переход: выбор уровня вручную
   его не выдаёт. Максимальный уровень, до которого дошли серией побед, хранится
   вместе с числом побед над 7-м режимом. */
const RANK_BY_LEVEL = { 4: 'Новичок', 5: 'Любитель', 6: 'Опытный', 7: 'Профи' };
const ROMAN_GLYPHS = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];

function romanNumeral(value) {
    const n = Math.max(1, Math.floor(value));
    if (n < ROMAN_GLYPHS.length) return ROMAN_GLYPHS[n];
    const table = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
        [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
    ];
    let rest = n;
    let out = '';
    for (const [amount, glyph] of table) {
        while (rest >= amount) { out += glyph; rest -= amount; }
    }
    return out;
}

/* ---------- Интерфейс ---------- */

const Bot = {
    /* Уровни идут от самого простого к самому сложному. Профили прежних
       уровней сохранены: Простой = бывший 1, Средний = бывший 2,
       Напряжённый = бывший «Опытный», Сложный = бывший 4. Новые ступени —
       «Элементарный» внизу, «Умеренный» между Простым и Средним и
       «Невыносимый» сверху с защитой от скобы. */
    LEVELS: [
        /* randomFirst — в начале партии монетка решает, кто ходит первым. */
        { id: 1, name: 'Элементарный', openingMoves: 0, openingProfile: 1, randomFirst: true,
          profile: { searchDepth: 1, rootMoves: 1, limits: [1, 1, 1], attention: 0, winAttention: 0.6 } },
        /* Простой: простой профиль, но нормальный дебют профилем Среднего —
           иначе он сыплется на первых же простых фигурах. */
        { id: 2, name: 'Простой', openingMoves: 2, openingProfile: 4, randomFirst: true,
          profile: { searchDepth: 1, rootMoves: 2, limits: [2, 2, 2], attention: 0.10, winAttention: 1 } },
        /* Умеренный: два дебютных хода профилем Среднего — переход без стены. */
        { id: 3, name: 'Умеренный', openingMoves: 2, openingProfile: 4, randomFirst: true,
          profile: { searchDepth: 1, rootMoves: 3, limits: [3, 2, 2], attention: 0.15, winAttention: 1 } },
        { id: 4, name: 'Средний', openingMoves: 2, openingProfile: 5, randomFirst: true,
          profile: { searchDepth: 2, rootMoves: 3, limits: [4, 3, 3], attention: 0.20, winAttention: 1 } },
        { id: 5, name: 'Напряжённый', openingMoves: 3, openingProfile: 6, randomFirst: true,
          profile: { searchDepth: 3, rootMoves: 8, limits: [7, 5, 4], attention: 0.85, winAttention: 1 } },
        { id: 6, name: 'Сложный', openingMoves: 3, openingProfile: 6, randomFirst: true,
          profile: { searchDepth: 3, rootMoves: 13, limits: [10, 6, 4], attention: 1.00, winAttention: 1 } },
        /* Невыносимый: тот же полный перебор плюс защита от «скобы». */
        { id: 7, name: 'Невыносимый', openingMoves: 3, openingProfile: 7, bracketGuard: true, randomFirst: true,
          profile: { searchDepth: 3, rootMoves: 16, limits: [12, 7, 4], attention: 1.00, winAttention: 1 } }
    ],

    /* Сколько собственных клеток уже поставил бот: одна за ход, fix цвет не стирает. */
    paintedBy(me, board) {
        let count = 0;
        for (const row of board) for (const value of row) if (value === me) count++;
        return count;
    },

    /* Сколько первых ходов бота считаются дебютом — берём из профиля уровня. */
    openingMoves() {
        const found = this.LEVELS && this.LEVELS.find(l => l.id === this.level);
        return found ? (found.openingMoves || 0) : 0;
    },

    /* Дебют: профиль уровня, указанного в openingProfile (у старших — следующий). */
    profileFor(me, board) {
        const level = this.LEVELS && this.LEVELS.find(l => l.id === this.level);
        if (!level) return this.profile;
        if (this.paintedBy(me, board) < (level.openingMoves || 0)) {
            const target = this.LEVELS.find(l => l.id === (level.openingProfile || level.id));
            if (target) return target.profile;
        }
        return level.profile;
    },

    /*
       Внимательность — это не «плохой ход», а неполное восприятие позиции.
       Бот может прозевать как неочевидную чужую заготовку, так и свою хорошую
       возможность. Для обычных уровней ход на третий сектор заметен всегда;
       младшие ступени могут прозевать и его — это задаёт winAttention.
       Пропуск детерминирован хэшем позиции и уровня, поэтому повтор позиции
       даёт тот же результат; в дебюте внимание всегда полное.
    */
    blindCells(board, locked, me, mySec, other, oppSec, attention, winAttention) {
        winAttention = winAttention == null ? 1 : winAttention;
        const blind = new Set();
        if (attention >= 1) return blind;
        const sig = boardSignature(board);
        const foundOther = scan(board, locked, other);
        const foundOwn = scan(board, locked, me);

        const add = (cells, spots, salience, prefix) => {
            if (salience >= 1) return;
            const chance = (1 - attention) * (1 - salience);
            const id = prefix + cells.map(p => key(p[0], p[1])).sort().join('|');
            if ((hashOf(id + '|' + sig + '|' + this.level) % 100000) / 100000 >= chance) return;
            for (const [r, c] of spots) blind.add(key(r, c));
        };

        for (const o of foundOther.one) {
            const gain = gainCount(o.cells, oppSec);
            let salience = 0.55;
            if (oppSec.size + gain >= SECTORS_TO_WIN) salience = winAttention;
            else if (o.mixed && gain >= 2) salience = 0.9;
            else if (gain >= 2) salience = 0.85;
            add(o.cells, [o.spot], salience, 'one:');
        }
        for (const d of foundOther.developing) {
            if (d.empty > 3) continue;
            const gain = gainCount(d.cells, oppSec);
            let salience = d.empty === 2 ? 0.5 : 0.35;
            if (oppSec.size + gain >= SECTORS_TO_WIN || (d.mixed && gain >= 2)) salience = Math.min(0.9, winAttention);
            add(d.cells, d.spots, salience, 'dev:');
        }

        /* Свои возможности бот тоже может прозевать — но не мгновенную победу. */
        for (const o of foundOwn.one) {
            const gain = gainCount(o.cells, mySec);
            let salience = 0.55;
            if (mySec.size + gain >= SECTORS_TO_WIN) salience = winAttention;
            else if (o.mixed && gain >= 2) salience = 0.9;
            else if (gain >= 2) salience = 0.85;
            add(o.cells, [o.spot], salience, 'myone:');
        }
        for (const d of foundOwn.developing) {
            if (d.empty > 3) continue;
            const gain = gainCount(d.cells, mySec);
            let salience = d.empty === 2 ? 0.5 : 0.35;
            if (mySec.size + gain >= SECTORS_TO_WIN || (d.mixed && gain >= 2)) salience = Math.min(0.9, winAttention);
            add(d.cells, d.spots, salience, 'mydev:');
        }

        /* Даже если клетка «не заметена» в тонкой заготовке, мгновенную победу
           через неё бот увидит — она важнее любого пропуска. На младших
           ступенях winAttention < 1, поэтому этот козырь отключается. */
        if (winAttention >= 1) {
            for (const [found, sec] of [[foundOther, oppSec], [foundOwn, mySec]]) {
                for (const o of found.one) {
                    if (sec.size + gainCount(o.cells, sec) >= SECTORS_TO_WIN) {
                        blind.delete(key(o.spot[0], o.spot[1]));
                    }
                }
            }
        }
        return blind;
    },

    lastBlind: new Set(),

    /* Непредсказуемость: в дебюте бот выбирает случайно среди нескольких
       почти равных ходов, а на младших уровнях изредка играет профилем
       старшего. random подменяется в тестах и бенчмарках. */
    random: Math.random,
    randomOpeningMoves: 3,
    openingVariants: 3,
    openingMargin: 20,
    spikes: {
        1: { chance: 0.05, level: 5 },
        2: { chance: 0.10, level: 5 },
        3: { chance: 0.15, level: 5 },
        4: { chance: 0.15, level: 6 }
    },
    lastSpike: false,

    STORAGE_KEY: 'toof_difficulty_v2',
    LEGACY_KEY: 'toof_difficulty',
    /* Старые номера: 1 Простой, 2 Средний, 3 Опытный, 4 Сложный. */
    LEGACY_IDS: { 1: 2, 2: 4, 3: 5, 4: 6 },
    STREAK_KEY: 'toof_streak',
    RANK_KEY: 'toof_rank_v1',
    level: 1,
    streak: { wins: 0, losses: 0 },
    direction: '',
    rankState: { maxLevel: 3, rankLevel: 0, masterWins: 0 },

    /* Доступ определяется органически достигнутым рангом — простой выбор
       уровня или старое сохранение доступ не даёт. Порог 3: Средний и выше
       открываются только серией побед на предыдущих режимах. */
    maxUnlockedLevel() {
        let rankLevel = this.rankState.rankLevel;
        /* Ранг из аккаунта Google тоже открывает уровни: он приходит с
           другого устройства и попадает в rankState при входе в аккаунт. */
        if (typeof Profile !== 'undefined' && Profile && Profile.state &&
            Profile.state.botRank && Number.isInteger(Profile.state.botRank.rankLevel)) {
            rankLevel = Math.max(rankLevel, Profile.state.botRank.rankLevel);
        }
        return Math.max(3, Math.min(rankLevel, this.LEVELS.length));
    },

    isLevelUnlocked(level) {
        return level <= this.maxUnlockedLevel();
    },

    rankName() {
        if (this.rankState.masterWins > 0) {
            return 'Мастер ' + romanNumeral(this.rankState.masterWins);
        }
        return RANK_BY_LEVEL[this.rankState.rankLevel] || '';
    },

    /* Ранг, пришедший из аккаунта Google, объединяем с локальным по
       максимуму: смена устройства не должна отнимать заслуженный ранг. */
    applyRemoteRank(data) {
        if (!data) return false;
        const level = value => Number.isInteger(value)
            ? Math.max(0, Math.min(value, this.LEVELS.length)) : null;
        const rankLevel = level(data.rankLevel);
        const maxLevel = level(data.maxLevel);
        const masterWins = Number.isInteger(data.masterWins) && data.masterWins >= 0
            ? data.masterWins : null;
        if (rankLevel === null || maxLevel === null || masterWins === null) return false;

        const before = this.rankState;
        this.rankState = {
            maxLevel: Math.max(before.maxLevel, maxLevel, rankLevel),
            rankLevel: Math.max(before.rankLevel, rankLevel),
            masterWins: Math.max(before.masterWins, masterWins)
        };
        const changed = Object.keys(this.rankState).some(key => this.rankState[key] !== before[key]);
        if (!this.isLevelUnlocked(this.level)) this.applyLevel(this.maxUnlockedLevel());
        this.save();
        return changed;
    },

    /* Возвращает сторону первого хода. Без humanSide сохраняется старый
       смысл: X — человек ходит первым, O — бот. С humanSide возвращается
       реальный символ первого хода: цвет игрока сторону не определяет. */
    firstSide(level, humanSide) {
        const found = this.LEVELS.find(l => l.id === level) || this.LEVELS[0];
        const humanFirst = !found.randomFirst || Math.random() < 0.5;
        if (!humanSide) return humanFirst ? 'X' : 'O';
        return humanFirst ? humanSide : (humanSide === SIDE_X ? SIDE_O : SIDE_X);
    },

    load() {
        try {
            let value = parseInt(localStorage.getItem(this.STORAGE_KEY), 10);
            if (!(value >= 1)) {
                /* Разовая миграция: старый номер мог называть другой режим. */
                const legacy = parseInt(localStorage.getItem(this.LEGACY_KEY), 10);
                if (legacy >= 1) {
                    value = this.LEGACY_IDS[legacy] || this.LEVELS[0].id;
                    localStorage.setItem(this.STORAGE_KEY, String(value));
                }
            }
            if (value >= 1) this.level = Math.min(value, this.LEVELS.length);
        } catch (e) { /* localStorage недоступен */ }
        try {
            const saved = JSON.parse(localStorage.getItem(this.STREAK_KEY));
            if (saved && Number.isInteger(saved.wins) && Number.isInteger(saved.losses)) {
                this.streak = { wins: saved.wins, losses: saved.losses };
            }
        } catch (e) { /* ignore */ }
        try {
            const savedRank = JSON.parse(localStorage.getItem(this.RANK_KEY));
            if (savedRank && Number.isInteger(savedRank.maxLevel) &&
                Number.isInteger(savedRank.masterWins)) {
                const rankLevel = Math.max(0, Math.min(savedRank.rankLevel || 0, 7));
                this.rankState = {
                    maxLevel: Math.max(3, rankLevel),
                    rankLevel,
                    masterWins: Math.max(0, savedRank.masterWins)
                };
            } else {
                this.rankState = { maxLevel: 3, rankLevel: 0, masterWins: 0 };
            }
        } catch (e) {
            this.rankState = { maxLevel: 3, rankLevel: 0, masterWins: 0 };
        }
        this.applyLevel(this.level);
        return this.level;
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, String(this.level));
            localStorage.setItem(this.STREAK_KEY, JSON.stringify(this.streak));
            localStorage.setItem(this.RANK_KEY, JSON.stringify(this.rankState));
        } catch (e) { /* ignore */ }
    },

    applyLevel(level) {
        const found = this.LEVELS.find(l => l.id === level);
        if (!found) return false;
        this.level = level;
        Object.assign(this.profile, found.profile);
        return true;
    },

    setLevel(level) {
        if (level < 1 || level > this.LEVELS.length || !this.isLevelUnlocked(level)) return false;
        this.applyLevel(level);
        this.resetStreak();
        return true;
    },

    resetStreak() {
        this.streak = { wins: 0, losses: 0 };
        this.direction = '';
        this.save();
        return this.streak;
    },

    /* humanWon — с точки зрения игрока-человека. */
    recordResult(humanWon, draw) {
        this.direction = '';
        if (draw) {
            this.resetStreak();
            return { changed: false, rank: this.rankName() };
        }
        const beforeRank = this.rankName();
        const wonAtSeventh = humanWon && this.level === 7;
        if (humanWon) {
            this.streak.wins++;
            this.streak.losses = 0;
        } else {
            this.streak.losses++;
            this.streak.wins = 0;
        }
        let changed = false;
        if (this.streak.wins >= 3 && this.level < this.LEVELS.length) {
            this.applyLevel(this.level + 1);
            /* Только органический переход открывает следующий уровень и ранг. */
            this.rankState.maxLevel = Math.max(this.rankState.maxLevel, this.level);
            if (this.level >= 4) {
                this.rankState.rankLevel = Math.max(this.rankState.rankLevel, this.level);
            }
            this.direction = 'up';
            changed = true;
        } else if (this.streak.losses >= 3 && this.level > 1) {
            this.applyLevel(this.level - 1);
            this.direction = 'down';
            changed = true;
        }
        if (wonAtSeventh) this.rankState.masterWins++;
        if (changed) this.streak = { wins: 0, losses: 0 };
        this.save();
        /* Ранг закрепляется за аккаунтом Google: на другом устройстве
           он восстановится и снова откроет соответствующие уровни. */
        if (typeof Profile !== 'undefined' && Profile && typeof Profile.saveBotRank === 'function') {
            Profile.saveBotRank(this.rankState);
        }
        const rank = this.rankName();
        return {
            changed, level: this.level, name: this.name(), direction: this.direction,
            rank, rankChanged: rank !== beforeRank ? rank : null
        };
    },

    name() {
        const found = this.LEVELS.find(l => l.id === this.level);
        return found ? found.name : this.LEVELS[0].name;
    },

    profile: PROFILE,

    configure(profile) {
        Object.assign(this.profile, profile || {});
        return this.profile;
    },

    /* Ранговой лотереи нет: всегда возвращаем список как есть. */
    rankMoves(moves) {
        return moves;
    },

    decide(board, locked, me, owners) {
        me = me || Game.current || SIDE_O;
        const state = { board, locked, owners };
        const other = OTHER_OF[me];
        const mySec = ownedSectors(owners, me);
        const oppSec = ownedSectors(owners, other);
        let profile = this.profileFor(me, board);
        const spike = this.spikes && this.spikes[this.level];
        this.lastSpike = !!(spike && this.random() < spike.chance);
        if (this.lastSpike) {
            const target = this.LEVELS.find(l => l.id === spike.level);
            if (target) profile = target.profile;
        }
        const levelConfig = this.LEVELS.find(l => l.id === this.level);
        const guardBracket = !!(levelConfig && levelConfig.bracketGuard);
        /* Дебютные ходы играются без тупняка: внимание полное. */
        const painted = this.paintedBy(me, board);
        const opening = painted < this.openingMoves();
        const randomOpening = painted < this.randomOpeningMoves;
        const attention = opening ? 1 : (profile.attention == null ? 1 : profile.attention);
        const winAttention = profile.winAttention == null ? 1 : profile.winAttention;
        const blind = this.blindCells(board, locked, me, mySec, other, oppSec, attention, winAttention);
        state.blind = blind;
        this.lastBlind = blind;
        const candidates = generateMoves(state, me,
            randomOpening ? Math.max(profile.rootMoves, 8) : profile.rootMoves);
        if (!candidates.length) return null;

        const own = scan(board, locked, me, blind);
        const enemy = scan(board, locked, other, blind);

        /* Лучшая готовая фигура и лучшая фигура в одну клетку. */
        let readyFigure = null, readyGain = 0;
        for (const cells of own.complete) {
            const gain = gainCount(cells, mySec);
            if (gain > readyGain) { readyGain = gain; readyFigure = cells; }
        }
        let winOne = null;
        for (const option of own.one) {
            const gain = gainCount(option.cells, mySec);
            if (mySec.size + gain >= SECTORS_TO_WIN && (!winOne || gain > winOne.gain)) {
                winOne = { option, gain };
            }
        }

        /* Мгновенные угрозы противника. Только они подлежат жёсткому блоку —
           попытка блокировать все «зреющие» фигуры превращала бота в стену. */
        const winSpots = new Set();
        for (const option of enemy.one) {
            const gain = gainCount(option.cells, oppSec);
            if (oppSec.size + gain >= SECTORS_TO_WIN || (option.mixed && gain >= 2)) {
                winSpots.add(key(option.spot[0], option.spot[1]));
            }
        }
        const oppCanWin = winSpots.size > 0;

        /* Свободную клетку хода ставим вне фиксируемой фигуры. */
        const freeFor = figure => {
            const exclude = new Set(figure.map(p => key(p[0], p[1])));
            for (const move of candidates) {
                const k = key(move.place[0], move.place[1]);
                if (!move.fix && !exclude.has(k)) return move.place;
            }
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (board[r][c] === EMPTY && !locked.has(key(r, c)) && !exclude.has(key(r, c))) {
                        return [r, c];
                    }
                }
            }
            return null;
        };

        const leavesWin = (place, fix) => {
            const next = applyMove(state, { place, fix: fix || null }, me);
            const sec = ownedSectors(next.owners, other);
            return scan(next.board, next.locked, other, state.blind).one.some(o =>
                sec.size + gainCount(o.cells, sec) >= SECTORS_TO_WIN);
        };

        /* Поиск — финальный арбитр каскада: мгновенную тактику всё равно берём,
           но не фиксируем фигуру, если поиск видит вынужденный проигрыш и есть ход,
           который его избегает. Без этого бот фиксировал фигуру на два сектора,
           открывая противнику беспрепятственную достройку третьего. */
        const depth = profile.searchDepth;
        const valueOf = (place, fix) => search(
            applyMove(state, { place, fix: fix || null }, me), me, other, depth,
            -Infinity, Infinity, profile.limits);
        const losesByForce = (place, fix) => {
            if (valueOf(place, fix) > -90000) return false;
            return candidates.some(move => valueOf(move.place, move.fix) > -90000);
        };

        /* 1. Победа сейчас: готовая фигура даёт третий сектор. */
        if (readyFigure && mySec.size + readyGain >= SECTORS_TO_WIN) {
            const place = freeFor(readyFigure);
            if (place) return { place, fix: readyFigure };
        }

        /* 2. Достройка победы: осталась одна клетка. */
        if (winOne) return { place: winOne.option.spot, fix: winOne.option.cells };

        /* 3a. Только «Невыносимый»: скоба с тремя выходами в фигуру
           неуязвима, если её построили, поэтому бот мешает построить
           само основание. Идет раньше обычного блока: блок одной из
           трёх точек ничего не даёт. Если есть победа в один ход
           вне скобы — сначала закрываем её. */
        if (guardBracket) {
            const dangers = dangerousBrackets(state, me, oppSec, blind);
            if (dangers.length) {
                const bracketWin = new Set();
                for (const danger of dangers) {
                    for (const spot of danger.winners) bracketWin.add(key(spot[0], spot[1]));
                }
                const foreignWin = Array.from(winSpots).some(w => !bracketWin.has(w));
                if (!foreignWin) {
                    const defense = bracketDefense(state, me, oppSec, blind);
                    if (defense) return defense;
                }
            }
        }

        /* 3. Блок мгновенной победы противника — выбором из кандидатов поиском. */
        if (oppCanWin) {
            const covers = p => winSpots.has(key(p[0], p[1]));
            const blockers = candidates.filter(move =>
                covers(move.place) || (move.fix && move.fix.some(covers)));
            if (blockers.length) {
                let best = null, bestValue = -Infinity, alpha = -Infinity;
                for (const move of blockers) {
                    const value = search(applyMove(state, move, me), me, other,
                        depth, alpha, Infinity, profile.limits);
                    if (value > bestValue) { bestValue = value; best = move; }
                    if (value > alpha) alpha = value;
                }
                if (best) return { place: best.place, fix: best.fix };
            }
            for (const sk of winSpots) {
                const [r, c] = parseKey(sk);
                if (board[r][c] === EMPTY && !locked.has(sk)) return { place: [r, c], fix: null };
            }
        }

        /* 4. Своя готовая фигура на два и более сектора. */
        if (readyFigure && readyGain >= 2) {
            const place = freeFor(readyFigure);
            if (place && !leavesWin(place, readyFigure) &&
                !losesByForce(place, readyFigure)) return { place, fix: readyFigure };
        }

        /* 5. Своя достройка. */
        let oneBest = null, oneGain = 0;
        for (const option of own.one) {
            const gain = gainCount(option.cells, mySec);
            if (gain > oneGain) { oneGain = gain; oneBest = option; }
        }
        if (oneBest && !leavesWin(oneBest.spot, oneBest.cells) &&
            !losesByForce(oneBest.spot, oneBest.cells)) {
            return { place: oneBest.spot, fix: oneBest.cells };
        }

        /* 6. Финал — поиск по всем кандидатам. В дебюте бот может взять любой
           из нескольких почти равных ходов: партии не начинаются одинаково.
           Вне дебюта остаётся строгий максимум. */
        let alpha = -Infinity;
        let best = null;
        let bestScore = -Infinity;
        const ranked = [];
        for (const move of candidates) {
            const value = search(applyMove(state, move, me), me, other,
                depth, alpha, Infinity, profile.limits);
            const total = value + move.score * 0.001;
            ranked.push({ move, value, total });
            if (total > bestScore) { bestScore = total; best = move; }
            if (value > alpha) alpha = value;
        }
        if (randomOpening && ranked.length > 1) {
            const bestValue = Math.max.apply(null, ranked.map(x => x.value));
            const near = ranked.filter(x => x.value >= bestValue - this.openingMargin)
                .sort((a, b) => b.total - a.total)
                .slice(0, this.openingVariants);
            if (near.length > 1) {
                const pick = near[Math.floor(this.random() * near.length) % near.length];
                return { place: pick.move.place, fix: pick.move.fix };
            }
        }
        return best ? { place: best.place, fix: best.fix } : null;
    },

    /* Совместимость со старым вызовом. */
    chooseMove(board, locked, me, owners) {
        const decision = this.decide(board, locked, me, owners);
        return decision ? decision.place : null;
    }
};
