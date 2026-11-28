'use strict';

/* ============================================================
   TOOF — константы, тексты и демонстрации фигур
   ============================================================ */

const VERSION = '1.0.2';
const BOARD_SIZE = 10;       // поле 10×10
const SECTOR_SIZE = 5;       // сектор 5×5
const SECTORS_TO_WIN = 3;    // нужно захватить 3 сектора из 4
const MAX_FIGURE = 6;        // максимальный размер фигуры

/* Сценарий анимированного рассказа в разделе «Правила».
   Шаги идут один за другим автоматически: анимация замирает на
   паузу для чтения, затем сама переходит к следующему шагу. */
const RULES_STORY = [
    {
        id: 'field',
        title: '',
        caption: 'Вот игровое поле.',
        html: '<p>Поле 10×10 разделено светлыми линиями на четыре зоны — секторы.</p>',
        hold: 15000
    },
    {
        id: 'goal',
        title: '🎯 Цель игры',
        caption: 'Нужно захватить три из четырёх секторов.',
        html: '<p>Сектор считается захваченным игроком, если в нём есть хотя бы одна зафиксированная клетка его цвета.</p>',
        delay: 0,
        hold: 15000
    },
    {
        id: 'place',
        title: '🕹 Твой ход',
        caption: 'Закрашиваешь клетку — это твой цвет.',
        html: '<p>В свой ход ты закрашиваешь любую свободную клетку. Игроки ходят по очереди.</p>',
        delay: 2000,
        clear: ['sectors'],
        hold: 15000
    },
    {
        id: 'move',
        title: '↔️ Перестановка',
        caption: 'Пока ход не подтверждён, клетку можно переставить.',
        html: '<p>Нажми на другую клетку поля — заливка перейдёт туда. Когда разберёшься, нажми вне поля, чтобы продолжить.</p>',
        hold: 15000
    },
    {
        id: 'figure',
        title: '🧩 Сборка фигуры',
        caption: 'Клетки складываются в фигуру.',
        html: '<p>Когда нужные клетки стоят рядом, они образуют фигуру. Её можно зафиксировать и получить сектор. Какие фигуры бывают — покажем в конце.</p>',
        clear: ['pending'],
        hold: 15000
    },
    {
        id: 'select',
        title: '🖱 Выделение фигуры',
        caption: 'Выдели клетки фигуры.',
        html: '<p>Нажми на каждую клетку фигуры, чтобы выделить её. Когда все будут выделены, появится кнопка подтверждения.</p>',
        hold: 15000
    },
    {
        id: 'capture',
        title: '🏆 Захват секторов',
        caption: 'Фиксируешь фигуру — сектор твой.',
        html: '<p>Фигура блокируется, её клетки больше не участвуют в игре. Оранжевая и фиолетовая фигуры могут захватить один и тот же сектор — это нормально.</p>',
        delay: 0,
        clear: ['selected'],
        hold: 15000
    },
    {
        id: 'span',
        title: '🧭 Сколько секторов сразу?',
        caption: 'Одна фигура — два или три сектора.',
        html: '<p>Одна фигура может захватить сразу два или три сектора — зависит от того, где ты её поставишь. Смотри, как меняется подсветка.</p>',
        clear: ['all'],
        hold: 15000
    },
    {
        id: 'gallery',
        title: '🧩 Все фигуры',
        caption: 'Вот что можно собрать. Ориентированы фигуры могут быть как угодно.',
        html: '<p>Базовые и диагональные фигуры. Смешанная состоит из трёх твоих и трёх чужих клеток.</p>',
        clear: ['board'],
        delay: 0,
        hold: 15000
    },
    {
        id: 'final',
        title: '🎮 Готов к игре?',
        caption: 'Три сектора — и ты победил.',
        html: '<p>Кнопка ниже запустит игру с ботом на элементарном режиме.</p>',
        final: true
    }
];

const RULES_STORY_EN = [
    { id: 'field', title: '', caption: 'Here is the board.',
      html: '<p>The 10×10 board is split by light lines into four zones — sectors.</p>', hold: 15000 },
    { id: 'goal', title: '🎯 Goal', caption: 'Capture three of the four sectors.',
      html: '<p>A sector belongs to a player if it contains at least one fixed cell of their colour.</p>', delay: 0, hold: 15000 },
    { id: 'place', title: '🕹 Your turn', caption: 'Paint a cell — it becomes your colour.',
      html: '<p>On your turn, paint any empty cell. Players alternate turns.</p>', delay: 2000, clear: ['sectors'], hold: 15000 },
    { id: 'move', title: '↔️ Reposition', caption: 'Move the cell until the turn is confirmed.',
      html: '<p>Tap another cell — the paint moves there. When ready, tap outside the board to continue.</p>', hold: 15000 },
    { id: 'figure', title: '🧩 Building a figure', caption: 'Cells combine into a figure.',
      html: '<p>When the right cells sit together, they form a figure. Fix it to claim a sector. All figure types are shown at the end.</p>', clear: ['pending'], hold: 15000 },
    { id: 'select', title: '🖱 Selecting', caption: 'Select the figure cells.',
      html: '<p>Tap each figure cell to select it. When all are selected, a confirm button appears.</p>', hold: 15000 },
    { id: 'capture', title: '🏆 Capturing sectors', caption: 'Fix a figure — the sector is yours.',
      html: '<p>The figure is locked; its cells leave play. Orange and purple figures can capture the same sector — that is fine.</p>', delay: 0, clear: ['selected'], hold: 15000 },
    { id: 'span', title: '🧭 Several sectors at once?', caption: 'One figure — two or three sectors.',
      html: '<p>One figure can capture two or three sectors at once, depending on where you place it. Watch the highlight change.</p>', clear: ['all'], hold: 15000 },
    { id: 'gallery', title: '🧩 All figures', caption: 'Here is what you can build. Figures may be rotated any way.',
      html: '<p>Basic and diagonal figures. A mixed one uses three of your cells and three of your opponent’s.</p>', clear: ['board'], delay: 0, hold: 15000 },
    { id: 'final', title: '🎮 Ready to play?', caption: 'Three sectors — and you win.',
      html: '<p>The button below starts a game against the bot on elementary mode.</p>', final: true }
];

const DONATE_TEXT = `
<p>📖 <b>Прочитать книгу «Барскик против корпораций»</b> — <a href="https://author.today/work/689978" target="_blank" rel="noopener noreferrer">author.today</a></p>
<p>🚀 <b>Подписаться на группу автора про космос в Telegram</b> — <a href="https://t.me/industry_space" target="_blank" rel="noopener noreferrer">industry_space</a></p>
<p>💰 <b>Задонатить</b> — <span style="color:#888;">ссылка появится позже</span></p>`;

const DONATE_TEXT_EN = `
<p>📖 <b>Read the book “Barskik vs. Corporations”</b> — <a href="https://author.today/work/689978" target="_blank" rel="noopener noreferrer">author.today</a></p>
<p>🚀 <b>Follow the author’s space Telegram channel</b> — <a href="https://t.me/industry_space" target="_blank" rel="noopener noreferrer">industry_space</a></p>
<p>💰 <b>Donate</b> — <span style="color:#888;">link coming soon</span></p>`;

/*
   Демонстрации фигур для правил и памятки.
   cells: [строка, столбец, 'X' | 'O'] на сетке width × height.
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
