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
    let autoTimer = null;
    let finishing = false;
    let pendingPos = [3, 3];
    let figureCells = [];

    function story() { return I18N.lang === 'en' ? RULES_STORY_EN : RULES_STORY; }

    function isFinal() { return index >= story().length - 1; }

    function clearTimers() {
        timers.forEach(entry => clearTimeout(entry.id));
        timers = [];
        if (autoTimer !== null) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }
    }

    function later(fn, ms) {
        const entry = { id: null, fn };
        entry.id = setTimeout(() => {
            const at = timers.indexOf(entry);
            if (at !== -1) timers.splice(at, 1);
            fn();
        }, ms);
        timers.push(entry);
    }

    /* При быстром пропуске доводим все отложенные анимации шага до конца. */
    function finishAnimations() {
        finishing = true;
        let passes = 0;
        while (timers.length && passes++ < 50) {
            const batch = timers;
            timers = [];
            batch.forEach(entry => {
                clearTimeout(entry.id);
                entry.fn();
            });
        }
        finishing = false;
    }

    function cellsHtml() {
        let html = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                html += '<div class="cell intro-in" data-r="' + r + '" data-c="' + c + '" style="animation-delay:' +
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
        const label = sheet.name ? '<figcaption>' + t(sheet.name) + '</figcaption>' : '';
        return '<figure class="card gallery-card">' + label +
            '<div class="demo" style="--w:' + sheet.width + ';--h:' + sheet.height + '">' + cells + '</div></figure>';
    }

    function sectorHtml() {
        let html = '';
        for (let s = 0; s < 4; s++) html += '<div class="tutorial-sector" data-sector="' + s + '"></div>';
        return html;
    }

    function buildStage() {
        box.innerHTML = '<div class="tutorial-stage" id="tutStage">' +
            '<div class="tutorial-copy" id="tutCopy">' +
            '<h3 class="tutorial-title" id="tutTitle"></h3>' +
            '<p class="tutorial-caption" id="tutCaption"></p>' +
            '<div class="tutorial-text" id="tutText"></div>' +
            '</div>' +
            '<div class="tutorial-board" id="tutBoard"><div class="grid tutorial-grid" id="tutGrid">' +
            cellsHtml() + sectorHtml() +
            '</div></div>' +
            '<div class="tutorial-gallery" id="tutGallery" hidden>' +
            '<p class="tutorial-gallery__label">' + t('Обычные фигуры') + '</p>' +
            '<div class="tutorial-gallery__row">' + BASE_FIGURES.map(figureCard).join('') + '</div>' +
            '<p class="tutorial-gallery__label">' + t('Диагональные фигуры') + '</p>' +
            '<div class="tutorial-gallery__row">' + DIAGONAL_FIGURES.map(figureCard).join('') + '</div>' +
            '</div>' +
            '<p class="tutorial-hint" id="tutorialHint">' + t('Нажмите на экран, чтобы перейти к следующему этапу. Либо через 15 секунд объяснение продолжится автоматически') + '</p>' +
            '<button class="btn btn-primary btn-mini tutorial-confirm" id="tutorialConfirm" type="button" hidden>' +
            t('Подтвердить') + '</button>' +
            '</div>';
        grid = document.getElementById('tutGrid');
        gallery = document.getElementById('tutGallery');
        const confirm = document.getElementById('tutorialConfirm');
        if (confirm && !confirm.dataset.tutorialConfirmBound) {
            confirm.dataset.tutorialConfirmBound = '1';
            confirm.addEventListener('click', event => {
                event.stopPropagation();
                if (typeof Sound !== 'undefined' && Sound.play) Sound.play('click');
                advance();
            });
        }
    }

    function cellAt(r, c) {
        if (!grid) return null;
        return grid.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
    }

    /* Игрок сам отмечает клетки фигуры; кнопка подтверждения появляется,
       когда отмечены все. */
    function toggleSelectCell(cell) {
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        if (!figureCells.some(([fr, fc]) => fr === r && fc === c)) return;
        cell.classList.toggle('selected');
        const ready = figureCells.every(([fr, fc]) => {
            const target = cellAt(fr, fc);
            return !!target && target.classList.contains('selected');
        });
        const confirm = document.getElementById('tutorialConfirm');
        if (confirm) confirm.hidden = !ready;
    }

    /* Фигура всегда появляется в одном и том же месте — обучение стабильно. */
    const FIGURE_CELLS = [[3, 1], [3, 2], [3, 3], [3, 4]];

    function setSectors(sectors, on, shared) {
        if (!grid) return;
        grid.querySelectorAll('.tutorial-sector').forEach(overlay => {
            const sector = Number(overlay.dataset.sector);
            const lit = on && sectors.indexOf(sector) !== -1;
            overlay.classList.toggle('is-lit', lit);
            overlay.classList.toggle('is-shared', lit && !!shared);
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
        });
        setSectors([0, 1, 2, 3], false);
    }

    function applyClear(list) {
        if (!list || !list.length) return;
        if (list.indexOf('all') !== -1) {
            clearFigure();
            return;
        }
        if (list.indexOf('sectors') !== -1) setSectors([0, 1, 2, 3], false);
        if (grid && list.indexOf('pending') !== -1) {
            grid.querySelectorAll('.cell').forEach(cell => cell.classList.remove('x', 'pending'));
        }
        if (grid && list.indexOf('selected') !== -1) {
            grid.querySelectorAll('.cell').forEach(cell => cell.classList.remove('selected'));
        }
        if (list.indexOf('board') !== -1) {
            const board = document.getElementById('tutBoard');
            if (board) board.hidden = true;
        }
    }

    function showFigure(cells, sectors, caption) {
        clearFigure();
        cells.forEach(([r, c], i) => {
            const cell = cellAt(r, c);
            if (!cell) return;
            cell.style.animationDelay = (i * 140) + 'ms';
            cell.classList.add('x', 'figure-in');
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
        if (title) {
            title.textContent = act.title;
            title.hidden = !act.title;
        }
        if (caption) caption.textContent = act.caption || '';
        if (text) text.innerHTML = act.html || '';
        if (copy) {
            copy.classList.remove('copy-in');
            void copy.offsetWidth;
            copy.classList.add('copy-in');
        }
    }

    const actions = {
        field: () => {
            later(() => {
                if (!grid) return;
                grid.querySelectorAll('.cell.intro-in').forEach(cell => cell.classList.remove('intro-in'));
            }, 2000);
        },
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
                cell.style.animationDelay = (i * 160) + 'ms';
                cell.classList.add('x', 'figure-in');
            });
        },
        select: () => {
            const confirm = document.getElementById('tutorialConfirm');
            if (confirm) confirm.hidden = true;
            figureCells.forEach(([r, c]) => {
                const cell = cellAt(r, c);
                if (cell) cell.classList.remove('selected');
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
                    cell.style.animationDelay = (i * 140) + 'ms';
                    cell.classList.add('o', 'locked', 'figure-in');
                });
                const otherSectors = [];
                other.forEach(([r, c]) => {
                    const sector = (r < SECTOR_SIZE ? 0 : 2) + (c < SECTOR_SIZE ? 0 : 1);
                    if (otherSectors.indexOf(sector) === -1) otherSectors.push(sector);
                });
                const common = sectors.filter(sector => otherSectors.indexOf(sector) !== -1);
                setSectors(common.length ? common : sectors, true, true);
            } else {
                setSectors(sectors, true, true);
            }
        },
        span: () => {
            let phase = 0;
            const showNext = () => {
                if (phase % 2 === 0) {
                    showFigure(
                        [[3, 4], [3, 5], [3, 6], [3, 7]], [0, 1], t('Два сектора — одна фигура.'));
                } else {
                    showFigure(
                        [[4, 5], [5, 4], [5, 5], [5, 6], [6, 4], [6, 6]], [1, 2, 3], t('Три сектора — та же фигура.'));
                }
                phase += 1;
                /* Пока шаг не пропущен, кадры 2 и 3 секторов чередуются. */
                if (!finishing) later(showNext, 3400);
            };
            showNext();
        },
        gallery: () => {
            const board = document.getElementById('tutBoard');
            if (board) board.hidden = true;
            if (gallery) gallery.hidden = false;
        },
        final: () => {}
    };

    function advance() {
        finishAnimations();
        if (autoTimer !== null) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }
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
        if (event.target.closest('#tutorialPlayBot') || event.target.closest('[data-back]') ||
            event.target.closest('#tutorialConfirm')) return;
        if (story()[index].id === 'select') {
            const cell = event.target.closest('.cell');
            if (cell && grid && grid.contains(cell)) toggleSelectCell(cell);
            return;
        }
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
        applyClear(act.clear);
        showText(act);
        const confirm = document.getElementById('tutorialConfirm');
        if (confirm) confirm.hidden = act.id !== 'select';
        /* Новый этап анимируется сразу, без ожидания перед стартом. */
        const action = actions[act.id];
        if (action) action();

        const hint = document.getElementById('tutorialHint');
        if (hint) hint.hidden = !!act.final || act.id === 'move' || act.id === 'select';

        if (act.final) {
            const finalAction = document.getElementById('tutorialFinal');
            const finalButton = document.getElementById('tutorialPlayBot');
            if (finalAction) finalAction.hidden = false;
            if (finalButton) finalButton.hidden = false;
            return;
        }
        /* Перестановка — клик вне поля, выделение — кнопка подтверждения. */
        if (act.id === 'move' || act.id === 'select') return;
        if (autoTimer !== null) clearTimeout(autoTimer);
        autoTimer = setTimeout(advance, act.hold || 15000);
    }

    function play() {
        const finalAction = document.getElementById('tutorialFinal');
        const finalButton = document.getElementById('tutorialPlayBot');
        const hint = document.getElementById('tutorialHint');
        if (finalAction) finalAction.hidden = true;
        if (finalButton) finalButton.hidden = true;
        if (hint) hint.hidden = true;
        /* Кнопка обещает игру на элементарном режиме — это уровень 1. */
        if (typeof Bot !== 'undefined' && Bot && typeof Bot.setLevel === 'function') Bot.setLevel(1);
        /* Обновляем подсветку режимов: иначе список в настройках может
           показывать прежний уровень. */
        if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('toof:difficulty'));
        }
        if (typeof UI !== 'undefined' && UI && typeof UI.start === 'function') UI.start('bot', { fixedFirst: true });
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
