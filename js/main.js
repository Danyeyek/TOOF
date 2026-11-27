'use strict';

/* ============================================================
   Точка входа: разметка правил, памятка, меню, настройки
   и вся обвязка онлайна (профиль, друзья, лобби).
   ============================================================ */

const $ = id => document.getElementById(id);

let pendingLevel = null;
let activeGameId = null;
let currentRoomCode = null;
let noticeTimer = null;
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
        const label = sheet.name ? '<figcaption>' + sheet.name + '</figcaption>' : '';
        return '<figure class="card">' + label + figureDemo(sheet) + '</figure>';
    }).join('') + '</div>';
}

function closeDifficultyConfirm() {
    $('difficultyConfirm').hidden = true;
    pendingLevel = null;
}

function renderDifficulty() {
    const select = $('difficultySelect');
    select.innerHTML = '';
    Bot.LEVELS.forEach(level => {
        const option = document.createElement('option');
        option.value = String(level.id);
        option.textContent = level.name;
        select.appendChild(option);
    });
    select.value = String(Bot.level);
}

function updateSoundButtons() {
    const on = Sound.isOn();
    ['soundToggleMenu', 'soundToggleGame'].forEach(id => {
        const button = $(id);
        button.textContent = on ? '🔊' : '🔇';
        button.setAttribute('aria-pressed', String(on));
        button.title = on ? 'Звук включён' : 'Звук выключен';
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
    box.textContent = text;
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { box.hidden = true; }, 4000);
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
            text.textContent = 'Firebase ещё не подключён. Откройте js/firebase-config.js и вставьте данные проекта из Firebase Console. Пошаговая инструкция — в README.md.';
        } else if (reason === 'sdk-missing') {
            text.textContent = 'Не удалось загрузить Firebase SDK. Проверьте интернет и обновите страницу.';
        } else if (reason === 'init-failed') {
            text.textContent = 'Firebase не смог запуститься. Проверьте настройки проекта и правила Firestore.';
        } else if (Net.ready && !Profile.state.uid) {
            text.textContent = 'Профиль ещё загружается. Подождите секунду и попробуйте снова.';
        } else {
            text.textContent = 'Онлайн сейчас недоступен. Локальные режимы продолжают работать.';
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
        if (hint) hint.textContent = 'Загружаем профиль…';
        return;
    }

    if (!Net.ready) {
        if (hint) hint.textContent = 'Онлайн не настроен: доступны игра против бота и на одном экране.';
        if (modeHint) modeHint.textContent = 'Онлайн не настроен. Профиль хранится только в этом браузере.';
        return;
    }

    if (hint) {
        const mode = profile.registered ? 'аккаунт Google' : 'анонимный профиль этого браузера';
        hint.textContent = 'Вы: ' + profile.name + ' · ' + mode +
            ' · победы ' + profile.stats.wins + ', поражения ' + profile.stats.losses +
            ', ничьи ' + profile.stats.draws;
    }
    if (modeHint) {
        modeHint.textContent = profile.registered
            ? 'Профиль синхронизируется между устройствами через Google.'
            : 'Профиль привязан к этому браузеру. Войдите через Google, чтобы играть с того же аккаунта на других устройствах.';
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
        google.textContent = 'Войти через Google';
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
    dot.title = friend.online ? 'В сети' : 'Не в сети';

    const info = document.createElement('div');
    info.className = 'list-item__info';

    const name = document.createElement('b');
    name.textContent = friend.name || 'Игрок';

    const code = document.createElement('span');
    code.className = 'list-item__meta';
    code.textContent = friend.code ? 'Код: ' + friend.code : '';

    info.appendChild(name);
    info.appendChild(code);

    const challenge = document.createElement('button');
    challenge.className = 'btn btn-primary btn-mini';
    challenge.type = 'button';
    challenge.textContent = 'Вызвать';
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
    remove.title = 'Удалить из друзей';
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
    name.textContent = request.fromName || 'Игрок';

    const code = document.createElement('span');
    code.className = 'list-item__meta';
    code.textContent = 'хочет добавить вас в друзья';

    info.appendChild(name);
    info.appendChild(code);

    const accept = document.createElement('button');
    accept.className = 'btn btn-primary btn-mini';
    accept.type = 'button';
    accept.textContent = 'Принять';
    accept.addEventListener('click', () => {
        Sound.play('click');
        Friends.accept(request).catch(error => notify(error.message || 'Не удалось принять заявку'));
    });

    const decline = document.createElement('button');
    decline.className = 'btn btn-mini';
    decline.type = 'button';
    decline.textContent = 'Отклонить';
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
        title.textContent = 'Заявки в друзья:';
        requests.appendChild(title);
        incoming.forEach(request => requests.appendChild(requestItem(request)));
    }

    if (!friends.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'Пока никого нет. Добавьте друга по его коду профиля.';
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
            ? 'Нажмите «Вызвать», чтобы отправить приглашение. Друг увидит его, когда откроет игру.'
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
    name.textContent = (invite.names && invite.names[otherUid]) || 'Друг';

    const meta = document.createElement('span');
    meta.className = 'list-item__meta';
    meta.textContent = 'приглашает в игру';

    info.appendChild(name);
    info.appendChild(meta);

    const accept = document.createElement('button');
    accept.className = 'btn btn-primary btn-mini';
    accept.type = 'button';
    accept.textContent = 'Принять';
    accept.addEventListener('click', () => {
        Sound.play('click');
        leaveCurrentGame()
            .then(() => Lobby.acceptInvite(invite))
            .catch(error => notify(error.message || 'Не удалось принять приглашение'));
    });

    const decline = document.createElement('button');
    decline.className = 'btn btn-mini';
    decline.type = 'button';
    decline.textContent = 'Отклонить';
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
    joinByCode(room);
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
    $('donateText').innerHTML = DONATE_TEXT;
    $('cheatSheet').innerHTML = figureCards(BASE_FIGURES);
    $('versionDisplay').textContent = 'v' + VERSION;

    Bot.load();
    UI.init();
    updateSoundButtons();
    renderDifficulty();

    $('difficultySelect').addEventListener('change', () => {
        const requested = Number($('difficultySelect').value);
        const previous = Bot.level;
        Sound.play('click');

        const popover = $('settingsPopover');
        if (popover) popover.hidden = true;
        const button = $('settingsButton');
        if (button) button.setAttribute('aria-expanded', 'false');

        if (requested === previous) return;

        /* До первого хода можно просто сменить уровень на месте. */
        if (UI.canChangeDifficulty()) {
            Bot.setLevel(requested);
            renderDifficulty();
            UI.render();
            return;
        }

        /* В середине партии или после её конца — предлагаем новую игру. */
        pendingLevel = requested;
        $('difficultySelect').value = String(previous);
        const level = Bot.LEVELS.find(l => l.id === requested);
        $('difficultyConfirmText').textContent =
            'Новая сложность — ' + (level ? level.name : '') + '. Начать игру заново?';
        $('difficultyConfirm').hidden = false;
    });

    $('difficultyConfirmYes').addEventListener('click', () => {
        Sound.play('click');
        if (pendingLevel) Bot.setLevel(pendingLevel);
        closeDifficultyConfirm();
        renderDifficulty();
        UI.start('bot');
    });

    $('difficultyConfirmNo').addEventListener('click', () => {
        Sound.play('click');
        closeDifficultyConfirm();
        renderDifficulty();
        UI.render();
    });

    document.addEventListener('toof:difficulty', () => {
        renderDifficulty();
        UI.render();
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
            notify('Не удалось войти: ' + (error.message || 'ошибка входа'));
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
        Lobby.openGame(activeGameId).then(() => {
            activeGameId = null;
            UI.setResumable(false);
        }).catch(error => notify('Не удалось вернуться в игру: ' + (error.message || 'ошибка сети')));
    });

    initOnline();
});
