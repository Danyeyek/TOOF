'use strict';

/* ============================================================
   TOOF — профиль игрока.
   Аноним: имя, код, друзья и статистика живут в localStorage
   (и привязаны к этому браузеру). После входа через Google
   профиль, друзья и статистика синхронизируются через Firestore.
   ============================================================ */

const Profile = (() => {
    const PROFILE_KEY = 'toof_profile_v1';
    const FRIENDS_KEY = 'toof_local_friends_v1';
    const STATS_KEY = 'toof_local_stats_v1';
    const MERGED_KEY = 'toof_stats_merged_';

    const ADJECTIVES = ['Быстрый', 'Хитрый', 'Тихий', 'Смелый', 'Умный', 'Ловкий', 'Ясный', 'Дикий'];
    const ANIMALS = ['Лис', 'Кот', 'Волк', 'Сокол', 'Ёж', 'Барс', 'Кит', 'Ворон'];
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    const state = {
        uid: '',
        name: '',
        code: '',
        registered: false,
        ready: false,
        online: false,
        stats: { wins: 0, losses: 0, draws: 0 }
    };

    const listeners = [];
    let heartbeat = null;
    let unsubUser = null;

    function emit() {
        for (const listener of listeners.slice()) {
            try { listener(Object.assign({}, state, { stats: Object.assign({}, state.stats) })); }
            catch (e) { /* не ломаем UI из-за одного слушателя */ }
        }
    }

    function onChange(listener) {
        listeners.push(listener);
        if (state.ready) listener(Object.assign({}, state, { stats: Object.assign({}, state.stats) }));
        return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) listeners.splice(index, 1);
        };
    }

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { /* приватный режим */ }
    }

    function randomInt(max) {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const buffer = new Uint32Array(1);
            crypto.getRandomValues(buffer);
            return buffer[0] % max;
        }
        return Math.floor(Math.random() * max);
    }

    function makeCode() {
        let code = '';
        for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
        return code;
    }

    function makeName() {
        return ADJECTIVES[randomInt(ADJECTIVES.length)] + ' ' + ANIMALS[randomInt(ANIMALS.length)];
    }

    function makeLocalUid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'local-' + crypto.randomUUID();
        return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function cleanName(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
        return text || makeName();
    }

    function loadLocal() {
        const saved = readJson(PROFILE_KEY, null) || {};
        state.uid = saved.uid || makeLocalUid();
        state.name = cleanName(saved.name);
        state.code = String(saved.code || makeCode()).toUpperCase();
        state.registered = !!saved.registered;
        state.stats = Object.assign({ wins: 0, losses: 0, draws: 0 }, readJson(STATS_KEY, {}));
        saveLocal();
    }

    function saveLocal() {
        writeJson(PROFILE_KEY, {
            uid: state.uid,
            name: state.name,
            code: state.code,
            registered: state.registered
        });
        writeJson(STATS_KEY, state.stats);
    }

    function localFriends() {
        const list = readJson(FRIENDS_KEY, []);
        return Array.isArray(list) ? list.filter(item => item && item.uid) : [];
    }

    function saveLocalFriends(list) {
        writeJson(FRIENDS_KEY, list);
    }

    function addLocalFriend(friend) {
        if (!friend || !friend.uid || friend.uid === state.uid) return;
        const list = localFriends().filter(item => item.uid !== friend.uid);
        list.push({
            uid: friend.uid,
            name: cleanName(friend.name),
            code: String(friend.code || '').toUpperCase()
        });
        saveLocalFriends(list);
    }

    function removeLocalFriend(uid) {
        saveLocalFriends(localFriends().filter(item => item.uid !== uid));
    }

    function mergeStats(remote) {
        if (!remote) return;
        const stats = remote.stats || {};
        state.stats = {
            wins: Math.max(state.stats.wins, Number(stats.wins) || 0),
            losses: Math.max(state.stats.losses, Number(stats.losses) || 0),
            draws: Math.max(state.stats.draws, Number(stats.draws) || 0)
        };
    }

    async function ensureRemoteUser(user) {
        const remote = await NetTransport.getUser(user.uid);
        if (remote) {
            state.name = cleanName(remote.name || state.name);
            state.code = String(remote.code || state.code).toUpperCase();
            state.registered = !!remote.registered;
            mergeStats(remote);
            /* Если на другом устройстве имя поменяли — подтягиваем. */
            saveLocal();
            return remote;
        }

        const data = {
            name: state.name,
            code: state.code,
            registered: state.registered,
            createdAt: Net.serverTimestamp(),
            updatedAt: Net.serverTimestamp(),
            stats: Object.assign({}, state.stats),
            online: true,
            lastSeen: Net.serverTimestamp()
        };
        await NetTransport.setUser(user.uid, data, false);
        return data;
    }

    async function startPresence() {
        if (!Net.ready || !state.uid) return;
        clearInterval(heartbeat);
        state.online = true;
        NetTransport.setPresence(state.uid, true);
        heartbeat = setInterval(() => {
            if (document.visibilityState === 'visible') {
                NetTransport.setPresence(state.uid, true);
            }
        }, 45000);

        window.addEventListener('pagehide', () => {
            NetTransport.setPresence(state.uid, false);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                NetTransport.setPresence(state.uid, true);
            } else {
                NetTransport.setPresence(state.uid, false);
            }
        });
    }

    async function init() {
        loadLocal();

        if (!Net.ready) {
            state.ready = true;
            state.online = false;
            saveLocal();
            emit();
            return state;
        }

        let user;
        try {
            user = await Net.ensureAuth();
        } catch (error) {
            /* Анонимный вход выключен или сеть недоступна — остаёмся локально. */
            state.ready = true;
            state.online = false;
            saveLocal();
            emit();
            return state;
        }

        state.uid = user.uid;
        state.registered = Net.isRegistered(user);

        try {
            if (state.registered) {
                await ensureRemoteUser(user);
                const mergedKey = MERGED_KEY + user.uid;
                if (!readJson(mergedKey, false)) {
                    await syncLocalToRemote();
                    writeJson(mergedKey, true);
                }
                unsubUser = NetTransport.subscribeUser(user.uid, remote => {
                    if (!remote) return;
                    state.name = cleanName(remote.name || state.name);
                    state.code = String(remote.code || state.code).toUpperCase();
                    state.registered = !!remote.registered;
                    mergeStats(remote);
                    saveLocal();
                    emit();
                });
            } else {
                /* Аноним: данные локальные, но документ users/{uid} нужен
                   для поиска по коду и presence. */
                await ensureRemoteUser(user);
            }
        } catch (error) {
            /* Firestore недоступен: всё равно даём играть локально. */
            state.online = false;
            saveLocal();
            state.ready = true;
            emit();
            return state;
        }

        saveLocal();
        state.ready = true;
        await startPresence();
        emit();
        return state;
    }

    async function syncLocalToRemote() {
        if (!Net.ready || !state.uid) return;
        const stats = Object.assign({}, state.stats);
        await NetTransport.setUser(state.uid, {
            name: state.name,
            code: state.code,
            registered: state.registered,
            stats,
            updatedAt: Net.serverTimestamp()
        }, true);

        for (const friend of localFriends()) {
            await NetTransport.addFriend(state.uid, friend).catch(() => {});
        }
    }

    async function updateName(value) {
        state.name = cleanName(value);
        saveLocal();
        if (Net.ready && state.uid) {
            await NetTransport.setUser(state.uid, {
                name: state.name,
                updatedAt: Net.serverTimestamp()
            }, true).catch(() => {});
        }
        emit();
        return state.name;
    }

    async function upgrade() {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        const before = state.uid;
        const user = await Net.signInGoogle();
        const uidChanged = user.uid !== before;

        state.uid = user.uid;
        state.registered = true;
        if (uidChanged) {
            /* Google-аккаунт уже был привязан к другому uid. Локальные
               друзья/статистика переносятся в новый профиль. */
            saveLocal();
        }

        await syncLocalToRemote();
        await NetTransport.setUser(state.uid, {
            name: state.name,
            code: state.code,
            registered: true,
            stats: state.stats,
            updatedAt: Net.serverTimestamp()
        }, true);

        if (unsubUser) unsubUser();
        unsubUser = NetTransport.subscribeUser(state.uid, remote => {
            if (!remote) return;
            state.name = cleanName(remote.name || state.name);
            state.code = String(remote.code || state.code).toUpperCase();
            mergeStats(remote);
            saveLocal();
            emit();
        });

        saveLocal();
        emit();
        return state;
    }

    async function signOut() {
        if (!Net.ready) return state;
        if (unsubUser) {
            unsubUser();
            unsubUser = null;
        }
        clearInterval(heartbeat);
        heartbeat = null;
        await Net.signOut();
        const user = await Net.ensureAuth();
        state.uid = user.uid;
        state.registered = false;
        /* Локальные друзья и статистика остаются на устройстве. */
        saveLocal();
        await startPresence();
        emit();
        return state;
    }

    function recordResult(result) {
        if (result === 'win') state.stats.wins++;
        else if (result === 'loss') state.stats.losses++;
        else state.stats.draws++;
        saveLocal();
        if (Net.ready && state.registered) {
            NetTransport.recordStats(state.uid, result).catch(() => {});
        }
        emit();
        return Object.assign({}, state.stats);
    }

    function isRegistered() {
        return !!state.registered;
    }

    return {
        init,
        onChange,
        updateName,
        upgrade,
        signOut,
        recordResult,
        isRegistered,
        localFriends,
        addLocalFriend,
        removeLocalFriend,
        saveLocalFriends,
        get state() { return Object.assign({}, state, { stats: Object.assign({}, state.stats) }); }
    };
})();
