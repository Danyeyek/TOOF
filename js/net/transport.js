'use strict';

/* ============================================================
   TOOF — Firestore-транспорт.
   Хранит партию как документ games/{id} + журнал games/{id}/moves.
   Никакого серверного кода: транзакции и security rules.
   ============================================================ */

const NetTransport = (() => {
    const DAY = 24 * 60 * 60 * 1000;
    const INVITE_TTL = 7 * DAY;      // приглашения и комнаты
    const REQUEST_TTL = 30 * DAY;    // заявки в друзья
    const GAME_TTL = 90 * DAY;       // партия после последней активности
    const MAX_RANK = 1000;
    const MAX_LADDER = 8;

    function expiry(ms) {
        return firebase.firestore.Timestamp.fromMillis(Date.now() + ms);
    }

    /* Проверка формы хода до транзакции: дублирует правила Firestore и
       не даёт злоумышленнику потратить запись на битый ход. */
    function validMovePayload(move) {
        if (!move || typeof move !== 'object') return false;
        const cell = value => Array.isArray(value) && value.length === 2 &&
            Number.isInteger(value[0]) && Number.isInteger(value[1]) &&
            value[0] >= 0 && value[0] < 10 &&
            value[1] >= 0 && value[1] < 10;
        if (move.place != null && !cell(move.place)) return false;
        if (move.fix == null) return move.place != null;
        if (!Array.isArray(move.fix) || move.fix.length < 1 || move.fix.length > 6) return false;
        return move.fix.every(figure =>
            Array.isArray(figure) && (figure.length === 4 || figure.length === 6) &&
            figure.every(cell) &&
            new Set(figure.map(value => value[0] + ',' + value[1])).size === figure.length
        );
    }

    function db() {
        if (!Net.ready || !Net.db) throw new Error('Firebase не настроен');
        return Net.db;
    }

    function withId(doc) {
        return Object.assign({ id: doc.id }, doc.data());
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function millis(value) {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        return 0;
    }

    /* Ранг в очереди может прийти как числом, так и записью профиля.
       Старые записи без ранга читаются как 0. */
    function rankOf(value) {
        const raw = value && typeof value === 'object' ? value.rank : value;
        const number = Number(raw);
        return Number.isInteger(number) && number >= 0 && number <= MAX_RANK ? number : 0;
    }

    function normalizeLadder(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const result = [];
        for (const item of value) {
            if (!item || typeof item.uid !== 'string' || !item.uid) continue;
            const rank = rankOf(item.rank);
            if (!rank || seen.has(item.uid)) continue;
            seen.add(item.uid);
            result.push({ uid: item.uid, rank });
        }
        return result.slice(-MAX_LADDER);
    }

    function ranksMap(players, source) {
        const ranks = {};
        for (const uid of players) ranks[uid] = rankOf(source && source[uid]);
        return ranks;
    }

    function isExpired(game) {
        return !!(game && game.expiresAt && millis(game.expiresAt) < Date.now());
    }

    function gameRef(gameId) {
        return db().collection('games').doc(gameId);
    }

    function movesQuery(gameId) {
        return gameRef(gameId).collection('moves').orderBy('ply', 'asc');
    }

    function gamePayload({ mode, players, sides, names, ranks, invited, status }) {
        const payload = {
            mode: mode || 'friend',
            players: players.slice(),
            sides: Object.assign({}, sides),
            names: Object.assign({}, names),
            /* Ранг фиксируется в начале партии: повышение одним из игроков
               не меняет условие повышения для победителя. */
            ranks: ranksMap(players, ranks),
            invited: invited || null,
            status: status || 'active',
            current: 'X',
            ply: 0,
            winner: null,
            rematchOf: null,
            rematchGameId: null,
            /* Приглашение живёт неделю; активная партия — 90 дней после
               последней активности (поле обновляется каждым ходом). */
            expiresAt: expiry(invited ? INVITE_TTL : GAME_TTL),
            createdAt: Net.serverTimestamp(),
            updatedAt: Net.serverTimestamp()
        };
        return payload;
    }

    async function createGame(options) {
        const ref = db().collection('games').doc();
        await ref.set(gamePayload(options));
        return ref.id;
    }

    async function getGame(gameId) {
        const snap = await gameRef(gameId).get();
        return snap.exists ? withId(snap) : null;
    }

    function subscribeGame(gameId, handlers) {
        const unsubGame = gameRef(gameId).onSnapshot(snap => {
            if (!snap.exists) {
                if (handlers.onError) handlers.onError(new Error('Игра не найдена'));
                return;
            }
            if (handlers.onGame) handlers.onGame(withId(snap));
        }, error => {
            if (handlers.onError) handlers.onError(error);
        });

        const unsubMoves = movesQuery(gameId).onSnapshot(snap => {
            if (handlers.onMoves) {
                handlers.onMoves(snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data())));
            }
        }, error => {
            if (handlers.onError) handlers.onError(error);
        });

        return () => {
            unsubGame();
            unsubMoves();
        };
    }

    async function fetchMoves(gameId) {
        const snap = await movesQuery(gameId).get();
        return snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    }

    async function sendMove({ gameId, side, ply, move, winner }) {
        if (!validMovePayload(move)) throw new Error('Недопустимый ход');
        const ref = gameRef(gameId);
        const moveRef = ref.collection('moves').doc(String(ply).padStart(4, '0'));

        await db().runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error('Игра не найдена');
            const game = snap.data();
            if (game.status !== 'active') throw new Error('Игра уже не активна');
            if (game.current !== side) throw new Error('Сейчас не ваш ход');
            if (game.ply !== ply) throw new Error('Ход устарел, обновите партию');

            tx.set(moveRef, {
                ply,
                side,
                place: move.place,
                fix: move.fix || null,
                at: Net.serverTimestamp()
            });

            const update = {
                current: side === 'X' ? 'O' : 'X',
                ply: ply + 1,
                updatedAt: Net.serverTimestamp(),
                expiresAt: expiry(GAME_TTL)
            };
            if (winner) {
                update.status = 'finished';
                update.winner = winner;
            }
            tx.update(ref, update);
        });
    }

    async function setStatus(gameId, status, extra) {
        const data = Object.assign({
            status,
            updatedAt: Net.serverTimestamp(),
            expiresAt: expiry(GAME_TTL)
        }, extra || {});
        await gameRef(gameId).update(data);
    }

    async function acceptInvite(gameId) {
        await setStatus(gameId, 'active', {
            acceptedAt: Net.serverTimestamp(),
            invited: null
        });
    }

    async function declineInvite(gameId) {
        await setStatus(gameId, 'abandoned');
    }

    async function requestRematch(gameId) {
        const ref = gameRef(gameId);
        return db().runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error('Игра не найдена');
            const game = snap.data();
            if (game.rematchGameId) return game.rematchGameId;

            const newRef = db().collection('games').doc();
            const sides = {};
            for (const uid of game.players) {
                sides[uid] = game.sides[uid] === 'X' ? 'O' : 'X';
            }

            tx.set(newRef, {
                /* Реванш подтверждается ссылкой на прежнюю партию, а не очередью. */
                mode: 'friend',
                players: game.players.slice(),
                sides,
                names: Object.assign({}, game.names),
                /* Ранги реванша берём из исходной партии: они фиксируют
                   условия повышения для этого матча. Для старых партий
                   без рангов подставляем 0. */
                ranks: ranksMap(game.players, game.ranks || {}),
                invited: null,
                status: 'active',
                current: 'X',
                ply: 0,
                winner: null,
                rematchOf: gameId,
                rematchGameId: null,
                expiresAt: expiry(GAME_TTL),
                createdAt: Net.serverTimestamp(),
                updatedAt: Net.serverTimestamp()
            });
            tx.update(ref, { rematchGameId: newRef.id, updatedAt: Net.serverTimestamp() });
            return newRef.id;
        });
    }

    async function findActiveGame(uid) {
        const snap = await db().collection('games')
            .where('players', 'array-contains', uid)
            .where('status', '==', 'active')
            .limit(20)
            .get();
        const games = snap.docs
            .map(withId)
            .filter(game => !isExpired(game));
        games.sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
        return games[0] || null;
    }

    async function pickRandom(me) {
        const snap = await db().collection('queue').orderBy('createdAt', 'asc').limit(50).get();
        const freshAfter = Date.now() - 60 * 1000;
        const candidates = snap.docs
            .map(doc => Object.assign({ id: doc.id }, doc.data()))
            /* Не берем «зависшие» записи от закрытых вкладок.
               Соперник берётся из id документа, а не из поля uid: поле мог
               быть подменено, и тогда игра создалась бы с чужим игроком. */
            .filter(item => item.id !== me.uid && millis(item.createdAt) > freshAfter);

        /* Сначала одинаковый ранг, затем максимально близкий; при равной
           разнице — тот, кто дольше ждёт, а затем более сильный игрок. */
        const myRank = rankOf(me);
        candidates.sort((a, b) => {
            const distance = Math.abs(rankOf(a) - myRank) - Math.abs(rankOf(b) - myRank);
            if (distance) return distance;
            const waiting = millis(a.createdAt) - millis(b.createdAt);
            return waiting || rankOf(b) - rankOf(a);
        });

        for (const candidate of candidates) {
            const otherUid = candidate.id;
            try {
                return await db().runTransaction(async tx => {
                    const myRef = db().collection('queue').doc(me.uid);
                    const otherRef = db().collection('queue').doc(otherUid);
                    const mySnap = await tx.get(myRef);
                    const otherSnap = await tx.get(otherRef);
                    if (!mySnap.exists || !otherSnap.exists) throw new Error('queue-gone');

                    const gameRefNew = db().collection('games').doc();
                    const firstIsX = Math.random() < 0.5;
                    const sides = {};
                    sides[me.uid] = firstIsX ? 'X' : 'O';
                    sides[otherUid] = firstIsX ? 'O' : 'X';
                    const names = {};
                    names[me.uid] = me.name;
                    names[otherUid] = candidate.name || 'Соперник';
                    const ranks = ranksMap([me.uid, otherUid], {
                        [me.uid]: me.rank,
                        [otherUid]: candidate.rank
                    });

                    tx.set(gameRefNew, {
                        mode: 'random',
                        players: [me.uid, otherUid],
                        sides,
                        names,
                        ranks,
                        invited: null,
                        status: 'active',
                        current: 'X',
                        ply: 0,
                        winner: null,
                        rematchOf: null,
                        rematchGameId: null,
                        expiresAt: expiry(GAME_TTL),
                        createdAt: Net.serverTimestamp(),
                        updatedAt: Net.serverTimestamp()
                    });
                    tx.delete(myRef);
                    tx.delete(otherRef);
                    return gameRefNew.id;
                });
            } catch (error) {
                /* Кандидата уже забрали — пробуем следующего. */
            }
        }
        return null;
    }

    async function findRandom(me, options) {
        const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 20000;
        const pollMs = options && options.pollMs ? options.pollMs : 2000;
        const queueRef = db().collection('queue').doc(me.uid);

        await queueRef.set({
            uid: me.uid,
            name: me.name,
            code: me.code,
            rank: rankOf(me),
            createdAt: Net.serverTimestamp()
        }, { merge: true });

        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const gameId = await pickRandom(me);
            if (gameId) return gameId;

            /* Другой игрок мог забрать нас из очереди в тот же момент —
               тогда партия уже создана — просто вернём её. */
            const active = await findActiveGame(me.uid);
            if (active && millis(active.createdAt) >= started - 15000) return active.id;

            await delay(pollMs);
        }

        await queueRef.delete().catch(() => {});
        return null;
    }

    async function cancelRandom(uid) {
        await db().collection('queue').doc(uid).delete().catch(() => {});
    }

    function subscribeInvites(uid, callback) {
        /* Второй фильтр нужен, чтобы запрос проходил security rules:
           приглашённый всегда является участником партии. */
        const query = db().collection('games')
            .where('invited', '==', uid)
            .where('players', 'array-contains', uid)
            .limit(20);
        return query.onSnapshot(snap => {
            const invites = snap.docs
                .map(withId)
                .filter(game => game.status === 'invited' && !isExpired(game));
            callback(invites);
        }, error => callback([], error));
    }

    async function sendFriendRequest(from, to, fromName, fromCode) {
        if (!from || !to || from === to) throw new Error('Нельзя добавить себя');
        /* Новый документ каждый раз: не нужно читать несуществующий doc
           (правила Firestore не любят resource.data у null). */
        const ref = db().collection('friendRequests').doc();
        await ref.set({
            from,
            to,
            fromName: fromName || 'Игрок',
            fromCode: fromCode || '',
            status: 'pending',
            createdAt: Net.serverTimestamp(),
            expiresAt: expiry(REQUEST_TTL)
        });
        return 'pending';
    }

    async function acceptFriendRequest(requestId) {
        await db().collection('friendRequests').doc(requestId).update({
            status: 'accepted',
            acceptedAt: Net.serverTimestamp()
        });
    }

    async function declineFriendRequest(requestId) {
        await db().collection('friendRequests').doc(requestId).update({
            status: 'declined',
            updatedAt: Net.serverTimestamp()
        });
    }

    async function deleteFriendRequest(requestId) {
        await db().collection('friendRequests').doc(requestId).delete().catch(() => {});
    }

    function subscribeFriendRequests(uid, callback) {
        const incoming = db().collection('friendRequests').where('to', '==', uid).limit(30);
        const outgoing = db().collection('friendRequests').where('from', '==', uid).limit(30);
        let incomingList = [];
        let outgoingList = [];

        const emit = () => callback({ incoming: incomingList, outgoing: outgoingList });
        const unsubIn = incoming.onSnapshot(snap => {
            const seen = new Set();
            incomingList = snap.docs
                .map(withId)
                .filter(item => item.status === 'pending')
                /* Один и тот же игрок мог отправить несколько заявок. */
                .filter(item => {
                    if (seen.has(item.from)) return false;
                    seen.add(item.from);
                    return true;
                });
            emit();
        }, error => callback({ incoming: [], outgoing: outgoingList }, error));
        const unsubOut = outgoing.onSnapshot(snap => {
            outgoingList = snap.docs.map(withId).filter(item => item.status === 'accepted');
            emit();
        }, error => callback({ incoming: incomingList, outgoing: [] }, error));

        return () => {
            unsubIn();
            unsubOut();
        };
    }

    async function getUser(uid) {
        const snap = await db().collection('users').doc(uid).get();
        return snap.exists ? withId(snap) : null;
    }

    function subscribeUser(uid, callback) {
        return db().collection('users').doc(uid).onSnapshot(snap => {
            callback(snap.exists ? withId(snap) : null);
        }, error => callback(null, error));
    }

    async function getUserByCode(code) {
        const normalized = String(code || '').trim().toUpperCase();
        if (!normalized) return null;
        const snap = await db().collection('users').where('code', '==', normalized).limit(1).get();
        return snap.empty ? null : withId(snap.docs[0]);
    }

    async function setUser(uid, data, merge) {
        await db().collection('users').doc(uid).set(data, { merge: !!merge });
    }

    /* Атомарное резервирование кода: если код уже занят другим uid,
       вызывающий должен сгенерировать новый и повторить попытку. */
    async function reserveCode(uid, code) {
        const normalized = String(code || '').trim().toUpperCase();
        if (!normalized || normalized.length !== 6) return false;
        const ref = db().collection('profileCodes').doc(normalized);
        return db().runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) {
                tx.set(ref, { code: normalized, uid, createdAt: Net.serverTimestamp() });
                return true;
            }
            return snap.data().uid === uid;
        });
    }

    async function recordStats(uid, result) {
        const key = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
        const update = {};
        update['stats.' + key] = Net.increment(1);
        update.updatedAt = Net.serverTimestamp();
        await db().collection('users').doc(uid).update(update);
    }

    /* Онлайн-ранг и цепочка побед пишутся только после того, как клиент
       убедился в трёх разных соперниках выше его ранга. */
    async function setRank(uid, rank, ladder) {
        await db().collection('users').doc(uid).update({
            rank: rankOf(rank),
            ladder: normalizeLadder(ladder),
            updatedAt: Net.serverTimestamp()
        });
    }

    async function setPresence(uid, online) {
        await db().collection('users').doc(uid).update({
            online: !!online,
            lastSeen: Net.serverTimestamp()
        }).catch(() => {});
    }

    function subscribeFriends(uid, callback) {
        return db().collection('users').doc(uid).collection('friends').onSnapshot(snap => {
            callback(snap.docs.map(withId));
        }, error => callback([], error));
    }

    async function addFriend(uid, friend) {
        await db().collection('users').doc(uid).collection('friends').doc(friend.uid).set({
            uid: friend.uid,
            name: friend.name || 'Игрок',
            code: friend.code || '',
            rank: rankOf(friend.rank),
            since: Net.serverTimestamp()
        }, { merge: true });
    }

    async function removeFriend(uid, friendUid) {
        await db().collection('users').doc(uid).collection('friends').doc(friendUid).delete();
    }

    async function createRoom({ code, hostUid, hostName, hostRank }) {
        await db().collection('rooms').doc(code).set({
            code,
            hostUid,
            hostName,
            hostRank: rankOf(hostRank),
            hostSide: 'X',
            status: 'waiting',
            gameId: null,
            createdAt: Net.serverTimestamp(),
            expiresAt: expiry(INVITE_TTL)
        });
    }

    async function getRoom(code) {
        const snap = await db().collection('rooms').doc(String(code || '').toUpperCase()).get();
        return snap.exists ? withId(snap) : null;
    }

    function subscribeRoom(code, callback) {
        return db().collection('rooms').doc(code).onSnapshot(snap => {
            callback(snap.exists ? withId(snap) : null);
        }, error => callback(null, error));
    }

    async function joinRoom(code, joiner) {
        const roomRef = db().collection('rooms').doc(code);
        return db().runTransaction(async tx => {
            const snap = await tx.get(roomRef);
            if (!snap.exists) throw new Error('Комната не найдена');
            const room = snap.data();
            if (room.status !== 'waiting') throw new Error('Комната уже занята');
            if (room.hostUid === joiner.uid) throw new Error('Это ваша комната');

            const gameRefNew = db().collection('games').doc();
            const sides = {};
            sides[room.hostUid] = 'X';
            sides[joiner.uid] = 'O';
            const names = {};
            names[room.hostUid] = room.hostName || 'Хозяин';
            names[joiner.uid] = joiner.name || 'Гость';
            const ranks = ranksMap([room.hostUid, joiner.uid], {
                [room.hostUid]: room.hostRank,
                [joiner.uid]: joiner.rank
            });

            tx.set(gameRefNew, {
                mode: 'friend',
                players: [room.hostUid, joiner.uid],
                sides,
                names,
                ranks,
                invited: null,
                status: 'active',
                current: 'X',
                ply: 0,
                winner: null,
                rematchOf: null,
                rematchGameId: null,
                roomCode: code,
                expiresAt: expiry(GAME_TTL),
                createdAt: Net.serverTimestamp(),
                updatedAt: Net.serverTimestamp()
            });
            tx.update(roomRef, {
                status: 'matched',
                gameId: gameRefNew.id,
                joinerUid: joiner.uid,
                updatedAt: Net.serverTimestamp()
            });
            return gameRefNew.id;
        });
    }

    async function deleteRoom(code) {
        await db().collection('rooms').doc(code).delete().catch(() => {});
    }

    return {
        createGame,
        getGame,
        subscribeGame,
        fetchMoves,
        sendMove,
        setStatus,
        acceptInvite,
        declineInvite,
        requestRematch,
        findActiveGame,
        findRandom,
        cancelRandom,
        subscribeInvites,
        sendFriendRequest,
        acceptFriendRequest,
        declineFriendRequest,
        deleteFriendRequest,
        subscribeFriendRequests,
        getUser,
        subscribeUser,
        getUserByCode,
        setUser,
        reserveCode,
        recordStats,
        setRank,
        rankOf,
        setPresence,
        subscribeFriends,
        addFriend,
        removeFriend,
        createRoom,
        getRoom,
        subscribeRoom,
        joinRoom,
        deleteRoom,
        isExpired,
        millis
    };
})();
