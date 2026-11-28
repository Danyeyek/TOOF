'use strict';

/* ============================================================
   Точка входа: разметка правил, памятка, меню, настройки
   и вся обвязка онлайна (профиль, друзья, лобби).
   ============================================================ */

const $ = id => document.getElementById(id);

let activeGameId = null;
let activeGame = null;
let confirmAction = null;
let currentRoomCode = null;
let noticeTimer = null;
let rankBannerTimer = null;
let randomCancelled = false;
let onlineKey = '';

function figureDemo(sheet) {
    let cells = '';
    for (let r = 0; r < sheet.height; r++) {
        for (let c = 0; c < sheet.width; c++) {
            const found = sheet.cells.find(cell => cell[0] === r && cell[1] === c);
            const symbol = found ? found[2] : '';
            cells += '<i class="' + (symbol === 'X' ? 'x' : symbol === 'O' ? 'o' : '') + '"></i>';
        }
    }
    return '<div class="demo" style="--w:' + sheet.width + ';--h:' + sheet.height + '">' + cells + '</div>';
}

function figureCards(sheets) {
    return '<div class="cards">' + sheets.map(sheet => {
        const label = sheet.name ? '<figcaption>' + t(sheet.name) + '</figcaption>' : '';
        return '<figure class="card">' + label + figureDemo(sheet) + '</figure>';
    }).join('') + '</div>';
}

function renderRank() {
    const rank = Bot.rankName();
    const label = rank ? rankLabel(rank) : '';
    const line = $('rankLine');
    if (line) line.textContent = t('Ранг: ') + (label || t('—'));
    const menuRank = $('menuRank');
    if (menuRank) menuRank.textContent = label;
}

/* Короткая плашка поверх интерфейса: появляется и сама уходит. */
function showRankBanner(rank, prefix) {
    const banner = $('rankBanner');
    if (!banner || !rank) return;
    banner.textContent = (prefix || t('Новый ранг: ')) + rankLabel(rank);
    banner.hidden = false;
    /* Перезапуск анимации при повторном повышении. */
    banner.style.animation = 'none';
    void banner.offsetWidth;
    banner.style.animation = '';
    clearTimeout(rankBannerTimer);
    rankBannerTimer = setTimeout(() => { banner.hidden = true; }, 2400);
}

function renderDifficulty() {
    const list = $('difficultyList');
    if (!list) return;
    list.innerHTML = '';
    Bot.LEVELS.forEach(level => {
        const active = level.id === Bot.level;
        const locked = !Bot.isLevelUnlocked(level.id);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'difficulty-option' + (active ? ' is-active' : '');
        button.dataset.level = String(level.id);
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(active));
        button.disabled = locked;
        button.textContent = locked ? '🔒 ' + t(level.name) : t(level.name);
        if (locked) button.title = t('Дойдите до этого режима серией побед');
        list.appendChild(button);
    });
}

function chooseDifficulty(requested) {
    if (!Bot.isLevelUnlocked(requested)) return;
    const previous = Bot.level;
    Sound.play('click');

    const popover = $('settingsPopover');
    if (popover) popover.hidden = true;
    const button = $('settingsButton');
    if (button) {
        button.setAttribute('aria-expanded', 'false');
        button.blur();
    }

    if (requested === previous) return;

    Bot.setLevel(requested);
    renderDifficulty();

    /* До первого хода меняем уровень на месте, не перезапуская партию.
       После игры (и в середине партии) сразу начинаем новую игру. */
    if (UI.canChangeDifficulty() && !Game.over) {
        UI.render();
        return;
    }
    UI.start('bot');
}

/* Старое или вручную подправленное сохранение может содержать закрытый
   уровень — load() проверяет только диапазон 1..7. Возвращаем доступному. */
function clampBotLevel() {
    if (!Bot.isLevelUnlocked(Bot.level)) {
        Bot.applyLevel(Bot.maxUnlockedLevel());
        Bot.save();
    }
}

function updateSoundButtons() {
    const on = Sound.isOn();
    ['soundToggleMenu', 'soundToggleGame'].forEach(id => {
        const button = $(id);
        button.textContent = on ? '🔊' : '🔇';
        button.setAttribute('aria-pressed', String(on));
        button.title = t(on ? 'Звук включён' : 'Звук выключен');
    });
}

function toggleSound() {
    const on = Sound.toggle();
    updateSoundButtons();
    if (on) Sound.play('click');
}

/* ---------- Мелкие помощники интерфейса ---------- */

function notify(text) {
    const box = $('notice');
    if (!box) return;
    box.textContent = t(text);
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

/* Явное подтверждение для действий, которые незаметно меняют партию
   (возврат в игру, вход по ссылке извне). */
function askConfirm(title, text, onYes, args) {
    const box = $('confirmOverlay');
    if (!box || !$('confirmYes') || !$('confirmNo')) {
        onYes();
        return;
    }
    $('confirmTitle').textContent = t(title);
    $('confirmText').textContent = t(text, args);
    confirmAction = onYes;
    box.hidden = false;
}

function closeConfirm() {
    const box = $('confirmOverlay');
    if (box) box.hidden = true;
    confirmAction = null;
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => {
            notify('Скопировано');
        }).catch(() => {
            notify(text);
        });
    }
    notify(text);
    return Promise.resolve();
}

function setupReason() {
    if (!Net.isConfigured()) return 'not-configured';
    return Net.reason || 'not-ready';
}

function showOnlineSetup() {
    const reason = setupReason();
    const text = $('netSetupText');
    if (text) {
        if (reason === 'not-configured') {
            text.textContent = t('Firebase ещё не подключён. Откройте js/firebase-config.js и вставьте данные проекта из Firebase Console. Пошаговая инструкция — в README.md.');
        } else if (reason === 'sdk-missing') {
            text.textContent = t('Не удалось загрузить Firebase SDK. Проверьте интернет и обновите страницу.');
        } else if (reason === 'init-failed') {
            text.textContent = t('Firebase не смог запуститься. Проверьте настройки проекта и правила Firestore.');
        } else if (Net.ready && !Profile.state.uid) {
            text.textContent = t('Профиль ещё загружается. Подождите секунду и попробуйте снова.');
        } else {
            text.textContent = t('Онлайн сейчас недоступен. Локальные режимы продолжают работать.');
        }
    }
    $('netSetup').hidden = false;
}

function requireOnline() {
    if (Net.ready && Profile.state.uid) return true;
    showOnlineSetup();
    return false;
}

function updateAccountHint() {
    const profile = Profile.state;
    const hint = $('onlineAccountHint');
    const modeHint = $('profileModeHint');

    if (!profile.ready) {
        if (hint) hint.textContent = t('Загружаем профиль…');
        return;
    }

    if (!Net.ready) {
        if (hint) hint.textContent = t('Онлайн не настроен: доступны игра против бота и на одном экране.');
        if (modeHint) modeHint.textContent = t('Онлайн не настроен. Профиль хранится только в этом браузере.');
        return;
    }

    if (hint) {
        const mode = t(profile.registered ? 'аккаунт Google' : 'анонимный профиль этого браузера');
        hint.textContent = t('Вы: {name} · {mode} · ранг {rank} · победы {wins}, поражения {losses}, ничьи {draws}', {
            name: profile.name, mode,
            rank: profile.rank || '—',
            wins: profile.stats.wins, losses: profile.stats.losses, draws: profile.stats.draws
        });
    }
    if (modeHint) {
        modeHint.textContent = t(profile.registered
            ? 'Профиль синхронизируется между устройствами через Google.'
            : 'Профиль привязан к этому браузеру. Войдите через Google, чтобы играть с того же аккаунта на других устройствах.');
    }
}

function renderProfile() {
    const profile = Profile.state;
    const nameInput = $('profileNameInput');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = profile.name;

    const code = $('profileCode');
    if (code) code.textContent = profile.code || '—';

    const google = $('googleBtn');
    if (google) {
        google.hidden = !Net.ready || profile.registered;
        google.textContent = t('Войти через Google');
    }

    const signOut = $('signOutBtn');
    if (signOut) signOut.hidden = !profile.registered;

    updateAccountHint();
}

function friendItem(friend) {
    const item = document.createElement('div');
    item.className = 'list-item';

    const dot = document.createElement('span');
    dot.className = 'presence' + (friend.online ? ' is-online' : '');
    dot.title = t(friend.online ? 'В сети' : 'Не в сети');

    const info = document.createElement('div');
    info.className = 'list-item__info';

    const name = document.createElement('b');
    name.textContent = friend.name || t('Игрок');

    const code = document.createElement('span');
    code.className = 'list-item__meta';
    code.textContent = friend.code ? t('Код: ') + friend.code : '';

    info.appendChild(name);
    info.appendChild(code);

    const challenge = document.createElement('button');
    challenge.className = 'btn btn-primary btn-mini';
    challenge.type = 'button';
    challenge.textContent = t('Вызвать');
    /* Приглашение сохраняется в Firestore, поэтому можно вызывать
       и не онлайн-друга — он увидит его при следующем открытии. */
    challenge.addEventListener('click', () => {
        Sound.play('click');
        challengeFriend(friend);
    });

    const remove = document.createElement('button');
    remove.className = 'btn btn-mini';
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = t('Удалить из друзей');
    remove.addEventListener('click', () => {
        Sound.play('click');
        Friends.remove(friend.uid).catch(error => notify(error.message || 'Не удалось удалить друга'));
    });

    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(challenge);
    item.appendChild(remove);
    return item;
}

function requestItem(request) {
    const item = document.createElement('div');
    item.className = 'list-item';

    const info = document.createElement('div');
    info.className = 'list-item__info';

    const name = document.createElement('b');
    name.textContent = request.fromName || t('Игрок');

    const code = document.createElement('span');
    code.className = 'list-item__meta';
    code.textContent = t('хочет добавить вас в друзья');

    info.appendChild(name);
    info.appendChild(code);

    const accept = document.createElement('button');
    accept.className = 'btn btn-primary btn-mini';
    accept.type = 'button';
    accept.textContent = t('Принять');
    accept.addEventListener('click', () => {
        Sound.play('click');
        Friends.accept(request).catch(error => notify(error.message || 'Не удалось принять заявку'));
    });

    const decline = document.createElement('button');
    decline.className = 'btn btn-mini';
    decline.type = 'button';
    decline.textContent = t('Отклонить');
    decline.addEventListener('click', () => {
        Sound.play('click');
        Friends.decline(request).catch(error => notify(error.message || 'Не удалось отклонить заявку'));
    });

    item.appendChild(info);
    item.appendChild(accept);
    item.appendChild(decline);
    return item;
}

function renderFriends(data) {
    const requests = $('friendRequests');
    const list = $('friendsList');
    if (!requests || !list) return;

    requests.innerHTML = '';
    list.innerHTML = '';

    const incoming = (data && data.incoming) || [];
    const friends = (data && data.friends) || [];

    if (incoming.length) {
        const title = document.createElement('p');
        title.className = 'hint';
        title.textContent = t('Заявки в друзья:');
        requests.appendChild(title);
        incoming.forEach(request => requests.appendChild(requestItem(request)));
    }

    if (!friends.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = t('Пока никого нет. Добавьте друга по его коду профиля.');
        list.appendChild(empty);
    } else {
        friends.forEach(friend => list.appendChild(friendItem(friend)));
    }

    const badge = $('friendsBadge');
    if (badge) {
        badge.textContent = String(incoming.length);
        badge.hidden = !incoming.length;
    }

    const hint = $('friendsHint');
    if (hint) {
        hint.textContent = friends.length
            ? t('Нажмите «Вызвать», чтобы отправить приглашение. Друг увидит его, когда откроет игру.')
            : '';
    }
}

async function leaveCurrentGame() {
    if (UI.hasOnlineSession()) {
        await Lobby.leave(UI.state.session);
    }
}

function inviteItem(invite) {
    const item = document.createElement('div');
    item.className = 'list-item';

    const info = document.createElement('div');
    info.className = 'list-item__info';

    const otherUid = (invite.players || []).find(uid => uid !== Profile.state.uid);
    const name = document.createElement('b');
    name.textContent = (invite.names && invite.names[otherUid]) || t('Друг');

    const meta = document.createElement('span');
    meta.className = 'list-item__meta';
    meta.textContent = t('приглашает в игру');

    info.appendChild(name);
    info.appendChild(meta);

    const accept = document.createElement('button');
    accept.className = 'btn btn-primary btn-mini';
    accept.type = 'button';
    accept.textContent = t('Принять');
    accept.addEventListener('click', () => {
        Sound.play('click');
        leaveCurrentGame()
            .then(() => Lobby.acceptInvite(invite))
            .catch(error => notify(error.message || 'Не удалось принять приглашение'));
    });

    const decline = document.createElement('button');
    decline.className = 'btn btn-mini';
    decline.type = 'button';
    decline.textContent = t('Отклонить');
    decline.addEventListener('click', () => {
        Sound.play('click');
        Lobby.declineInvite(invite).catch(error => notify(error.message || 'Не удалось отклонить приглашение'));
    });

    item.appendChild(info);
    item.appendChild(accept);
    item.appendChild(decline);
    return item;
}

function renderInvites() {
    const list = $('invitesList');
    const hint = $('invitesHint');
    if (!list) return;

    const invites = typeof Lobby !== 'undefined' ? Lobby.invites : [];
    list.innerHTML = '';

    if (!invites.length) {
        if (hint) hint.hidden = true;
        return;
    }

    if (hint) hint.hidden = false;
    invites.forEach(invite => list.appendChild(inviteItem(invite)));
}

async function challengeFriend(friend) {
    if (!requireOnline()) return;
    try {
        await leaveCurrentGame();
        await Lobby.challenge(friend);
    } catch (error) {
        notify(error.message || 'Не удалось вызвать друга');
    }
}

/* ---------- Действия онлайна ---------- */

async function startRandomSearch() {
    randomCancelled = false;
    if (!requireOnline()) return;
    if (UI.hasOnlineSession()) {
        notify('Сначала завершите или покиньте текущую игру.');
        return;
    }
    $('searchOverlay').hidden = false;
    try {
        const gameId = await Lobby.findRandom();
        if (!gameId && !randomCancelled) notify('Соперник не найден. Попробуйте ещё раз через минуту.');
    } catch (error) {
        notify('Не удалось найти игру: ' + (error.message || 'ошибка сети'));
    } finally {
        $('searchOverlay').hidden = true;
    }
}

async function createFriendRoom() {
    if (!requireOnline()) return;
    try {
        currentRoomCode = await Lobby.createFriendRoom();
        $('roomCode').textContent = currentRoomCode;
        UI.showScreen('roomScreen');
    } catch (error) {
        notify('Не удалось создать комнату: ' + (error.message || 'ошибка сети'));
    }
}

async function joinByCode(code) {
    if (!requireOnline()) return;
    if (UI.hasOnlineSession()) {
        notify('Сначала завершите или покиньте текущую игру.');
        return;
    }
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) {
        notify('Введите код комнаты.');
        return;
    }
    try {
        await Lobby.joinRoom(normalized);
    } catch (error) {
        notify('Не удалось войти: ' + (error.message || 'проверьте код'));
    }
}

async function addFriendByCode() {
    if (!requireOnline()) return;
    const input = $('friendCodeInput');
    const code = input ? input.value.trim() : '';
    if (!code) {
        notify('Введите код друга.');
        return;
    }
    try {
        const result = await Friends.addByCode(code);
        notify(result === 'already' ? 'Этот игрок уже у вас в друзьях.' : 'Заявка отправлена.');
        if (input) input.value = '';
    } catch (error) {
        notify(error.message || 'Не удалось отправить заявку');
    }
}

async function joinFromScreen() {
    const input = $('joinCodeInput');
    await joinByCode(input ? input.value : '');
}

function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (!room) return;
    UI.showScreen('onlineScreen');
    const code = String(room).trim().toUpperCase();
    askConfirm('Войти в комнату?', 'Код комнаты: {code}. Продолжить?',
        () => joinByCode(code), { code });
}

function restartOnlineServices() {
    if (!Net.ready || !Profile.state.uid) return;
    const key = Profile.state.uid + ':' + Profile.state.registered;
    if (key === onlineKey) return;
    onlineKey = key;

    Friends.stop();
    Friends.start();
    Lobby.stop();
    Lobby.start();
}

async function initOnline() {
    Net.init();
    updateAccountHint();

    try {
        await Profile.init();
    } catch (error) {
        updateAccountHint();
        return;
    }

    updateAccountHint();
    renderProfile();

    if (!Net.ready || !Profile.state.uid) return;

    Friends.subscribe(renderFriends);
    Lobby.setInviteHandlers({
        onInvite: invite => {
            UI.showInvite(invite);
            renderInvites();
        },
        onCount: count => {
            UI.updateInviteBadge(count);
            renderInvites();
        }
    });

    Profile.onChange(() => {
        updateAccountHint();
        renderProfile();
        restartOnlineServices();
    });

    restartOnlineServices();
    renderInvites();

    const active = await Lobby.findActiveGame().catch(() => null);
    if (active) {
        activeGame = active;
        activeGameId = active.id;
        UI.setResumable(true);
    }

    handleDeepLink();
}

/* ---------- Инициализация ---------- */

document.addEventListener('DOMContentLoaded', () => {
    Tutorial.start($('rulesText'));
    $('tutorialPlayBot').addEventListener('click', () => {
        Sound.play('click');
        Tutorial.play();
    });
    $('donateText').innerHTML = I18N.lang === 'en' ? DONATE_TEXT_EN : DONATE_TEXT;
    $('cheatSheet').innerHTML = figureCards(BASE_FIGURES);
    $('versionDisplay').textContent = 'v' + VERSION;

    Bot.load();
    clampBotLevel();
    Colors.init();
    UI.init();
    updateSoundButtons();
    renderDifficulty();
    renderRank();

    document.addEventListener('toof:rank', event => {
        showRankBanner(event.detail && event.detail.rank);
        renderRank();
        renderDifficulty();
    });

    /* Онлайн-ранг повышается серией побед над более сильными соперниками. */
    document.addEventListener('toof:online-rank', event => {
        const detail = event.detail || {};
        showRankBanner(String(detail.rank || 0), t('Новый онлайн-ранг: '));
        updateAccountHint();
    });

    document.addEventListener('toof:color', () => {
        UI.render();
    });

    $('difficultyList').addEventListener('click', event => {
        const option = event.target.closest('.difficulty-option');
        if (!option) return;
        chooseDifficulty(Number(option.dataset.level));
    });

    document.addEventListener('toof:difficulty', () => {
        renderDifficulty();
        renderRank();
        UI.render();
    });

    /* Язык меняется без перезагрузки: перерисовываем только текст. */
    document.addEventListener('toof:lang', () => {
        const rulesScreen = $('rulesScreen');
        if (rulesScreen && rulesScreen.classList.contains('is-active')) Tutorial.start($('rulesText'));
        $('donateText').innerHTML = I18N.lang === 'en' ? DONATE_TEXT_EN : DONATE_TEXT;
        $('cheatSheet').innerHTML = figureCards(BASE_FIGURES);
        renderDifficulty();
        renderRank();
        Colors.refreshButton();
        updateAccountHint();
        renderProfile();
        UI.refreshLanguage();
    });

    document.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', () => {
            Sound.play('click');
            const action = button.dataset.action;
            if (action === 'bot') UI.start('bot');
            else if (action === 'local') UI.start('local');
            else if (action === 'online') {
                UI.showScreen('onlineScreen');
                updateAccountHint();
                renderInvites();
            } else {
                if (action === 'rules') Tutorial.start($('rulesText'));
                UI.showScreen(action + 'Screen');
            }
        });
    });

    document.querySelectorAll('[data-back]').forEach(button => {
        button.addEventListener('click', () => {
            Sound.play('click');
            UI.showScreen(button.dataset.back || 'menuScreen');
        });
    });

    $('soundToggleMenu').addEventListener('click', toggleSound);
    $('soundToggleGame').addEventListener('click', toggleSound);

    /* Онлайн: лобби. */
    $('randomBtn').addEventListener('click', () => {
        Sound.play('click');
        startRandomSearch();
    });

    $('cancelSearchBtn').addEventListener('click', () => {
        Sound.play('click');
        randomCancelled = true;
        $('searchOverlay').hidden = true;
        Lobby.cancelRandom();
    });

    $('friendRoomBtn').addEventListener('click', () => {
        Sound.play('click');
        createFriendRoom();
    });

    $('copyRoomBtn').addEventListener('click', () => {
        Sound.play('click');
        if (!currentRoomCode) return;
        const link = window.location.origin + window.location.pathname + '?room=' + currentRoomCode;
        copyText(link);
    });

    $('cancelRoomBtn').addEventListener('click', () => {
        Sound.play('click');
        Lobby.closeRoom();
        currentRoomCode = null;
        UI.showScreen('onlineScreen');
    });

    $('joinCodeBtn').addEventListener('click', () => {
        Sound.play('click');
        UI.showScreen('joinScreen');
        const input = $('joinCodeInput');
        if (input) input.focus();
    });

    $('joinGameBtn').addEventListener('click', () => {
        Sound.play('click');
        joinFromScreen();
    });

    $('joinCodeInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            joinFromScreen();
        }
    });

    /* Друзья. */
    $('friendsBtn').addEventListener('click', () => {
        Sound.play('click');
        UI.showScreen('friendsScreen');
        renderFriends({ friends: Friends.friends, incoming: Friends.incoming });
    });

    $('addFriendBtn').addEventListener('click', () => {
        Sound.play('click');
        addFriendByCode();
    });

    $('friendCodeInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addFriendByCode();
        }
    });

    /* Профиль. */
    $('profileBtn').addEventListener('click', () => {
        Sound.play('click');
        renderProfile();
        UI.showScreen('profileScreen');
    });

    $('profileNameInput').addEventListener('change', () => {
        Profile.updateName($('profileNameInput').value).then(() => notify('Имя сохранено'));
    });

    $('copyCodeBtn').addEventListener('click', () => {
        Sound.play('click');
        copyText(Profile.state.code);
    });

    $('googleBtn').addEventListener('click', () => {
        Sound.play('click');
        if (!Net.ready) {
            showOnlineSetup();
            return;
        }
        Profile.upgrade().then(() => {
            notify('Готово! Профиль синхронизирован.');
            renderProfile();
        }).catch(error => {
            if (error && error.code === 'auth/popup-closed-by-user') return;
            const messages = {
                'auth/cancelled-popup-request': 'Окно входа уже открыто. Повторите попытку.',
                'auth/popup-blocked': 'Браузер заблокировал окно входа. Разрешите всплывающие окна.',
                'auth/credential-already-in-use': 'Этот Google-аккаунт уже привязан к другому профилю. Повторите вход.',
                'auth/network-request-failed': 'Нет связи с сервером входа. Проверьте интернет.'
            };
            const code = error && error.code;
            notify(messages[code] || ('Не удалось войти: ' + (error.message || 'ошибка входа')));
        });
    });

    $('signOutBtn').addEventListener('click', () => {
        Sound.play('click');
        Profile.signOut().then(() => {
            notify('Вы вышли из аккаунта.');
            renderProfile();
        }).catch(error => notify('Не удалось выйти: ' + (error.message || 'ошибка')));
    });

    $('netSetupClose').addEventListener('click', () => {
        Sound.play('click');
        $('netSetup').hidden = true;
    });

    /* Возврат в активную партию. */
    $('resumeGameBtn').addEventListener('click', () => {
        Sound.play('click');
        if (UI.hasOnlineSession()) {
            UI.resumeOnline();
            return;
        }
        if (!activeGameId) return;
        if (!requireOnline()) return;
        const otherUid = (activeGame && activeGame.players || [])
            .find(uid => uid !== Profile.state.uid);
        const name = (activeGame && activeGame.names && activeGame.names[otherUid]) || t('Соперник');
        askConfirm('Вернуться в партию?', 'Продолжить игру с {name}?', () => {
            Lobby.openGame(activeGameId).then(() => {
                activeGame = null;
                activeGameId = null;
                UI.setResumable(false);
            }).catch(error => notify('Не удалось вернуться в игру: ' + (error.message || 'ошибка сети')));
        }, { name });
    });

    $('confirmYes').addEventListener('click', () => {
        Sound.play('click');
        const action = confirmAction;
        closeConfirm();
        if (action) action();
    });
    $('confirmNo').addEventListener('click', () => {
        Sound.play('click');
        closeConfirm();
    });

    initOnline();
});
