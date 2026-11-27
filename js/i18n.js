'use strict';

/* ============================================================
   TOOF — минимальный слой локализации RU/EN.
   Статическая разметка переводится один раз при загрузке,
   динамические строки — вызовом t('русский текст').
   Выбор языка хранится в localStorage и применяется после reload.
   ============================================================ */

const I18N = (() => {
    const STORAGE_KEY = 'toof_lang';

    const dict = {
        /* Главное меню и общие кнопки */
        'Главное меню': 'Main menu',
        '🌐 По сети': '🌐 Online',
        '🤖 Против бота': '🤖 vs Bot',
        '🎮 На одном экране': '🎮 Same device',
        '↩ Вернуться в игру': '↩ Resume game',
        '📖 Правила': '📖 Rules',
        '💛 Поддержать автора': '💛 Support the author',
        'Звук': 'Sound',
        'Звук включён': 'Sound on',
        'Звук выключен': 'Sound off',
        'Сменить язык': 'Switch language',
        '← Назад в меню': '← Back to menu',
        '← Назад': '← Back',
        'Продолжить': 'Continue',
        'Готово': 'Done',
        'Отменить': 'Cancel',
        'Принять': 'Accept',
        'Отклонить': 'Decline',
        'Скопировать': 'Copy',
        'Скопировано': 'Copied',
        'Новая игра': 'New game',
        'Понятно': 'Got it',
        'Войти': 'Join',
        'Добавить': 'Add',
        'Игрок': 'Player',
        'Игрок 1': 'Player 1',
        'Игрок 2': 'Player 2',
        'Вы': 'You',
        'Выделение снято.': 'Selection cleared.',
        'В фигуре не больше {n} клеток.': 'A figure can have at most {n} cells.',
        'Выделено {n} {word}.': 'Selected {n} {word}.',
        'Бот': 'Bot',
        'Соперник': 'Opponent',
        'Друг': 'Friend',
        'Хозяин': 'Host',
        'Гость': 'Guest',
        'Для игры нужен включённый JavaScript.': 'JavaScript must be enabled to play.',
        'Игровое поле 10 на 10': 'Game board 10 by 10',
        'Памятка по фигурам': 'Figure cheat sheet',
        'Сложность бота': 'Bot difficulty',
        'Простой': 'Easy',
        'Средний': 'Medium',
        'Опытный': 'Skilled',

        /* Игровой экран */
        '🔒 Подтвердить фигуру': '🔒 Fix figure',
        '✅ Подтвердить ход': '✅ Confirm move',
        '🔄 Реванш': '🔄 Rematch',
        '🏳 Сдаться': '🏳 Surrender',
        '⟳ Новая игра': '⟳ New game',
        '🏠 Меню': '🏠 Menu',
        'Меню': 'Menu',
        'Смена игрока': 'Player change',
        'Сменить сложность?': 'Change difficulty?',
        '🤝 Ничья': '🤝 Draw',
        'Ход: ': 'Turn: ',
        'клетка': 'cell',
        'клетки': 'cells',
        'клеток': 'cells',
        'оранжевая': 'orange',
        'фиолетовая': 'purple',
        'пусто': 'empty',
        ', зафиксировано': ', fixed',
        ', выделено': ', selected',
        ', строка ': ', row ',
        ', столбец ': ', column ',
        'Против бота · ': 'vs Bot · ',
        'По сети · против ': 'Online · vs ',
        'На одном экране': 'Same device',
        'Ждём, пока друг примет приглашение…': 'Waiting for your friend to accept…',
        'Соперник вышел из игры.': 'Your opponent left the game.',
        'Соперник предлагает реванш.': 'Your opponent offers a rematch.',
        'Отправляем ход…': 'Sending move…',
        'Вы победили! 🎉': 'You won! 🎉',
        'Ничья — свободных клеток не осталось.': 'Draw — no empty cells left.',
        'Бот победил. Попробуйте ещё раз.': 'The bot won. Try again.',
        ' победил! 🎉': ' won! 🎉',
        'Победил ': 'Winner: ',
        ' Сложность повышена: ': ' Difficulty increased: ',
        ' Сложность снижена: ': ' Difficulty decreased: ',
        'Бот думает…': 'Bot is thinking…',
        'Бот зафиксировал фигуру. Ваш ход.': 'The bot fixed a figure. Your turn.',
        'Ваш ход.': 'Your turn.',
        'Клетка закрашена. Подтвердите ход или выделите фигуру.': 'Cell painted. Confirm the move or select a figure.',
        'Сначала закрасьте клетку.': 'Paint a cell first.',
        'Неправильная фигура.': 'Not a valid figure.',
        'Эта клетка уже занята.': 'This cell is already taken.',
        'Сейчас не ваш ход.': 'It is not your turn.',
        'Игра уже закончена.': 'The game is over.',
        'Так ходить нельзя.': 'That move is not allowed.',
        'Не получилось зафиксировать фигуру.': 'Could not fix the figure.',
        'Не удалось отправить ход. Проверьте соединение.': 'Could not send the move. Check your connection.',
        'Фигура зафиксирована. Ход переходит к ': 'Figure fixed. Turn passes to ',
        'Ход передан. Ходит ': 'Move confirmed. Now playing: ',
        'Вы ходите первым (оранжевым).': 'You move first (orange).',
        'Первым ходит оранжевый — Игрок 1.': 'Orange moves first — Player 1.',
        'Приглашение отправлено. Ждём друга…': 'Invitation sent. Waiting for your friend…',
        'Вы играете ': 'You play ',
        'оранжевым': 'orange',
        'фиолетовым': 'purple',
        'Не удалось связаться с соперником.': 'Could not reach your opponent.',
        'Сеть: ': 'Network: ',
        ' приглашает в игру': ' invites you to play',

        /* Онлайн-экраны */
        '🌐 Игра по сети': '🌐 Online play',
        'Играйте с другом по ссылке или найдите случайного соперника.': 'Play a friend by link or find a random opponent.',
        'Вас приглашают:': 'Invitations:',
        '🎲 Случайный противник': '🎲 Random opponent',
        '🔗 Игра с другом по ссылке': '🔗 Play a friend by link',
        '📇 Друзья': '📇 Friends',
        '⌨ Ввести код': '⌨ Enter code',
        '👤 Профиль': '👤 Profile',
        'Онлайн ещё не настроен': 'Online is not set up yet',
        '🎲 Ищем соперника…': '🎲 Finding an opponent…',
        'Обычно это занимает несколько секунд.': 'This usually takes a few seconds.',
        'Имя': 'Name',
        'Код профиля:': 'Profile code:',
        'Код профиля: ': 'Profile code: ',
        'Войти через Google': 'Sign in with Google',
        'Выйти из аккаунта': 'Sign out',
        'Без входа профиль, друзья и статистика живут только в этом браузере. После входа — на всех устройствах.': 'Without signing in, your profile, friends and stats live only in this browser. After signing in — on all devices.',
        'Код друга': 'Friend code',
        '⌨ Войти по коду': '⌨ Join by code',
        'Например, ABC123': 'For example, ABC123',
        '🔗 Комната создана': '🔗 Room created',
        'Отправьте другу код или ссылку:': 'Send your friend the code or link:',
        'Скопировать ссылку': 'Copy link',
        'Ждём, пока друг войдёт…': 'Waiting for your friend to join…',
        '📖 Правила игры': '📖 Game rules',
        '🤖 Играть с ботом на лёгком режиме': '🤖 Play the bot on easy mode',
        'Обычные фигуры': 'Basic figures',
        'Диагональные фигуры': 'Diagonal figures',
        'Линия': 'Line',
        'Машина': 'Machine',
        'Стул': 'Chair',
        'Смешанная': 'Mixed',
        'Либо через 15 секунд объяснение продолжится автоматически': 'Or the explanation will continue automatically after 15 seconds',
        'Два сектора — одна фигура.': 'Two sectors — one figure.',
        'Три сектора — та же фигура.': 'Three sectors — same figure.',

        /* Подсказки и ошибки онлайна */
        'Firebase ещё не подключён. Откройте js/firebase-config.js и вставьте данные проекта из Firebase Console. Пошаговая инструкция — в README.md.': 'Firebase is not connected yet. Open js/firebase-config.js and paste your project data from Firebase Console. See README.md for step-by-step instructions.',
        'Не удалось загрузить Firebase SDK. Проверьте интернет и обновите страницу.': 'Could not load the Firebase SDK. Check your connection and reload.',
        'Firebase не смог запуститься. Проверьте настройки проекта и правила Firestore.': 'Firebase failed to start. Check your project settings and Firestore rules.',
        'Профиль ещё загружается. Подождите секунду и попробуйте снова.': 'Profile is still loading. Wait a second and try again.',
        'Онлайн сейчас недоступен. Локальные режимы продолжают работать.': 'Online is unavailable right now. Local modes still work.',
        'Загружаем профиль…': 'Loading profile…',
        'Онлайн не настроен: доступны игра против бота и на одном экране.': 'Online is not set up: bot and same-device modes are available.',
        'Профиль хранится только в этом браузере.': 'Profile is stored only in this browser.',
        'Онлайн не настроен. Профиль хранится только в этом браузере.': 'Online is not set up. Profile is stored only in this browser.',
        'приглашает в игру': 'invites you to play',
        'Имя сохранено': 'Name saved',
        'Готово! Профиль синхронизирован.': 'Done! Profile synced.',
        'ошибка входа': 'sign-in error',
        'Вы вышли из аккаунта.': 'You have signed out.',
        'Не удалось выйти: ': 'Could not sign out: ',
        'ошибка': 'error',
        'Не удалось вернуться в игру: ': 'Could not resume the game: ',
        'Вы: ': 'You: ',
        ' · ': ' · ',
        'аккаунт Google': 'Google account',
        'анонимный профиль этого браузера': 'anonymous profile of this browser',
        ' · победы ': ' · wins ',
        ', поражения ': ', losses ',
        ', ничьи ': ', draws ',
        'Вы: {name} · {mode} · победы {wins}, поражения {losses}, ничьи {draws}': 'You: {name} · {mode} · wins {wins}, losses {losses}, draws {draws}',
        'Профиль синхронизируется между устройствами через Google.': 'Profile syncs across devices via Google.',
        'Профиль привязан к этому браузеру. Войдите через Google, чтобы играть с того же аккаунта на других устройствах.': 'Profile is tied to this browser. Sign in with Google to use the same account on other devices.',
        'В сети': 'Online',
        'Не в сети': 'Offline',
        'Код: ': 'Code: ',
        'Вызвать': 'Challenge',
        'Удалить из друзей': 'Remove friend',
        'хочет добавить вас в друзья': 'wants to add you as a friend',
        'Заявки в друзья:': 'Friend requests:',
        'Пока никого нет. Добавьте друга по его коду профиля.': 'Nobody here yet. Add a friend by profile code.',
        'Нажмите «Вызвать», чтобы отправить приглашение. Друг увидит его, когда откроет игру.': 'Press "Challenge" to send an invitation. Your friend will see it when they open the game.',
        'Сначала завершите или покиньте текущую игру.': 'Finish or leave the current game first.',
        'Соперник не найден. Попробуйте ещё раз через минуту.': 'No opponent found. Try again in a minute.',
        'Не удалось найти игру: ': 'Could not find a game: ',
        'ошибка сети': 'network error',
        'Не удалось создать комнату: ': 'Could not create a room: ',
        'Введите код комнаты.': 'Enter the room code.',
        'Не удалось войти: ': 'Could not join: ',
        'проверьте код': 'check the code',
        'Введите код друга.': 'Enter your friend’s code.',
        'Этот игрок уже у вас в друзьях.': 'This player is already your friend.',
        'Заявка отправлена.': 'Request sent.',
        'Не удалось отправить заявку': 'Could not send the request',
        'Не удалось удалить друга': 'Could not remove the friend',
        'Не удалось принять заявку': 'Could not accept the request',
        'Не удалось отклонить заявку': 'Could not decline the request',
        'Не удалось вызвать друга': 'Could not challenge your friend',
        'Не удалось принять приглашение': 'Could not accept the invitation',
        'Не удалось отклонить приглашение': 'Could not decline the invitation',
        'Новая сложность — ': 'New difficulty — ',
        '. Начать игру заново?': '. Start a new game?',
        'Новая сложность — {level}. Начать игру заново?': 'New difficulty — {level}. Start a new game?',
        'Firebase не настроен': 'Firebase is not configured',
        'Игра не найдена': 'Game not found',
        'Игра уже не активна': 'Game is no longer active',
        'Сейчас не ваш ход': 'It is not your turn',
        'Ход устарел, обновите партию': 'Move is outdated, refresh the game',
        'Онлайн не настроен': 'Online is not configured',
        'Вы не участник этой игры': 'You are not part of this game',
        'Друг не найден': 'Friend not found',
        'Нельзя вызвать себя': 'You cannot challenge yourself',
        'Нельзя добавить себя': 'You cannot add yourself',
        'Игрок с таким кодом не найден': 'No player with this code',
        'Это ваш собственный код': 'This is your own code',
        'Комната не найдена': 'Room not found',
        'Комната уже занята': 'Room is already taken',
        'Это ваша комната': 'This is your room',
        'Быстрый': 'Quick', 'Хитрый': 'Sly', 'Тихий': 'Quiet', 'Смелый': 'Bold',
        'Умный': 'Clever', 'Ловкий': 'Nimble', 'Ясный': 'Bright', 'Дикий': 'Wild',
        'Лис': 'Fox', 'Кот': 'Cat', 'Волк': 'Wolf', 'Сокол': 'Falcon',
        'Ёж': 'Hedgehog', 'Барс': 'Leopard', 'Кит': 'Whale', 'Ворон': 'Raven'
    };

    let lang = 'ru';
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'en' || saved === 'ru') lang = saved;
    } catch (e) { /* localStorage недоступен */ }

    function t(text, args) {
        const value = lang === 'en' ? (dict[text] || text) : text;
        if (!args) return value;
        return value.replace(/\{(\w+)\}/g, (_, k) =>
            args[k] === undefined || args[k] === null ? '' : String(args[k]));
    }

    const savedText = [];
    const savedAttrs = [];

    function restore() {
        for (const entry of savedText) {
            entry.node.nodeValue = entry.original;
            delete entry.node.__i18nDone;
        }
        savedText.length = 0;
        for (const entry of savedAttrs) {
            entry.el.setAttribute(entry.attr, entry.original);
            delete entry.el.__i18nAttrs;
        }
        savedAttrs.length = 0;
    }

    function apply(root) {
        if (!root || lang !== 'en') return;
        const skip = node => {
            const el = node.parentElement;
            return !!el && !!el.closest('script, style, noscript, [data-i18n-skip]');
        };
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            if (skip(node)) continue;
            const raw = node.nodeValue;
            const key = raw.trim();
            if (!key || !dict[key]) continue;
            if (!node.__i18nDone) {
                savedText.push({ node, original: raw });
                node.__i18nDone = true;
            }
            node.nodeValue = raw.replace(key, dict[key]);
        }
        root.querySelectorAll('[title], [placeholder], [aria-label]').forEach(el => {
            if (!el.__i18nAttrs) el.__i18nAttrs = {};
            for (const attr of ['title', 'placeholder', 'aria-label']) {
                const value = el.getAttribute(attr);
                if (!value || !dict[value]) continue;
                if (!(attr in el.__i18nAttrs)) {
                    el.__i18nAttrs[attr] = value;
                    savedAttrs.push({ el, attr, original: value });
                }
                el.setAttribute(attr, dict[value]);
            }
        });
    }

    /* Смена языка без перезагрузки: position кнопок не двигается, меняется только текст. */
    function set(next) {
        if (next !== 'ru' && next !== 'en') return;
        restore();
        lang = next;
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
        document.documentElement.lang = next;
        apply(document);
        const button = document.getElementById('langToggle');
        if (button) {
            button.textContent = next === 'ru' ? 'RU' : 'EN';
            button.title = next === 'ru' ? 'Switch to English' : 'Переключить на русский';
            button.setAttribute('aria-label', button.title);
        }
        if (typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('toof:lang'));
        }
    }

    function init() {
        document.documentElement.lang = lang;
        apply(document);
        const button = document.getElementById('langToggle');
        if (button) {
            button.textContent = lang === 'ru' ? 'RU' : 'EN';
            button.title = lang === 'ru' ? 'Switch to English' : 'Переключить на русский';
            button.setAttribute('aria-label', button.title);
            button.addEventListener('click', () => {
                if (typeof Sound !== 'undefined' && Sound.play) Sound.play('click');
                set(lang === 'ru' ? 'en' : 'ru');
            });
        }
        document.documentElement.classList.remove('lang-pending');
    }

    /* Скрипт подключён в конце body: применяем перевод сразу, до первого
       отрисовки, иначе на английском языке сначала мелькает русский текст. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        get lang() { return lang; },
        t, apply, restore, set, dict
    };
})();

const t = (text, args) => I18N.t(text, args);
