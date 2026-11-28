'use strict';

/* ============================================================
   TOOF — лобби: случайный соперник, комнаты по коду,
   приглашения друзьям и возврат в активную игру.
   ============================================================ */

const Lobby = (() => {
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let invites = [];
    let inviteUnsub = null;
    let onInvite = null;
    let onInviteCount = null;
    let searching = false;
    let roomUnsub = null;
    let roomCode = null;

    function randomCode() {
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
        }
        return code;
    }

    function myName() {
        return Profile.state.name || 'Игрок';
    }

    function notifyCount() {
        if (onInviteCount) onInviteCount(invites.length);
    }

    function setInviteHandlers(handlers) {
        onInvite = handlers && handlers.onInvite ? handlers.onInvite : null;
        onInviteCount = handlers && handlers.onCount ? handlers.onCount : null;
    }

    function start() {
        if (!Net.ready || inviteUnsub) return;
        inviteUnsub = NetTransport.subscribeInvites(Profile.state.uid, list => {
            const previous = new Set(invites.map(item => item.id));
            invites = list;
            notifyCount();
            for (const invite of invites) {
                if (!previous.has(invite.id) && onInvite) onInvite(invite);
            }
        });
    }

    function stop() {
        if (inviteUnsub) inviteUnsub();
        inviteUnsub = null;
        invites = [];
        notifyCount();
    }

    async function openGame(gameId) {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        const game = await NetTransport.getGame(gameId);
        if (!game) throw new Error('Игра не найдена');
        if (!game.players || game.players.indexOf(Profile.state.uid) === -1) {
            throw new Error('Вы не участник этой игры');
        }

        const mySide = game.sides[Profile.state.uid];
        const otherUid = game.players.find(uid => uid !== Profile.state.uid);
        const opponentName = (game.names && game.names[otherUid]) || 'Соперник';

        const session = createOnlineSession({
            transport: NetTransport,
            protocol: NetProtocol,
            gameId,
            myUid: Profile.state.uid,
            mySide,
            opponentName,
            status: game.status,
            onUpdate: state => UI.onlineUpdate(session, state),
            onError: error => UI.onlineError(error)
        });

        UI.startOnline(session);
        session.start();
        return session;
    }

    async function findRandom() {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        if (searching) return null;
        searching = true;
        try {
            const gameId = await NetTransport.findRandom({
                uid: Profile.state.uid,
                name: myName(),
                code: Profile.state.code,
                rank: Profile.state.rank
            }, { timeoutMs: 20000, pollMs: 2000 });

            if (!gameId) return null;
            await openGame(gameId);
            return gameId;
        } finally {
            searching = false;
        }
    }

    async function cancelRandom() {
        searching = false;
        if (Net.ready) await NetTransport.cancelRandom(Profile.state.uid);
    }

    async function createFriendRoom() {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        let code = randomCode();
        for (let i = 0; i < 5; i++) {
            const existing = await NetTransport.getRoom(code).catch(() => null);
            if (!existing) break;
            code = randomCode();
        }

        await NetTransport.createRoom({
            code,
            hostUid: Profile.state.uid,
            hostName: myName(),
            hostRank: Profile.state.rank
        });

        roomCode = code;
        if (roomUnsub) roomUnsub();
        roomUnsub = NetTransport.subscribeRoom(code, room => {
            if (!room || !room.gameId) return;
            const gameId = room.gameId;
            closeRoom();
            openGame(gameId).catch(error => UI.onlineError(error));
        });

        return code;
    }

    async function joinRoom(code) {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        const gameId = await NetTransport.joinRoom(String(code || '').trim().toUpperCase(), {
            uid: Profile.state.uid,
            name: myName(),
            rank: Profile.state.rank
        });
        await openGame(gameId);
        return gameId;
    }

    function closeRoom() {
        if (roomUnsub) roomUnsub();
        roomUnsub = null;
        if (roomCode) NetTransport.deleteRoom(roomCode).catch(() => {});
        roomCode = null;
    }

    async function challenge(friend) {
        if (!Net.ready) throw new Error('Онлайн не настроен');
        if (!friend || !friend.uid) throw new Error('Друг не найден');
        if (friend.uid === Profile.state.uid) throw new Error('Нельзя вызвать себя');

        const sides = {};
        sides[Profile.state.uid] = 'X';
        sides[friend.uid] = 'O';
        const names = {};
        names[Profile.state.uid] = myName();
        names[friend.uid] = friend.name || 'Друг';
        const ranks = {};
        ranks[Profile.state.uid] = Profile.state.rank;
        ranks[friend.uid] = friend.rank || 0;

        const gameId = await NetTransport.createGame({
            mode: 'friend',
            players: [Profile.state.uid, friend.uid],
            sides,
            names,
            ranks,
            invited: friend.uid,
            status: 'invited'
        });

        await openGame(gameId);
        return gameId;
    }

    async function acceptInvite(invite) {
        if (!invite || !invite.id) return;
        await NetTransport.acceptInvite(invite.id);
        invites = invites.filter(item => item.id !== invite.id);
        notifyCount();
        await openGame(invite.id);
    }

    async function declineInvite(invite) {
        if (!invite || !invite.id) return;
        await NetTransport.declineInvite(invite.id);
        invites = invites.filter(item => item.id !== invite.id);
        notifyCount();
    }

    async function findActiveGame() {
        if (!Net.ready) return null;
        return NetTransport.findActiveGame(Profile.state.uid);
    }

    async function rematch(session) {
        if (!session) return null;
        const gameId = await session.rematch();
        if (!gameId) return null;
        await openGame(gameId);
        return gameId;
    }

    async function leave(session) {
        if (session) {
            try { await session.leave(); } catch (e) { /* уже вышли */ }
            session.destroy();
        }
    }

    return {
        start,
        stop,
        setInviteHandlers,
        openGame,
        findRandom,
        cancelRandom,
        createFriendRoom,
        joinRoom,
        closeRoom,
        challenge,
        acceptInvite,
        declineInvite,
        findActiveGame,
        rematch,
        leave,
        get invites() { return invites.slice(); },
        get searching() { return searching; }
    };
})();
