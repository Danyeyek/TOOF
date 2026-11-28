'use strict';

/* ============================================================
   TOOF — онлайн-сессия одной партии.
   Держит снимок, проверяет ходы, ждёт подтверждения из журнала.
   Не трогает DOM: UI подписывается на onUpdate.
   ============================================================ */

function createOnlineSession(options) {
    const transport = options.transport;
    const protocol = options.protocol || NetProtocol;
    const gameId = options.gameId;
    const myUid = options.myUid;

    let snapshot = options.initialSnapshot || protocol.initialSnapshot();
    let game = null;
    let moves = [];
    let mySide = options.mySide || null;
    let opponentName = options.opponentName || 'Соперник';
    let awaitingEcho = false;
    let appliedPly = 0;
    let winner = null;
    let status = options.status || 'connecting';
    let rematchGameId = null;
    let destroyed = false;
    let unsub = null;

    const onUpdate = options.onUpdate || function () {};
    const onError = options.onError || function () {};

    function otherUid() {
        if (!game || !Array.isArray(game.players)) return null;
        return game.players.find(uid => uid !== myUid) || null;
    }

    function refreshNames() {
        if (!game) return;
        const other = otherUid();
        if (other && game.names && game.names[other]) opponentName = game.names[other];
        if (!mySide && game.sides) mySide = game.sides[myUid] || null;
    }

    function emit() {
        if (destroyed) return;
        onUpdate({
            snapshot,
            game,
            moves: moves.slice(),
            mySide,
            opponentName,
            awaitingEcho,
            winner,
            status,
            rematchGameId,
            appliedPly
        });
    }

    function rebuild(list) {
        const sorted = (list || []).slice().sort((a, b) => Number(a.ply) - Number(b.ply));
        const result = protocol.replay(options.initialSnapshot || protocol.initialSnapshot(), sorted.map(item => ({
            side: item.side,
            move: { place: item.place, fix: item.fix || null }
        })));

        if (!result.ok) {
            onError(new Error('Соперник прислал недопустимый ход (ply ' + (result.at + 1) + ')'));
            return false;
        }

        moves = sorted;
        snapshot = result.snapshot;
        winner = result.winner;
        appliedPly = sorted.length;
        return true;
    }

    function handleGame(data) {
        game = data;
        refreshNames();

        if (data.status === 'abandoned') status = 'abandoned';
        else if (data.status === 'finished') status = 'finished';
        else if (data.status === 'invited') status = 'invited';
        else status = 'active';

        if (data.rematchGameId) {
            rematchGameId = data.rematchGameId;
            status = 'rematch';
        }

        emit();
    }

    function handleMoves(list) {
        const previous = appliedPly;
        if (!rebuild(list)) return;
        if (awaitingEcho && appliedPly > previous) awaitingEcho = false;
        emit();
    }

    function handleError(error) {
        onError(error);
    }

    function start() {
        if (unsub) return;
        unsub = transport.subscribeGame(gameId, {
            onGame: handleGame,
            onMoves: handleMoves,
            onError: handleError
        });
    }

    function validateLocal(move) {
        if (!mySide) return { ok: false, reason: 'side' };
        return protocol.reduce(snapshot, mySide, move);
    }

    async function commitMove(move) {
        if (awaitingEcho) return { ok: false, reason: 'pending' };
        if (!mySide) return { ok: false, reason: 'side' };

        const check = validateLocal(move);
        if (!check.ok) return check;

        awaitingEcho = true;
        emit();

        try {
            await transport.sendMove({
                gameId,
                side: mySide,
                ply: appliedPly,
                move,
                winner: check.winner || null
            });
            return { ok: true, winner: check.winner || null };
        } catch (error) {
            awaitingEcho = false;
            await resync().catch(() => {});
            onError(error);
            return { ok: false, reason: 'send', error };
        }
    }

    async function resync() {
        const list = await transport.fetchMoves(gameId);
        if (!rebuild(list)) return false;
        awaitingEcho = false;
        emit();
        return true;
    }

    async function rematch() {
        const id = await transport.requestRematch(gameId);
        rematchGameId = id;
        return id;
    }

    async function leave() {
        await transport.setStatus(gameId, 'abandoned');
    }

    function destroy() {
        destroyed = true;
        if (unsub) unsub();
        unsub = null;
    }

    return {
        start,
        validateLocal,
        commitMove,
        resync,
        rematch,
        leave,
        destroy,
        get snapshot() { return snapshot; },
        get game() { return game; },
        get mySide() { return mySide; },
        get opponentName() { return opponentName; },
        get awaitingEcho() { return awaitingEcho; },
        get winner() { return winner; },
        get status() { return status; },
        get rematchGameId() { return rematchGameId; },
        get appliedPly() { return appliedPly; }
    };
}
