'use strict';

/* ============================================================
   TOOF — константы, тексты и демонстрации фигур
   ============================================================ */

const VERSION = '0.3';
const BOARD_SIZE = 10;       // поле 10×10
const SECTOR_SIZE = 5;       // сектор 5×5
const SECTORS_TO_WIN = 3;    // нужно захватить 3 сектора из 4
const MAX_FIGURE = 6;        // максимальный размер фигуры

/* Пошаговое интерактивное объяснение: живёт в разделе «Правила». */
const RULES_STEPS = [
    {
        id: 'goal',
        title: '🎯 Цель игры',
        html: '<p>Захватить <b>3 из 4 секторов</b> поля. Поле 10×10 разделено на четыре сектора по 5×5.</p>' +
            '<p>Сектор считается захваченным игроком, если в нём есть хотя бы одна зафиксированная клетка его цвета.</p>'
    },
    {
        id: 'turn',
        title: '🕹 Ход игры',
        html: '<p>В свой ход игрок закрашивает любую свободную клетку своим цветом.</p>' +
            '<ul><li>Пока ход не подтверждён, закрашенную клетку можно передвинуть на другую свободную.</li>' +
            '<li>Затем игрок либо подтверждает ход, либо выделяет собранную фигуру и фиксирует её.</li>' +
            '<li>Фиксация тоже завершает ход — клетки блокируются и больше не участвуют в игре.</li></ul>'
    },
    {
        id: 'figures',
        title: '🧩 Фигуры',
        html: '<p>Линия из 4 клеток, четыре фигуры из 6 клеток и две смешанные фигуры 3+3 — в прямых и диагональных вариантах.</p>' +
            '<p>Смешанная фигура состоит из 3 ваших и 3 чужих клеток. Сектор приносит тот игрок, которому принадлежат три «угловые» клетки фигуры.</p>'
    },
    {
        id: 'combo',
        title: '🏆 Силу — в одной фигуре',
        html: '<p>Одна фигура может захватить сразу три сектора. Две фигуры — по два сектора каждый.</p>' +
            '<p>Сектор может принадлежать и обоим игрокам одновременно — это нормально, и это не проблема.</p>'
    },
    {
        id: 'final',
        title: '🎮 Готовы? Играть можно!',
        html: '<p>Соберите фигуру из символов, зафиксируйте её — и сектор ваш. Повторите три раза — и победите.</p>',
        final: true
    }
];

const DONATE_TEXT = `
<p>📖 <b>Прочитать книгу «Барскик против корпораций»</b> — <a href="https://author.today/work/689978" target="_blank" rel="noopener noreferrer">author.today</a></p>
<p>🚀 <b>Подписаться на группу автора про космос в Telegram</b> — <a href="https://t.me/industry_space" target="_blank" rel="noopener noreferrer">industry_space</a></p>
<p>💰 <b>Задонатить</b> — <span style="color:#888;">ссылка появится позже</span></p>`;

/*
   Демонстрации фигур для правил и памятки.
   cells: [строка, столбец, 'X' | 'O'] на сетке width × height.
   BASE_FIGURES — памятка в игре и первый ряд в правилах.
   DIAGONAL_FIGURES — только в правилах, отдельным рядом.
*/
const BASE_FIGURES = [
    {
        name: 'Линия',
        width: 4, height: 1,
        cells: [[0, 0, 'X'], [0, 1, 'X'], [0, 2, 'X'], [0, 3, 'X']]
    },
    {
        name: 'Машина',
        width: 3, height: 3,
        cells: [[0, 1, 'X'], [1, 0, 'X'], [1, 1, 'X'], [1, 2, 'X'], [2, 0, 'X'], [2, 2, 'X']]
    },
    {
        name: 'Стул',
        width: 3, height: 3,
        cells: [[0, 0, 'X'], [1, 0, 'X'], [1, 1, 'X'], [1, 2, 'X'], [2, 0, 'X'], [2, 2, 'X']]
    },
    {
        name: 'Смешанная',
        width: 3, height: 3,
        cells: [[0, 1, 'X'], [1, 0, 'O'], [1, 1, 'O'], [1, 2, 'O'], [2, 0, 'X'], [2, 2, 'X']]
    }
];

const DIAGONAL_FIGURES = [
    {
        name: '',
        width: 4, height: 4,
        cells: [[0, 0, 'X'], [1, 1, 'X'], [2, 2, 'X'], [3, 3, 'X']]
    },
    {
        name: '',
        width: 4, height: 4,
        cells: [[0, 0, 'X'], [0, 2, 'X'], [1, 1, 'X'], [1, 3, 'X'], [2, 0, 'X'], [3, 1, 'X']]
    },
    {
        name: '',
        width: 5, height: 4,
        cells: [[0, 3, 'X'], [1, 0, 'X'], [1, 2, 'X'], [1, 4, 'X'], [2, 1, 'X'], [3, 2, 'X']]
    },
    {
        name: '',
        width: 4, height: 4,
        cells: [[0, 0, 'X'], [0, 2, 'O'], [1, 1, 'O'], [1, 3, 'X'], [2, 0, 'O'], [3, 1, 'X']]
    }
];
```

Wait — original BASE_FIGURES 'Стул' cells: [[0,0],[1,0],[1,1],[1,2],[2,0],[2,2]] — I wrote that. And 'Смешанная'. OK.

Now tutorial.js.

Then edits.

Let me also double-check: `js/main.js` still uses `figureCards(BASE_FIGURES)` for cheat sheet — yes, keep that line.

Proceed with tool calls.</think>Каркас интерактивного раздела уже подобран. Теперь создаю движок туториала и правлю тексты/разметку.<tool_call>write<arg_key>content</arg_key><arg_value>'use strict';

/* ============================================================
   TOOF — интерактивное объяснение правил (раздел «Правила»).
   Пошаговый сценарий: цель → ход → фигуры → комбинации → действие.
   Каждый шаг плавно въезжает (tutorial-in), финальный шаг несёт
   кнопку перехода к игре с ботом на лёгком режиме.
   ============================================================ */

const Tutorial = (() => {
    let index = 0;
    let box = null;

    function steps() { return RULES_STEPS; }
    function isLast() { return index >= steps().length - 1; }

    function render() {
        const current = steps()[index];
        let html = '<div class="tutorial-step" data-tutorial-step="' + current.id + '">';
        html += '<h3 class="tutorial-title">' + current.title + '</h3>';
        html += '<div class="tutorial-text">' + current.html + '</div>';
        html += '</div>';

        const finalAction = document.getElementById('tutorialFinal');
        const finalButton = document.getElementById('tutorialPlayBot');
        if (finalAction) finalAction.hidden = !isLast();
        if (finalButton) finalButton.hidden = !isLast();

        if (!isLast()) {
            html += '<div class="tutorial-nav">';
            html += '<button class="btn tutorial-btn" id="tutorialPrev" type="button"' + (index > 0 ? '' : ' hidden') + '>← Назад</button>';
            html += '<button class="btn btn-primary tutorial-btn" id="tutorialNext" type="button">Далее →</button>';
            html += '</div>';
            html += '<div class="tutorial-dots">';
            steps().forEach((s, i) => {
                html += '<span class="tutorial-dot' + (i === index ? ' is-active' : '') + '" data-tutorial-index="' + i + '"></span>';
            });
            html += '</div>';
        }

        box.innerHTML = html;
    }

    function next() {
        if (isLast()) return;
        index += 1;
        render();
    }

    function prev() {
        if (index > 0) {
            index -= 1;
            render();
        }
    }

    function play() {
        const finalAction = document.getElementById('tutorialFinal');
        const finalButton = document.getElementById('tutorialPlayBot');
        if (finalAction) finalAction.hidden = true;
        if (finalButton) finalButton.hidden = true;
        if (typeof Bot !== 'undefined' && Bot && typeof Bot.setLevel === 'function') Bot.setLevel(1);
        if (typeof UI !== 'undefined' && UI && typeof UI.start === 'function') UI.start('bot');
        if (box) box.innerHTML = '';
        index = 0;
    }

    function start(container) {
        box = container || document.getElementById('rulesText');
        index = 0;
        render();
        if (box) {
            if (box.dataset.tutorialBound) return box;
            box.dataset.tutorialBound = '1';
            box.addEventListener('click', event => {
                const button = event.target.closest('button');
                if (!button) return;
                if (button.id === 'tutorialNext') { next(); return; }
                if (button.id === 'tutorialPrev') { prev(); return; }
                if (button.id === 'tutorialPlayBot') { play(); return; }
            });
        }
        return box;
    }

    return { start, stop: () => { index = 0; }, render, next, prev, isLast, play };
})();
