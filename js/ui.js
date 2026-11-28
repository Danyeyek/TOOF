'use strict';

/* ============================================================
   Интерфейс: отрисовка поля, обработка кликов, режимы игры.
   ============================================================ */

const UI = (() => {
    const NAMES = {
        local: { X: 'Игрок 1', O: 'Игрок 2' },
        bot: { X: 'Вы', O: 'Бот' }
    };

    /* Ключ — сторона игрока и сторона первого хода. Цвет игрока задан
       настройкой, поэтому цвет первого хода зависит от того, кто он. */
    const BOT_START_MESSAGE = {
        'XX': 'Вы ходите первым (оранжевым).',
        'XO': 'Бот ходит первым (фиолетовым). Вы — оранжевый.',
        'OO': 'Вы ходите первым (фиолетовым).',
        'OX': 'Бот ходит первым (оранжевым). Вы — фиолетовый.'
    };

    const state = {
        mode: 'local',
        human: 'X',
        botTimer: null,
        message: '',
        messageKind: '',
        mySide: 'X',
        opponentName: '',
        opponentUid: '',
        opponentRank: 0,
        gameMode: 'friend',
        session: null,
        awaitingEcho: false,
        onlineStatus: 'active',
        onlineClosing: false,
        surrendering: false,
        finished: false,
        lastPly: 0,
        pendingInvite: null,
        resumable: false
    };

    const $ = id => document.getElementById(id);

    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.toggle('is-active', screen.id === id);
        });
        closeSettings();
        const resume = $('resumeGameBtn');
        if (resume) resume.hidden = !(state.session || state.resumable);
        if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    }

    function setResumable(value) {
        state.resumable = !!value;
        const resume = $('resumeGameBtn');
        if (resume) resume.hidden = !(state.session || state.resumable);
    }

    function closeSettings() {
        const popover = $('settingsPopover');
        if (!popover) return;
        popover.hidden = true;
        const button = $('settingsButton');
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.blur();
        }
    }

    function setMessage(text, kind) {
        state.message = text;
        state.messageKind = kind || '';
        const box = $('gameMessage');
        box.textContent = t(text);
        box.className = 'message' + (kind ? ' ' + kind : '');
    }

    function nameOf(symbol) {
        if (state.mode === 'online') {
            return symbol === state.mySide ? t('Вы') : state.opponentName;
        }
        if (state.mode === 'bot') {
            return symbol === state.human ? t('Вы') : t('Бот');
        }
        return t(NAMES[state.mode][symbol]);
    }

    function cellWord(count) {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return t('клетка');
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t('клетки');
        return t('клеток');
    }

    function ariaCell(r, c, value) {
        const swapped = document.documentElement.classList.contains('prefer-purple');
        const orange = value === 'X' ? !swapped : swapped;
        const what = t(value === EMPTY ? 'пусто' : orange ? 'оранжевая' : 'фиолетовая');
        let extra = '';
        if (Game.isLocked(r, c)) extra = t(', зафиксировано');
        else if (Game.isSelected(r, c)) extra = t(', выделено');
        return what + t(', строка ') + (r + 1) + t(', столбец ') + (c + 1) + extra;
    }

    /* Карта «клетка → фигура» позволяет обвести только внешние стороны
       клеток — контур идёт по форме фигуры, а не по квадрату вокруг неё. */
    function figureCellMap() {
        const map = new Map();
        const figures = Game.figures && Game.figures.length
            ? Game.figures
            : groupsFromOwners([...Game.locked], [...Game.owners]);
        figures.forEach((figure, index) => {
            figure.cells.forEach(k => map.set(k, index));
        });
        return map;
    }

    function renderBoard() {
        const selecting = Game.selected.length > 0;
        const figMap = figureCellMap();
        let html = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const value = Game.board[r][c];
                let cls = 'cell';
                if (value === 'X') cls += ' x';
                else if (value === 'O') cls += ' o';
                if (Game.isLocked(r, c)) cls += ' locked';

                const figure = figMap.get(key(r, c));
                if (figure !== undefined) {
                    cls += ' figure-cell';
                    if (figMap.get(key(r - 1, c)) !== figure) cls += ' edge-top';
                    if (figMap.get(key(r + 1, c)) !== figure) cls += ' edge-bottom';
                    if (figMap.get(key(r, c - 1)) !== figure) cls += ' edge-left';
                    if (figMap.get(key(r, c + 1)) !== figure) cls += ' edge-right';
                }

                // Подсветка одна: выбранные клетки важнее «только что поставленной».
                if (Game.isSelected(r, c)) {
                    cls += ' selected';
                } else if (!selecting && Game.pending &&
                           Game.pending[0] === r && Game.pending[1] === c) {
                    cls += ' pending';
                }

                html += '<div class="' + cls + '" role="gridcell" data-r="' + r + '" data-c="' + c +
                    '" aria-label="' + ariaCell(r, c, value) + '"></div>';
            }
        }
        $('boardGrid').innerHTML = html;
    }

    function render() {
        /* В сети цвета привязаны к сторонам: X оранжевый, O фиолетовый.
           Своя настройка не перекрашивает ходы соперника. */
        if (state.mode === 'online') Colors.applyFixed();
        else Colors.applyFor(state.mode === 'bot' ? state.human : 'X');
        renderBoard();

        $('xName').textContent = nameOf('X');
        $('oName').textContent = nameOf('O');
        $('xSectors').textContent = Game.sectorsOf('X').size + '/' + SECTORS_TO_WIN;
        $('oSectors').textContent = Game.sectorsOf('O').size + '/' + SECTORS_TO_WIN;

        $('playerX').classList.toggle('is-turn', !Game.over && Game.current === 'X');
        $('playerO').classList.toggle('is-turn', !Game.over && Game.current === 'O');

        const turn = $('turnIndicator');
        if (Game.over) {
            turn.textContent = Game.winner ? '🏆 ' + nameOf(Game.winner) : t('🤝 Ничья');
            turn.className = 'turn is-over';
        } else {
            turn.textContent = t('Ход: ') + nameOf(Game.current);
            turn.className = 'turn ' + (Game.current === 'X' ? 'turn-x' : 'turn-o');
        }

        const canAct = canActNow();
        /* Пока идёт выделение, доступна только кнопка фигуры. Подтверждение
           хода появляется после закрашивания и снятия выделения. */
        $('fixFigureBtn').hidden = !(canAct && Game.selected.length > 0);
        $('confirmMoveBtn').hidden = !(canAct && !!Game.pending && !Game.selected.length);
        $('resetButton').hidden = !Game.over || state.mode === 'online';
        $('settingsButton').hidden = state.mode !== 'bot';
        if (state.mode !== 'bot') closeSettings();

        const online = state.mode === 'online';
        const ended = Game.over;
        const friendGame = online && state.gameMode === 'friend';
        const randomGame = online && state.gameMode === 'random';

        const surrender = $('surrenderButton');
        if (surrender) {
            surrender.hidden = !online || ended ||
                state.onlineStatus === 'surrendered' || state.onlineStatus === 'closed';
            if (!surrender.hidden) surrender.disabled = false;
        }
        /* После сдачи в игре с другом обоим предлагается реванш или выход;
           в случайной игре — новая игра с новым соперником. */
        const rematch = $('rematchButton');
        if (rematch) rematch.hidden = !(friendGame && ended);
        const newGame = $('onlineNewGameButton');
        if (newGame) newGame.hidden = !(randomGame && ended);
        const exit = $('exitGameButton');
        if (exit) exit.hidden = !(friendGame && ended);

        const netStatus = $('netStatus');
        if (netStatus) {
            let text = '';
            if (online) {
                if (state.onlineStatus === 'invited') text = t('Ждём, пока друг примет приглашение…');
                else if (state.onlineStatus === 'abandoned') text = t('Соперник вышел из игры.');
                else if (state.onlineStatus === 'surrendered') text = t('Партия завершена досрочно.');
                else if (state.onlineStatus === 'closed') text = t('Комната закрыта.');
                else if (state.onlineStatus === 'rematch') text = t('Соперник предлагает реванш.');
                else if (state.awaitingEcho) text = t('Отправляем ход…');
            }
            netStatus.textContent = text;
            netStatus.hidden = !text;
        }

        $('modeIndicator').textContent = state.mode === 'bot'
            ? t('Против бота · ') + t(Bot.name()) +
                (Bot.rankName() ? ' · ' + rankLabel(Bot.rankName()) : '')
            : state.mode === 'online'
                ? t('По сети · против ') + state.opponentName
                : t('На одном экране');
    }

    function finish(winner) {
        /* Одна партия = один результат. Повторный вызов не должен дважды
           двигать серию побед/поражений и автопереключать сложность. */
        if (state.finished) return;
        state.finished = true;
        Game.over = true;
        Game.winner = winner;

        let text;
        let kind;
        if (state.mode === 'online') {
            const iWon = winner === state.mySide;
            if (iWon) {
                Sound.play('win');
                text = 'Вы победили! 🎉';
                kind = 'win';
            } else if (winner) {
                Sound.play('lose');
                text = t('Победил ') + nameOf(winner) + '.';
                kind = 'lose';
            } else {
                text = 'Ничья — свободных клеток не осталось.';
                kind = 'draw';
            }
            Profile.recordResult(winner ? (iWon ? 'win' : 'loss') : 'draw', {
                uid: state.opponentUid,
                rank: state.opponentRank
            });
        } else if (state.mode === 'bot') {
            if (winner === state.human) {
                Sound.play('win');
                text = 'Вы победили! 🎉';
                kind = 'win';
            } else if (winner) {
                Sound.play('lose');
                text = 'Бот победил. Попробуйте ещё раз.';
                kind = 'lose';
            } else {
                text = 'Ничья — свободных клеток не осталось.';
                kind = 'draw';
            }

            const result = Bot.recordResult(winner === state.human, !winner);
            if (result.changed) {
                text += result.direction === 'up'
                    ? t(' Сложность повышена: ') + t(result.name) + '.'
                    : t(' Сложность снижена: ') + t(result.name) + '.';
            }
            if (typeof CustomEvent === 'function') {
                document.dispatchEvent(new CustomEvent('toof:difficulty'));
                if (result.rankChanged) {
                    document.dispatchEvent(new CustomEvent('toof:rank', {
                        detail: { rank: result.rankChanged }
                    }));
                }
            }
        } else if (winner) {
            Sound.play('win');
            text = nameOf(winner) + t(' победил! 🎉');
            kind = 'win';
        } else {
            text = 'Ничья — свободных клеток не осталось.';
            kind = 'draw';
        }

        setMessage(text, kind);
        render();
    }

    /* Выход из незавершённой партии засчитывается как поражение:
       ломает серию побед и пополняет серию поражений. */
    function exitToMenu() {
        if (!state.finished) {
            if (state.mode === 'bot') {
                finish(Game.over ? Game.winner : (state.human === 'X' ? 'O' : 'X'));
            } else if (state.mode === 'online' && state.session) {
                if (!Game.over && state.onlineStatus === 'active' &&
                    !state.surrendering && typeof Lobby !== 'undefined') {
                    /* В сети приравниваем выход к сдаче: соперник увидит тот же
                       результат, а цепочка побед в профиле сбросится. */
                    const session = state.session;
                    state.surrendering = true;
                    Lobby.surrender(session).catch(error => {
                        state.surrendering = false;
                        onlineError(error);
                    });
                    session.destroy();
                    if (state.session === session) state.session = null;
                    state.resumable = false;
                }
                finish(Game.over ? Game.winner : (state.mySide === 'X' ? 'O' : 'X'));
            }
        }
        showScreen('menuScreen');
    }

    function scheduleBot() {
        if (state.mode !== 'bot' || Game.over || Game.current === state.human) return;

        clearTimeout(state.botTimer);
        setMessage('Бот думает…');
        state.botTimer = setTimeout(() => {
            const decision = Bot.decide(Game.board, Game.locked, Game.current, Game.owners);
            const move = decision && decision.place;
            if (!move) {
                if (Game.checkDraw()) finish(null);
                return;
            }

            Game.place(move[0], move[1]);
            Sound.play('place');

            let fixed = false;
            if (decision.fix) {
                for (const cell of decision.fix) Game.toggle(cell[0], cell[1]);
                const result = Game.fix();
                fixed = result.ok;
                if (!fixed) Game.clearSelection();
            }
            if (fixed) Sound.play('figure');
            if (!Game.over) Game.confirm();

            if (Game.over) {
                finish(Game.winner);
                return;
            }
            setMessage(fixed ? 'Бот зафиксировал фигуру. Ваш ход.' : 'Ваш ход.');
            render();
        }, 300 + Math.random() * 400);
    }

    function canActNow() {
        if (Game.over) return false;
        if (state.mode === 'online') {
            return state.onlineStatus === 'active' &&
                !state.awaitingEcho &&
                Game.current === state.mySide;
        }
        return state.mode === 'local' || Game.current === state.human;
    }

    /* Смену сложности можно применить сразу до первого хода и после конца партии. */
    function canChangeDifficulty() {
        return state.mode === 'bot' && (Game.over ||
            (!Game.figures.length &&
             !Game.board.some(row => row.some(value => value !== EMPTY))));
    }

    function cellClick(r, c) {
        if (!canActNow()) return;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;

        if (Game.board[r][c] === EMPTY) {
            if (!Game.place(r, c)) {
                if (Game.pending && Game.isLocked(Game.pending[0], Game.pending[1])) {
                    setMessage('Клетка уже закрашена.');
                }
                return;
            }
            Sound.play('place');
            setMessage('Клетка закрашена.');
            render();
            return;
        }

        if (!Game.toggle(r, c)) {
            if (Game.selected.length >= MAX_FIGURE) {
                setMessage(t('В фигуре не больше {n} клеток.', { n: MAX_FIGURE }));
            }
            return;
        }

        Sound.play('click');
        const count = Game.selected.length;
        setMessage(count
            ? t('Выделено {n} {word}.', { n: count, word: cellWord(count) })
            : t('Выделение снято.'));
        render();
    }

    function onlineCommit() {
        if (!state.session) return;
        const settled = Game.settleSelection();
        if (settled && settled.ok) Sound.play('figure');
        const move = NetProtocol.moveFromGame(Game);
        if (!move) {
            setMessage('Сначала закрасьте клетку.');
            return;
        }

        const check = state.session.validateLocal(move);
        if (!check.ok) {
            const reasons = {
                size: 'Неправильная фигура.',
                fix: 'Неправильная фигура.',
                shape: 'Неправильная фигура.',
                'not-a-figure': 'Неправильная фигура.',
                place: 'Эта клетка уже занята.',
                turn: 'Сейчас не ваш ход.',
                over: 'Игра уже закончена.'
            };
            Game.restore(state.session.snapshot);
            setMessage(reasons[check.reason] || 'Так ходить нельзя.');
            render();
            return;
        }

        state.awaitingEcho = true;
        setMessage('Отправляем ход…');
        render();

        state.session.commitMove(move).then(result => {
            if (!result.ok) {
                state.awaitingEcho = false;
                /* Ход мог зафиксировать фигуру локально. Если отправка не
                   прошла, возвращаем проверенное состояние сессии. */
                if (state.session) Game.restore(state.session.snapshot);
                if (result.reason !== 'pending') {
                    setMessage('Не удалось отправить ход. Проверьте соединение.');
                }
                render();
                return;
            }
            /* Победа засчитывается после успешной записи хода в журнал.
               Повторный вызов из эха или finish() ничего не изменит. */
            if (result.winner) {
                state.awaitingEcho = false;
                finish(result.winner);
            }
        });
    }

    function onFix() {
        if (!canActNow()) return;
        const result = Game.fix();
        if (!result.ok) {
            const reasons = {
                size: 'Неправильная фигура.',
                'not-a-figure': 'Неправильная фигура.',
                over: 'Игра уже закончена.'
            };
            setMessage(reasons[result.reason] || 'Не получилось зафиксировать фигуру.');
            Game.clearSelection();
            render();
            return;
        }

        Sound.play('figure');
        if (result.winner) {
            if (state.mode === 'online') {
                /* В онлайне победа фиксируется только после того, как ход
                   принят журналом: иначе статус/статистика разойдутся с партией. */
                onlineCommit();
            } else {
                finish(result.winner);
            }
            return;
        }
        /* Клетка уже закрашена: подтверждение фигуры сразу завершает ход,
           отдельная кнопка подтверждения хода больше не нужна. */
        if (Game.pending) {
            if (state.mode === 'online') onlineCommit();
            else completeTurn();
            return;
        }
        setMessage('Фигура зафиксирована. Закрасьте клетку.');
        render();
    }

    function completeTurn() {
        const result = Game.confirm();
        if (!result.ok) return;
        Sound.play('confirm');
        if (result.fixed && result.fixed.length) Sound.play('figure');

        if (result.winner) {
            finish(result.winner);
            return;
        }
        if (result.draw) {
            finish(null);
            return;
        }
        setMessage(t('Ход передан. Ходит ') + nameOf(Game.current) + '.');
        render();
        scheduleBot();
    }

    function onConfirm() {
        if (!canActNow()) return;
        if (state.mode === 'online') {
            onlineCommit();
            return;
        }
        completeTurn();
    }

    function start(mode, opts) {
        if (state.session) {
            if (typeof Lobby !== 'undefined') Lobby.leave(state.session);
            state.session = null;
        }
        state.mode = mode;
        /* Сторона игрока закреплена выбранным цветом. Первый ход задаётся
           отдельно: в бот-режиме его решает монетка уровня, в обучении
           начинает человек; в локальном режиме первым всегда ходит X. */
        state.human = mode === 'bot' ? Colors.preferredSide() : 'X';
        const firstSide = mode === 'bot'
            ? (opts && opts.fixedFirst ? state.human : Bot.firstSide(Bot.level, state.human))
            : state.human;
        state.awaitingEcho = false;
        state.onlineStatus = 'active';
        state.onlineClosing = false;
        state.surrendering = false;
        state.finished = false;
        state.lastPly = 0;
        state.gameMode = 'friend';
        state.opponentName = '';
        state.opponentUid = '';
        state.opponentRank = 0;
        state.mySide = 'X';
        state.resumable = false;
        clearTimeout(state.botTimer);
        Game.reset(firstSide);
        if (mode === 'bot') {
            setMessage(BOT_START_MESSAGE[state.human + firstSide]);
        } else {
            setMessage(Colors.shouldSwap('X')
                ? 'Первым ходит фиолетовый — Игрок 1.'
                : 'Первым ходит оранжевый — Игрок 1.');
        }
        $('difficultyConfirm').hidden = true;
        showScreen('gameScreen');
        render();
        if (mode === 'bot' && Game.current !== state.human) scheduleBot();
    }

    function startOnline(session) {
        if (state.session && state.session !== session) state.session.destroy();
        state.mode = 'online';
        state.session = session;
        state.mySide = session.mySide || 'X';
        state.opponentName = session.opponentName || t('Соперник');
        state.opponentUid = session.opponentUid || '';
        state.opponentRank = session.opponentRank || 0;
        state.gameMode = session.mode || 'friend';
        state.awaitingEcho = false;
        state.onlineStatus = session.status || 'connecting';
        state.onlineClosing = false;
        state.surrendering = false;
        state.finished = false;
        state.lastPly = session.appliedPly || 0;
        state.resumable = false;
        clearTimeout(state.botTimer);
        Game.restore(session.snapshot);
        $('difficultyConfirm').hidden = true;
        showScreen('gameScreen');
        setMessage(state.onlineStatus === 'invited'
            ? 'Приглашение отправлено. Ждём друга…'
            : t('Вы играете ') + t(state.mySide === 'X' ? 'оранжевым' : 'фиолетовым') + '.');
        render();
    }

    /* Победитель при сдаче вычисляется из сторон противников. */
    function winnerBySurrender(game, by) {
        if (!by || !game || !game.sides || !game.sides[by]) return null;
        return game.sides[by] === 'X' ? 'O' : 'X';
    }

    /* Один игрок вышел — закрываем сессию и у него, и у соперника. */
    function closeOnlineRoom(message) {
        if (state.onlineClosing) return;
        state.onlineClosing = true;
        const session = state.session;
        if (session) {
            session.destroy();
            if (state.session === session) state.session = null;
        }
        state.surrendering = false;
        state.resumable = false;
        setMessage(message, 'lose');
        showScreen('onlineScreen');
        if (typeof notify === 'function') notify(message);
    }

    function onlineUpdate(session, data) {
        if (state.mode !== 'online' || state.session !== session) return;

        const previousPly = state.lastPly;
        const boardChanged = (data.appliedPly || 0) !== previousPly;
        /* Не стираем незавершённый выбор игрока из-за служебного
           обновления документа партии (статус, presence и т. п.). */
        const busy = !!Game.pending || !!Game.selected.length ||
            !!Game.turnFigures.length || state.awaitingEcho;
        if (boardChanged || !busy) Game.restore(data.snapshot);
        const game = data.game || {};
        state.mySide = data.mySide || state.mySide;
        state.opponentName = data.opponentName || state.opponentName;
        if (data.opponentUid !== undefined) state.opponentUid = data.opponentUid;
        if (data.opponentRank !== undefined) state.opponentRank = data.opponentRank;
        state.gameMode = data.mode || game.mode || state.gameMode || 'friend';
        state.awaitingEcho = !!data.awaitingEcho;
        state.onlineStatus = data.status || state.onlineStatus;
        state.lastPly = data.appliedPly || 0;

        const fresh = (data.moves || []).slice(previousPly);
        for (const move of fresh) {
            if (move.side !== state.mySide) {
                Sound.play(move.fix ? 'figure' : 'place');
            }
        }

        /* Выход одного закрывает комнату у обоих. */
        if (state.onlineStatus === 'closed') {
            const by = data.closedBy || game.closedBy;
            const byMe = typeof Profile !== 'undefined' && !!by && by === Profile.state.uid;
            closeOnlineRoom(byMe
                ? 'Вы вышли из комнаты. Соперник тоже вышел.'
                : 'Соперник вышел из комнаты. Вы тоже вышли.');
            return;
        }

        /* Сдача: победа засчитывается обоим клиентам, кнопка сдачи скрывается
           отрисовкой уже законченной партии. */
        if (state.onlineStatus === 'surrendered' && !state.finished) {
            const by = data.surrenderedBy || game.surrenderedBy;
            const winner = data.surrenderWinner || winnerBySurrender(game, by);
            if (winner) {
                finish(winner);
                setMessage(winner === state.mySide
                    ? 'Соперник сдался. Вы победили! 🎉'
                    : t('Вы сдались.') + ' ' + t('Победил ') + nameOf(winner) + '.',
                winner === state.mySide ? 'win' : 'lose');
            }
        }

        if (!state.finished) {
            if (state.onlineStatus === 'invited') {
                setMessage('Приглашение отправлено. Ждём друга…');
            } else if (state.onlineStatus === 'abandoned') {
                setMessage('Соперник вышел из игры.', 'lose');
            } else if (state.onlineStatus === 'rematch') {
                setMessage('Соперник предлагает реванш.');
            }
        }

        render();

        if (data.snapshot && data.snapshot.over) {
            finish(data.winner || null);
        }
    }

    function onlineError(error) {
        const text = error && error.message ? t(error.message) : t('Не удалось связаться с соперником.');
        setMessage(t('Сеть: ') + text, 'lose');
        render();
    }

    function showInvite(invite) {
        if (!invite || !invite.id) return;
        state.pendingInvite = invite;
        const box = $('inviteToast');
        const text = $('inviteText');
        if (!box || !text) return;

        const otherUid = (invite.players || []).find(uid => uid !== Profile.state.uid);
        const name = (invite.names && invite.names[otherUid]) || t('Друг');
        text.textContent = name + t(' приглашает в игру');
        box.hidden = false;
    }

    function hideInvite() {
        state.pendingInvite = null;
        const box = $('inviteToast');
        if (box) box.hidden = true;
    }

    function updateInviteBadge(count) {
        const badge = $('onlineBadge');
        if (!badge) return;
        badge.textContent = String(count);
        badge.hidden = !count;
    }

    function hasOnlineSession() {
        return !!state.session;
    }

    function resumeOnline() {
        if (!state.session) return;
        showScreen('gameScreen');
        render();
    }

    function init() {
        $('boardGrid').addEventListener('click', event => {
            const cell = event.target.closest('.cell');
            if (!cell) return;
            cellClick(Number(cell.dataset.r), Number(cell.dataset.c));
        });
        $('fixFigureBtn').addEventListener('click', onFix);
        $('confirmMoveBtn').addEventListener('click', onConfirm);
        $('resetButton').addEventListener('click', () => {
            Sound.play('click');
            start(state.mode);
        });
        $('menuButton').addEventListener('click', () => {
            Sound.play('click');
            exitToMenu();
        });
        $('settingsButton').addEventListener('click', event => {
            Sound.play('click');
            const popover = $('settingsPopover');
            popover.hidden = !popover.hidden;
            const button = event.currentTarget;
            button.setAttribute('aria-expanded', String(!popover.hidden));
            /* При повторном нажатии снимаем фокус/подсветку кнопки. */
            if (popover.hidden) button.blur();
            /* Список всегда показывает реально используемый режим бота. */
            else if (typeof CustomEvent === 'function') {
                document.dispatchEvent(new CustomEvent('toof:difficulty'));
            }
        });
        $('settingsClose').addEventListener('click', () => {
            Sound.play('click');
            closeSettings();
        });

        const surrender = $('surrenderButton');
        if (surrender) surrender.addEventListener('click', () => {
            Sound.play('click');
            if (!state.session || typeof Lobby === 'undefined' || state.surrendering) return;
            state.surrendering = true;
            const session = state.session;
            const friend = state.gameMode === 'friend';
            surrender.hidden = true;
            Lobby.surrender(session).then(() => {
                /* В игре с другом остаёмся: теперь доступны реванш и выход. */
                if (friend) return;
                /* В случайной игре сдающийся сразу выходит, но результат
                   засчитывается ему так же, как и победителю. */
                if (!state.finished) finish(state.mySide === 'X' ? 'O' : 'X');
                session.destroy();
                if (state.session === session) state.session = null;
                state.surrendering = false;
                state.resumable = false;
                showScreen('menuScreen');
            }).catch(error => {
                state.surrendering = false;
                onlineError(error);
            });
        });

        const rematch = $('rematchButton');
        if (rematch) rematch.addEventListener('click', () => {
            Sound.play('click');
            if (state.session && typeof Lobby !== 'undefined') Lobby.rematch(state.session).catch(onlineError);
        });

        const newGame = $('onlineNewGameButton');
        if (newGame) newGame.addEventListener('click', () => {
            Sound.play('click');
            const session = state.session;
            if (session) session.destroy();
            state.session = null;
            state.surrendering = false;
            state.resumable = false;
            showScreen('onlineScreen');
            if (typeof startRandomSearch === 'function') startRandomSearch();
        });

        const exit = $('exitGameButton');
        if (exit) exit.addEventListener('click', () => {
            Sound.play('click');
            const session = state.session;
            if (!session || typeof Lobby === 'undefined') return;
            Lobby.exit(session)
                .then(() => closeOnlineRoom('Вы вышли из комнаты. Соперник тоже вышел.'))
                .catch(onlineError);
        });

        const inviteAccept = $('inviteAccept');
        if (inviteAccept) inviteAccept.addEventListener('click', () => {
            Sound.play('click');
            const invite = state.pendingInvite;
            hideInvite();
            if (!invite || typeof Lobby === 'undefined') return;
            const accept = () => Lobby.acceptInvite(invite).catch(onlineError);
            if (state.session) Lobby.leave(state.session).then(accept).catch(onlineError);
            else accept();
        });

        const inviteDecline = $('inviteDecline');
        if (inviteDecline) inviteDecline.addEventListener('click', () => {
            Sound.play('click');
            const invite = state.pendingInvite;
            hideInvite();
            if (invite && typeof Lobby !== 'undefined') Lobby.declineInvite(invite).catch(onlineError);
        });

        const resume = $('resumeGameBtn');
        if (resume) resume.addEventListener('click', () => {
            Sound.play('click');
            resumeOnline();
        });
    }

    /* Перевод уже наложен I18N: перерисовываем динамические подписи на месте. */
    function refreshLanguage() {
        setMessage(state.message, state.messageKind);
        render();
    }

    return {
        init,
        start,
        startOnline,
        onlineUpdate,
        onlineError,
        showInvite,
        hideInvite,
        updateInviteBadge,
        hasOnlineSession,
        resumeOnline,
        showScreen,
        cellClick,
        onFix,
        onConfirm,
        render,
        refreshLanguage,
        canChangeDifficulty,
        state
    };
})();
