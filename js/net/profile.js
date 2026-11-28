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
    const RANK_KEY = 'toof_online_rank_v1';
    const MERGED_KEY = 'toof_stats_merged_';
    /* Онлайн-ранг: 0 — без ранга, чем больше число, тем сильнее игрок.
       Повышение — три победы над разными игроками, чей ранг выше нашего. */
    const MAX_RANK = 1000;
    const MAX_LADDER = 8;

    const ADJECTIVES = ['Быстрый', 'Хитрый', 'Тихий', 'Смелый', 'Умный', 'Ловкий', 'Ясный', 'Дикий'];
    const ANIMALS = ['Лис', 'Кот', 'Волк', 'Сокол', 'Ёж', 'Барс', 'Кит', 'Ворон'];
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const CODE_ATTEMPTS = 8;

    const state = {
        uid: '',
        name: '',
        code: '',
        registered: false,
        ready: false,
        online: false,
        stats: { wins: 0, losses: 0, draws: 0 },
        rank: 0,
        /* Цепочка побед: [{ uid, rank }] — только соперники выше текущего
           ранга. Один uid учитывается один раз. После повышения остаются
           только те, чей ранг всё ещё выше нового (цепочка на следующий ранг). */
        ladder: []
    };

    const listeners = [];
    let heartbeat = null;
    let unsubUser = null;
    let pageHideHandler = null;
    let visibilityHandler = null;

    function snapshot() {
        return Object.assign({}, state, {
            stats: Object.assign({}, state.stats),
            ladder: state.ladder.map(item => Object.assign({}, item))
        });
    }

    function emit() {
        for (const listener of listeners.slice()) {
            try { listener(snapshot()); }
            catch (e) { /* не ломаем UI из-за одного слушателя */ }
        }
    }

    function onChange(listener) {
        listeners.push(listener);
        if (state.ready) listener(snapshot());
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

    function normalizeRank(value) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 && number <= MAX_RANK ? number : 0;
    }

    function normalizeLadder(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const result = [];
        for (const item of value) {
            if (!item || typeof item.uid !== 'string' || !item.uid) continue;
            const rank = normalizeRank(item.rank);
            if (!rank || seen.has(item.uid)) continue;
            seen.add(item.uid);
            result.push({ uid: item.uid, rank });
        }
        return result.slice(-MAX_LADDER);
    }

    function loadLocalRank() {
        const saved = readJson(RANK_KEY, null) || {};
        state.rank = normalizeRank(saved.rank);
        state.ladder = normalizeLadder(saved.ladder);
    }

    function saveLocalRank() {
        writeJson(RANK_KEY, { rank: state.rank, ladder: state.ladder });
    }

    /* Победа над более сильным игроком сдвигает ранг только если набрано
       три разных соперника. Ничьи и победы над слабыми цепочку не сбивают,
       но и не добавляют в неё; поражение сбрасывает её. Повышаемся до самого лёгкого ранга
       из тройки: например, две победы над 1-м и одна над 2-м дают 1-й ранг,
       а победа над 2-м остаётся в цепочке на следующий ранг. */
    function applyRankWin(opponent) {
        if (!opponent || typeof opponent.uid !== 'string' || !opponent.uid) return null;
        if (opponent.uid === state.uid) return null;
        const otherRank = normalizeRank(opponent.rank);
        if (otherRank <= state.rank) return null;
        if (state.ladder.some(item => item.uid === opponent.uid)) return null;

        state.ladder.push({ uid: opponent.uid, rank: otherRank });
        if (state.ladder.length < 3) return null;

        const from = state.rank;
        const to = Math.min.apply(null, state.ladder.map(item => item.rank));
        state.rank = to;
        /* В памяти остаются только соперники, которые всё ещё выше нового
           ранга: на них держится цепочка следующего повышения. */
        state.ladder = state.ladder.filter(item => item.rank > to);
        return { from, to };
    }

    function adoptRemoteRank(remote) {
        if (!remote) return;
        state.rank = normalizeRank(remote.rank);
        state.ladder = normalizeLadder(remote.ladder);
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

    /* Код уникален только если удалось зарезервировать его в Firestore.
       При коллизии генерируем новый — иначе два игрока станут недостижимы
       по коду (getUserByCode берёт первый попавшийся документ). */
    async function ensureCode() {
        if (!Net.ready || !state.uid) return state.code;
        for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            if (await NetTransport.reserveCode(state.uid, state.code)) return state.code;
            state.code = makeCode();
        }
        throw new Error('Не удалось выбрать уникальный код профиля');
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
        loadLocalRank();
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
        saveLocalRank();
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
            code: String(friend.code || '').toUpperCase(),
            rank: normalizeRank(friend.rank)
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
            adoptRemoteRank(remote);
            await ensureCode();
            if (state.code !== remote.code) {
                await NetTransport.setUser(user.uid, {
                    code: state.code,
                    updatedAt: Net.serverTimestamp()
                }, true);
            }
            /* Если на другом устройстве имя поменяли — подтягиваем. */
            saveLocal();
            return remote;
        }

        await ensureCode();
        const data = {
            name: state.name,
            code: state.code,
            registered: state.registered,
            createdAt: Net.serverTimestamp(),
            updatedAt: Net.serverTimestamp(),
            stats: Object.assign({}, state.stats),
            rank: state.rank,
            ladder: state.ladder.map(item => Object.assign({}, item)),
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

        /* startPresence вызывается и после выхода из Google: старые слушатели
           должны сниматься, иначе presence пишется несколько раз с разными uid. */
        if (pageHideHandler) window.removeEventListener('pagehide', pageHideHandler);
        if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
        pageHideHandler = () => NetTransport.setPresence(state.uid, false);
        visibilityHandler = () => {
            NetTransport.setPresence(state.uid, document.visibilityState === 'visible');
        };
        window.addEventListener('pagehide', pageHideHandler);
        document.addEventListener('visibilitychange', visibilityHandler);
    }

    /* Один слушатель своего профиля на все состояния: аноним, Google и
       повторный аноним после выхода. Иначе после смены uid старый слушатель
       пишет данные уже не того аккаунта. */
    function subscribeSelf() {
        if (unsubUser) unsubUser();
        unsubUser = NetTransport.subscribeUser(state.uid, remote => {
            if (!remote) return;
            state.name = cleanName(remote.name || state.name);
            state.code = String(remote.code || state.code).toUpperCase();
            state.registered = !!remote.registered;
            mergeStats(remote);
            adoptRemoteRank(remote);
            saveLocal();
            emit();
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
                subscribeSelf();
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
        await ensureCode();
        const stats = Object.assign({}, state.stats);
        await NetTransport.setUser(state.uid, {
            name: state.name,
            code: state.code,
            registered: state.registered,
            stats,
            rank: state.rank,
            ladder: state.ladder.map(item => Object.assign({}, item)),
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
            /* Google-аккаунт уже был привязан к другому uid. Сначала читаем
               удалённый профиль: иначе локальный name/code/stats затирают
               данные с другого устройства. Локальные друзья переносятся
               ниже через syncLocalToRemote. */
            saveLocal();
            await ensureRemoteUser(user);
            state.registered = true;
        }

        await syncLocalToRemote();
        await NetTransport.setUser(state.uid, {
            name: state.name,
            code: state.code,
            registered: true,
            stats: state.stats,
            rank: state.rank,
            ladder: state.ladder.map(item => Object.assign({}, item)),
            updatedAt: Net.serverTimestamp()
        }, true);

        subscribeSelf();
        /* Heartbeat должен сразу писать presence под новым uid. */
        await startPresence();

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
        /* Google-код принадлежит другому аккаунту: анониму нужен свой.
           ensureCode() попробует текущий код и, если он занят, вернёт новый. */
        try {
            await ensureRemoteUser(user);
            subscribeSelf();
        } catch (error) {
            /* Firestore недоступен — профиль останется локальным. */
        }
        /* Локальные друзья и статистика остаются на устройстве. */
        saveLocal();
        await startPresence();
        emit();
        return state;
    }

    /* opponent — { uid, rank } соперника по онлайн-партии. Только победы над
       игроками выше нас двигают онлайн-ранг; ничья цепочку сохраняет, а
       поражение сбрасывает. Статистика считается как раньше. */
    function recordResult(result, opponent) {
        if (result === 'win') state.stats.wins++;
        else if (result === 'loss') state.stats.losses++;
        else if (result === 'draw') state.stats.draws++;
        else return Object.assign({}, state.stats);

        const rankUp = result === 'win' ? applyRankWin(opponent) : null;
        const chainReset = result === 'loss' && state.ladder.length > 0;
        if (chainReset) state.ladder = [];
        saveLocal();
        if (Net.ready && state.uid) {
            NetTransport.recordStats(state.uid, result).catch(() => {});
            /* Сброс цепочки тоже нужно записать: иначе после перезагрузки
               или на другом устройстве старые победы оживут снова. */
            if ((rankUp || chainReset) && NetTransport.setRank) {
                NetTransport.setRank(state.uid, state.rank, state.ladder).catch(() => {});
            }
        }
        emit();
        if (rankUp && typeof document !== 'undefined' && document.dispatchEvent &&
            typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('toof:online-rank', {
                detail: { rank: state.rank, from: rankUp.from }
            }));
        }
        return Object.assign({}, state.stats, { rank: state.rank, rankUp });
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
        get state() { return snapshot(); }
    };
})();
