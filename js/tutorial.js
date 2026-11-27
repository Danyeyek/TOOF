'use strict';

/* ============================================================
   TOOF — анимированный рассказ о правилах (раздел «Правила»).
   Одна непрерывная анимация: поле появляется, подсвечиваются
   секторы, заливается клетка, вокруг неё строится фигура, и в
   конце — галерея фигур. Между шагами пауза для чтения, дальше
   рассказ продолжается сам. Управляет только кнопка в финале.
   ============================================================ */

const Tutorial = (() => {
    let box = null;
    let grid = null;
    let gallery = null;
    let index = 0;
    let timers = [];
    let pendingPos = [3, 3];
    let figureCells = [];

    function story() { return RULES_STORY; }

    function isFinal() { return index >= story().length - 1; }

    function clearTimers() {
        timers.forEach(timer => clearTimeout(timer));
        timers = [];
    }

    function later(fn, ms) {
        timers.push(setTimeout(fn, ms));
    }

    function cellsHtml() {
        let html = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                html += '<div class="cell" data-r="' + r + '" data-c="' + c + '" style="animation-delay:' +
                    ((r * BOARD_SIZE + c) * 15) + 'ms"></div>';
            }
        }
        return html;
    }

    function figureCard(sheet) {
        let cells = '';
        for (let r = 0; r < sheet.height; r++) {
            for (let c = 0; c < sheet.width; c++) {
                const found = (sheet.cells || []).find(cell => cell[0] === r && cell[1] === c);
                const symbol = found ? found[2] : '';
                cells += '<i class="' + (symbol === 'X' ? 'x' : symbol === 'O' ? 'o' : '') + '"></i>';
            }
        }
        const label = sheet.name ? '<figcaption>' + sheet.name + '</figcaption>' : '';
        return '<figure class="card gallery-card">' + label +
            '<div class="demo" style="--w:' + sheet.width + ';--h:' + sheet.height + '">' + cells + '</div></figure>';
    }

    function sectorHtml() {
        let html = '';
        for (let s = 0; s < 4; s++) html += '<div class="tutorial-sector" data-sector="' + s + '"></div>';
        return html;
    }

    function buildStage() {
        box.innerHTML = '<div class="tutorial-stage">' +
            '<div class="tutorial-copy" id="tutCopy">' +
            '<h3 class="tutorial-title" id="tutTitle"></h3>' +
            '<p class="tutorial-caption" id="tutCaption"></p>' +
            '<div class="tutorial-text" id="tutText"></div>' +
            '</div>' +
            '<div class="tutorial-board" id="tutBoard"><div class="grid tutorial-grid" id="tutGrid">' +
            cellsHtml() + sectorHtml() + '</div></div>' +
            '<div class="tutorial-gallery" id="tutGallery" hidden>' +
            '<p class="tutorial-gallery__label">Обычные фигуры</p>' +
            '<div class="tutorial-gallery__row">' + BASE_FIGURES.map(figureCard).join('') + '</div>' +
            '<p class="tutorial-gallery__label">Диагональные фигуры</p>' +
            '<div class="tutorial-gallery__row">' + DIAGONAL_FIGURES.map(figureCard).join('') + '</div>' +
            '</div>' +
            '<p class="tutorial-hint" id="tutorialHint">Нажмите на экран, чтобы продолжить · через 15 секунд рассказ пойдёт сам</p>' +
            '</div>';
        grid = document.getElementById('tutGrid');
        gallery = document.getElementById('tutGallery');
    }

    function cellAt(r, c) {
        if (!grid) return null;
        return grid.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
    }

    /* Фигура всегда появляется в одном и том же месте — обучение стабильно. */
    const FIGURE_CELLS = [[3, 1], [3, 2], [3, 3], [3, 4]];

    function setSectors(sectors, on) {
        if (!grid) return;
        grid.querySelectorAll('.tutorial-sector').forEach(overlay => {
            const sector = Number(overlay.dataset.sector);
            overlay.classList.toggle('is-lit', on && sectors.indexOf(sector) !== -1);
        });
    }

    function sameSectorLine(exclude) {
        if (!figureCells.length) return null;
        const first = figureCells[0];
        const r0 = first[0] < SECTOR_SIZE ? 0 : SECTOR_SIZE;
        const c0 = first[1] < SECTOR_SIZE ? 0 : SECTOR_SIZE;
        const used = new Set(exclude.map(([r, c]) => r + ',' + c));
        for (let r = r0; r < r0 + SECTOR_SIZE; r++) {
            for (let c = c0; c <= c0 + SECTOR_SIZE - 4; c++) {
                const cells = [[r, c], [r, c + 1], [r, c + 2], [r, c + 3]];
                if (cells.every(([rr, cc]) => !used.has(rr + ',' + cc))) return cells;
            }
        }
        return null;
    }

    function clearFigure() {
        if (!grid) return;
        grid.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('x', 'o', 'figure-in', 'locked', 'selected', 'pending');
            cell.style.animationDelay = '';
        });
        setSectors([0, 1, 2, 3], false);
    }

    function showFigure(cells, sectors, caption) {
        clearFigure();
        cells.forEach(([r, c], i) => {
            const cell = cellAt(r, c);
            if (!cell) return;
            cell.classList.add('x', 'figure-in');
            cell.style.animationDelay = (i * 140) + 'ms';
        });
        setSectors(sectors, true);
        const captionBox = document.getElementById('tutCaption');
        if (captionBox) captionBox.textContent = caption;
    }

    function showText(act) {
        const title = document.getElementById('tutTitle');
        const caption = document.getElementById('tutCaption');
        const text = document.getElementById('tutText');
        const copy = document.getElementById('tutCopy');
        if (title) title.textContent = act.title;
        if (caption) caption.textContent = act.caption || '';
        if (text) text.innerHTML = act.html || '';
        if (copy) {
            copy.classList.remove('copy-in');
            void copy.offsetWidth;
            copy.classList.add('copy-in');
        }
    }

    const actions = {
        field: () => {},
        goal: () => setSectors([0, 1, 2], true),
        place: () => {
            setSectors([0, 1, 2], false);
            const cell = cellAt(pendingPos[0], pendingPos[1]);
            if (cell) cell.classList.add('x', 'pending');
        },
        move: () => {
            const cell = cellAt(pendingPos[0], pendingPos[1]);
            if (cell) cell.classList.add('x', 'pending');
        },
        figure: () => {
            clearFigure();
            figureCells = FIGURE_CELLS.map(cell => cell.slice());
            figureCells.forEach(([r, c], i) => {
                const cell = cellAt(r, c);
                if (!cell) return;
                cell.classList.add('x', 'figure-in');
                cell.style.animationDelay = (i * 160) + 'ms';
            });
        },
        select: () => {
            figureCells.forEach(([r, c], i) => {
                later(() => {
                    const cell = cellAt(r, c);
                    if (cell) cell.classList.add('selected');
                }, 300 + i * 350);
            });
        },
        capture: () => {
            figureCells.forEach(([r, c]) => {
                const cell = cellAt(r, c);
                if (!cell) return;
                cell.classList.remove('pending', 'selected');
                cell.classList.add('locked');
            });
            const sectors = [];
            figureCells.forEach(([r, c]) => {
                const sector = (r < SECTOR_SIZE ? 0 : 2) + (c < SECTOR_SIZE ? 0 : 1);
                if (sectors.indexOf(sector) === -1) sectors.push(sector);
            });

            /* Та же фигура рядом, но фиолетовая: оба игрока захватывают один сектор. */
            const other = sameSectorLine(figureCells);
            if (other) {
                other.forEach(([r, c], i) => {
                    const cell = cellAt(r, c);
                    if (!cell) return;
                    cell.classList.remove('pending', 'selected');
                    cell.classList.add('o', 'locked', 'figure-in');
                    cell.style.animationDelay = (i * 140) + 'ms';
                });
                const otherSectors = [];
                other.forEach(([r, c]) => {
                    const sector = (r < SECTOR_SIZE ? 0 : 2) + (c < SECTOR_SIZE ? 0 : 1);
                    if (otherSectors.indexOf(sector) === -1) otherSectors.push(sector);
                });
                const common = sectors.filter(sector => otherSectors.indexOf(sector) !== -1);
                setSectors(common.length ? common : sectors, true);
            } else {
                setSectors(sectors, true);
            }
        },
        span: () => {
            later(() => showFigure(
                [[3, 4], [3, 5], [3, 6], [3, 7]], [0, 1], 'Два сектора — одна фигура.'), 0);
            later(() => showFigure(
                [[4, 5], [5, 4], [5, 5], [5, 6], [6, 4], [6, 6]], [1, 2, 3], 'Три сектора — та же фигура.'), 3400);
        },
        gallery: () => {
            const board = document.getElementById('tutBoard');
            if (board) board.hidden = true;
            if (gallery) gallery.hidden = false;
        },
        final: () => {}
    };

    function advance() {
        clearTimers();
        if (isFinal()) return;
        index += 1;
        applyAct();
    }

    function movePending(r, c) {
        const old = cellAt(pendingPos[0], pendingPos[1]);
        if (old) old.classList.remove('x', 'pending');
        pendingPos = [r, c];
        const cell = cellAt(r, c);
        if (cell) cell.classList.add('x', 'pending');
    }

    function onScreenClick(event) {
        if (isFinal()) return;
        if (event.target.closest('#tutorialPlayBot') || event.target.closest('[data-back]')) return;
        if (story()[index].id === 'move' && grid && event.target.closest('#tutGrid')) {
            const cell = event.target.closest('.cell');
            if (cell && grid.contains(cell)) {
                const r = Number(cell.dataset.r);
                const c = Number(cell.dataset.c);
                if (r !== pendingPos[0] || c !== pendingPos[1]) movePending(r, c);
            }
            return;
        }
        advance();
    }

    function applyAct() {
        const act = story()[index];
        showText(act);
        /* Только поле появляется сразу. Остальные анимации ждут 3 секунды,
           чтобы игрок сначала прочитал текст шага. */
        const action = actions[act.id];
        if (action) {
            if (act.id === 'field') action();
            else later(action, 3000);
        }

        const hint = document.getElementById('tutorialHint');
        if (hint) hint.hidden = !!act.final || act.id === 'move';

        if (act.final) {
            later(() => {
                const finalAction = document.getElementById('tutorialFinal');
                const finalButton = document.getElementById('tutorialPlayBot');
                if (finalAction) finalAction.hidden = false;
                if (finalButton) finalButton.hidden = false;
            }, 3000);
            return;
        }
        /* На шаге перестановки продолжение — только клик вне поля, как и сказано в тексте. */
        if (act.id === 'move') return;
        later(advance, act.hold || 15000);
    }

    function play() {
        const finalAction = document.getElementById('tutorialFinal');
        const finalButton = document.getElementById('tutorialPlayBot');
        const hint = document.getElementById('tutorialHint');
        if (finalAction) finalAction.hidden = true;
        if (finalButton) finalButton.hidden = true;
        if (hint) hint.hidden = true;
        if (typeof Bot !== 'undefined' && Bot && typeof Bot.setLevel === 'function') Bot.setLevel(1);
        if (typeof UI !== 'undefined' && UI && typeof UI.start === 'function') UI.start('bot');
    }

    function start(container) {
        box = container || document.getElementById('rulesText');
        clearTimers();
        index = 0;
        pendingPos = [3, 3];
        figureCells = [];
        const finalAction = document.getElementById('tutorialFinal');
        const finalButton = document.getElementById('tutorialPlayBot');
        if (finalAction) finalAction.hidden = true;
        if (finalButton) finalButton.hidden = true;
        buildStage();
        const screen = document.getElementById('rulesScreen');
        if (screen && !screen.dataset.tutorialClickBound) {
            screen.dataset.tutorialClickBound = '1';
            screen.addEventListener('click', onScreenClick);
        }
        applyAct();
        return box;
    }

    return { start, play, stop: clearTimers };
})();
