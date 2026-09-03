const fs = require("fs");

/* turikAdmins — дискорд-айди организаторов турика (можно через запятую). Они
   назначают хоста в любой комнате, не будучи хостом: турик ведут снаружи, и
   ждать, пока действующий хост сам передаст управление, некогда. */
function init(wsServer, path, moderKey, turikAdmins, sortMode) {
    const
        fs = require('fs'),
        crypto = require('crypto'),
        app = wsServer.app,
        registry = wsServer.users,
        autoDenialRules = [
            [1, 3], [1, 4], [1, 0], [2, 4]
        ];


    const appDir = registry.config.appDir || __dirname;

    /* Приходят дискорд-айди, а игра знает людей по _id на сайте — переводим одно
       в другое один раз при старте. Кого не нашли, тот просто не организатор */
    const turikAdminIds = new Set();
    (async () => {
        for (const discordId of String(turikAdmins || "").split(",").map((it) => it.trim()).filter(Boolean)) {
            const userId = await registry.authUsers.getByDiscordId(discordId);
            if (userId) turikAdminIds.add(userId);
        }
    })();
    let reportedWordsData = [], rankedGames = [];
    let reportedWords = [], reportedWordsNoMeta = [];
    let reportedWordsView = [];

    const isWordReported = (word, isNoMeta) => {
        return isNoMeta ? reportedWordsNoMeta.includes(word) : reportedWords.includes(word);
    };

    let existingPacks = new Set();
    const updateExistingPacks = () => {
        fs.readdir(`${appDir}/custom`, (err, files) => {
            if (!err && files) {
                existingPacks = new Set(files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
                updateReportView();
            }
        });
    };
    const updateReportView = () => {
        const groups = {};
        const flatReports = [];
        reportedWordsData.forEach(report => {
            if (report.custom || (report.wordList && report.wordList.length > 1)) {
                if (report.custom)
                    report.exists = existingPacks.has(report.packName);
                flatReports.push(report);
            } else {
                const word = report.word || (report.wordList ? report.wordList[0] : null);
                if (word) {
                    const isNoMeta = report.level === 5 || report.currentLevel === 5;
                    const key = word + (isNoMeta ? "_nometa" : "");
                    if (!groups[key]) groups[key] = [];
                    groups[key].push(report);
                }
            }
        });
        const structured = [];
        flatReports.forEach(r => structured.push(r));
        Object.keys(groups).forEach(key => {
            const reports = groups[key];
            const latest = reports[reports.length - 1];
            const history = reports.slice(0, reports.length - 1).reverse();
            structured.push({
                ...latest,
                history: history
            });
        });
        structured.sort((a, b) => {
            const aProcessed = !!a.processed;
            const bProcessed = !!b.processed;
            if (aProcessed !== bProcessed)
                return aProcessed ? 1 : -1;
            return (b.datetime || 0) - (a.datetime || 0)
        });
        reportedWordsView = structured;
    };

    const rankedUsers = JSON.parse(fs.readFileSync(`${appDir}/auth-users.json`));

    const defaultWords = JSON.parse(fs.readFileSync(`${appDir}/moderated-words.json`));

    updateExistingPacks();

    fs.readFile(`${appDir}/reported-words.txt`, {encoding: "utf-8"}, (err, data) => {
        if (data) {
            data.split("\n").forEach((row) => {
                if (row) {
                    const parsed = JSON.parse(row);
                    reportedWordsData.push(parsed);
                    if (!parsed.processed && parsed.word) {
                        if (parsed.currentLevel === 5 || parsed.level === 5) {
                            reportedWordsNoMeta.push(parsed.word);
                        } else {
                            reportedWords.push(parsed.word);
                        }
                    }
                }
            });
            updateReportView();
        }
    });

    fs.readFile(`${appDir}/ranked-games.txt`, {encoding: "utf-8"}, (err, data) => {
        if (data)
            data.split("\n").forEach((row) => row && rankedGames.push(JSON.parse(row)));
    });

    fs.mkdir(`${appDir}/custom`, () => {
        fs.mkdir(`${appDir}/custom/new`, () => {
        });
    });

    registry.handleAppPage(path, `${__dirname}/public/app.html`);
    registry.handleAppPage(`${path}/ranked`, `${__dirname}/public/ranked.html`);

    /* Счёт комнаты наружу: турик-менеджер тянет его сюда, чтобы организатору не
       вносить баллы руками. Отдаём только «id пользователя на сайте → очки»,
       поэтому ключа не спрашиваем: ничего закрытого тут нет.

       Отдаём оба режима, но по-разному: в соло у каждого свои очки, в команде
       личных очков не существует вовсе — есть счёт команды, и снаружи его
       раскладывают по её участникам. Что именно пришло, говорит gameMode.

       К набранному прибавляем очки текущего раунда (playerWordPoints,
       team.wordPoints): так же считает сама игра, когда сохраняет результаты. */
    app.get(`${path}/room-scores`, (req, res) => {
        const roomManager = registry.roomManagers.get(path);
        const roomState = roomManager && roomManager.rooms.get(req.query.room);
        if (!roomState) return res.send({found: false});

        const room = roomState.room;
        /* id пользователя на сайте; гостей без аккаунта пропускаем — сопоставить
           их с участником турика всё равно нечем */
        const authIdOf = (user) => room.authUsers[user] && room.authUsers[user]._id;

        const common = {
            found: true,
            gameMode: room.soloMode ? 'solo' : 'team',
            /* 1 — раунд кончился и очки за слова ещё правят, 2 — идёт раунд.
               Снаружи по этому видно, что счёт прямо сейчас может поехать */
            phase: room.phase,
            online: room.onlinePlayers ? room.onlinePlayers.size : 0,
        };

        if (!room.soloMode) {
            const teams = Object.keys(room.teams).map((teamId) => ({
                id: teamId,
                players: [...room.teams[teamId].players].map(authIdOf).filter(Boolean),
                /* живой счёт: он решает, кто выиграл матч, в том числе после
                   добавочных раундов на тайбрейк */
                score: room.teams[teamId].score + (room.teams[teamId].wordPoints || 0),
                /* счёт на момент, когда четвёртый раунд закрыт. Пока его нет,
                   живой счёт и есть счёт этапа */
                stageScore: room.teamStageScores?.[teamId] ?? null,
            }));
            return res.send({...common, round: room.teamRound, teams});
        }

        const scores = {};
        const players = new Set([
            ...Object.keys(room.playerScores || {}),
            ...(room.onlinePlayers || []),
        ]);
        players.forEach((user) => {
            const authId = authIdOf(user);
            if (authId)
                scores[authId] =
                    (room.playerScores?.[user] || 0) + (room.playerWordPoints?.[user] || 0);
        });

        res.send({
            ...common,
            /* Сколько кругов доиграли и сколько заказано: по ним снаружи видно, что
               игра закончилась, — счёт сам по себе об этом не говорит */
            round: room.soloModeRound,
            soloModeRound: room.soloModeRound,
            soloModeGoal: room.soloModeGoal,
            scores,
        });
    });

    app.get("/alias/ranked/data", async (req, res) => {
        const profiles = await registry.authUsers.getUsersMiniProfiles(Object.keys(rankedUsers));
        Object.keys(rankedUsers).map((userId) => {
            if (profiles[userId])
                rankedUsers[userId].name = profiles[userId].name;
        });
        res.send({
            rankedGames,
            rankedUsers,
        });
    });

    app.get("/alias/ranked/toggle-moderator", (req, res) => {
        if (req.query.key === moderKey) {
            if (rankedUsers[req.query.user]) {
                if (rankedUsers[req.query.user].moderator)
                    delete rankedUsers[req.query.user].moderator;
                else {
                    rankedUsers[req.query.user].moderator = true;
                    rankedUsers[req.query.user].discord = req.query.discord;
                }
                fs.writeFile(`${appDir}/auth-users.json`, JSON.stringify(rankedUsers, null, 4), (error) => {
                    if (error)
                        res.send({
                            message: error.message
                        });
                    else
                        res.send({});
                });
            } else res.send({message: 'Что-то пошло не так'});
        } else res.send({message: 'Неверный ключ'});
    });

    app.get("/alias/ranked/edit-score", (req, res) => {
        if (req.query.key === moderKey && !isNaN(req.query.score)) {
            if (rankedUsers[req.query.user]) {
                const scoreKey = req.query.rankedMode === 'nometa' ? 'scoreNoMeta' : req.query.rankedMode === 'easy' ? 'scoreEasy' : 'score';
                rankedUsers[req.query.user][scoreKey] = parseInt(req.query.score);
                fs.writeFile(`${appDir}/auth-users.json`, JSON.stringify(rankedUsers, null, 4), (error) => {
                    if (error)
                        res.send({
                            message: error.message
                        });
                    else
                        res.send({});
                });
            } else res.send({message: 'Что-то пошло не так'});
        } else res.send({message: 'Неверный ключ'});
    });

    app.get("/alias/ranked/remove-game", (req, res) => {
        if (req.query.key === moderKey) {
            const rankedGame = rankedGames.find((game) => game.datetime === req.query.datetime)
            if (rankedGame) {
                rankedGame.deleted = true;
                const scoreKey = rankedGame.rankedMode === 'nometa' ? 'scoreNoMeta' : rankedGame.rankedMode === 'easy' ? 'scoreEasy' : (rankedGame.noMeta ? 'scoreNoMeta' : 'score');
                Object.keys(rankedGame.rankedScoreDiffs).forEach((player) => {
                    if (rankedUsers[player])
                        rankedUsers[player][scoreKey] = (rankedUsers[player][scoreKey] || 1000) - rankedGame.rankedScoreDiffs[player];
                })
                fs.writeFile(
                    `${appDir}/ranked-games.txt`,
                    `${rankedGames.map((rankedGame) => JSON.stringify(rankedGame)).join("\n")}\n`,
                    (error) => {
                        if (error)
                            res.send({
                                message: error.message
                            });
                        else {
                            fs.writeFile(`${appDir}/auth-users.json`, JSON.stringify(rankedUsers, null, 4), (error) => {
                                if (error)
                                    res.send({
                                        message: error.message
                                    });
                                else
                                    res.send({});
                            })
                        }
                    });
            } else res.send({message: 'Что-то пошло не так'});
        } else res.send({message: 'Неверный ключ'});
    });

    app.use("/alias", wsServer.static(`${__dirname}/public`));

    class GameState extends wsServer.users.RoomState {
        constructor(hostId, hostData, userRegistry, registry) {
            super(hostId, hostData, userRegistry, registry.games.alias.id, path);
            const room = {
                ...this.room,
                inited: true,
                hostId: hostId,
                phase: 0,
                spectators: new JSONSet(),
                playerNames: {},
                playerScores: {},
                playerWordPoints: {},
                readyPlayers: new JSONSet(),
                onlinePlayers: new JSONSet(),
                roundTime: 60,
                currentBet: Infinity,
                goal: 20,
                currentWords: [],
                teams: {},
                wordIndex: 0,
                wordsEnded: false,
                level: 2,
                drawMode: false,
                drawCommitOnly: false,
                soloMode: false,
                soloModeRound: 0,
                soloModeGoal: 1,
                /* Счётчик раундов командного режима: один раунд — один заход
                   загадывающего. Нужен турик-менеджеру: формат «цепочка» играет
                   ровно четыре, по одному на каждого из четверых */
                teamRound: 0,
                /* Снимок командного счёта на момент, когда четвёртый раунд
                   закрыт. Дальше в комнате могут играть добавочные раунды на
                   тайбрейк, и живой счёт поедет, а этот — нет: в турике он и
                   есть счёт этапа. Снимается один раз за игру, рестарт его
                   сбрасывает вместе со счётом */
                teamStageScores: null,
                packName: null,
                customWordsLimit: registry.config.customWordsLimit,
                managedVoice: true,
                rankedUsers: {},
                ranked: false,
                rankedResultsSaved: false,
                rankedScoreDiffs: {},
                deafMode: false,
                /* комната турика: имя начинается на turik-. Клиенту это нужно,
                   чтобы убирать то, что мешает организатору вести игру */
                turik: false,
                mode: 'team',
                sortMode
            };
            this.room = room;
            this.state = {
                activeWord: null,
                roomWordsList: null,
                drawList: [],
                drawTempList: [],
                winProcessed: false,
                round: null,
                gameEntryIndex: 0,
            };
            /* Комнаты турика заводятся сразу в нужном режиме и словаре: всё это
               задаёт само имя комнаты — turik-<solo|team-chain>-<easy|normal|hard>-<игра>.
               Форматов турнира два: в сольном каждый играет за себя, в командном
               («цепочка») матчи идут два на два, — а словарь орг выбирает при
               создании турика, поэтому зашивать изи, как раньше, больше нельзя.

               Имя без этих частей (turik-1А) значит соло на изи: так турик работал
               до второго формата, и ссылки прошлых туриков должны открываться.

               Список слов заряжаем тут же — иначе первый вошедший получил бы словарь
               по умолчанию, и уровень сбросился бы на второй (см. userJoin) */
            const турик = /^turik-(?:(solo|team-chain)-(easy|normal|hard)-)?/
                .exec(String(room.roomId || "").toLowerCase());
            if (турик) {
                const командный = турик[1] === "team-chain";
                room.turik = true;
                room.soloMode = !командный;
                room.mode = командный ? 'team' : 'solo';
                room.level = {easy: 1, normal: 2, hard: 3}[турик[2] || "easy"];
                this.state.roomWordsList = shuffleArray([...defaultWords[room.level]]);
                /* Командный этап турика играется на количество раундов, а не до
                   набранных очков, и при ничьей доигрывается добавочными. Цель по
                   очкам тут только мешает: набрав её, команда выигрывает игру, всех
                   выбрасывает на экран победы, и кто-нибудь жмёт рестарт вместо
                   тайбрейка. Ставим заведомо недостижимую */
                if (командный)
                    room.goal = 999;
            }
            this.lastInteraction = new Date();
            this.wordSkippedCoolDown = false;
            let timer;
            const
                send = (target, event, data) => userRegistry.send(target, event, data),
                isTurikAdmin = (user) =>
                    turikAdminIds.has(room.authUsers[user] && room.authUsers[user]._id),
                update = () => {
                    if (room.voiceEnabled)
                        processUserVoice();
                    /* Кто в этой комнате организатор — считаем перед отправкой, а не
                       ловим по событиям входа: список короткий, а промахнуться мимо
                       события авторизации легко */
                    room.turikAdmins = [...room.onlinePlayers].filter(isTurikAdmin);
                    send(room.onlinePlayers, "state", room);
                },
                rotatePlayers = (teamId) => {
                    if (room.currentTeam) {
                        const currentTeam = room.teams[teamId || room.currentTeam],
                            currentPlayer = currentTeam.currentPlayer,
                            currentPlayerKeys = [...currentTeam.players],
                            indexOfCurrentPlayer = currentPlayerKeys.indexOf(currentTeam.currentPlayer);
                        if (room.soloMode) {
                            const indexOfCurrentAssistant = currentPlayerKeys.indexOf(room.currentAssistant);
                            if (indexOfCurrentAssistant === currentTeam.players.size - 1)
                                room.currentAssistant = currentPlayerKeys[0];
                            else
                                room.currentAssistant = currentPlayerKeys[indexOfCurrentAssistant + 1];
                        }
                        if (!room.soloMode || room.currentAssistant === room.currentPlayer) {
                            if (indexOfCurrentPlayer === currentTeam.players.size - 1) {
                                currentTeam.currentPlayer = currentPlayerKeys[0];
                                if (room.soloMode) {
                                    room.soloModeRound++;
                                    room.currentAssistant = currentPlayerKeys[1];
                                }
                            } else {
                                currentTeam.currentPlayer = currentPlayerKeys[indexOfCurrentPlayer + 1];
                                if (room.soloMode) {
                                    if (indexOfCurrentPlayer + 1 === currentTeam.players.size - 1)
                                        room.currentAssistant = currentPlayerKeys[0];
                                    else
                                        room.currentAssistant = currentPlayerKeys[indexOfCurrentPlayer + 2];
                                }
                            }
                            if (room.currentPlayer === currentPlayer)
                                room.currentPlayer = currentTeam.currentPlayer;
                        }
                    }
                },
                processUserVoice = () => {
                    room.userVoice = {};
                    room.onlinePlayers.forEach((user) => {
                        if (!room.managedVoice || room.phase === 0 || room.phase === 1)
                            room.userVoice[user] = true;
                        else {
                            if (!room.soloMode && room.currentTeam && room.teams[room.currentTeam].players.has(user))
                                room.userVoice[user] = true;
                            else if (room.soloMode && (room.currentPlayer === user || room.currentAssistant === user))
                                room.userVoice[user] = true;
                        }
                    });
                },
                rotateTeams = () => {
                    if (room.currentTeam && !room.soloMode) {
                        const
                            teamKeys = Object.keys(room.teams),
                            indexOfCurrentTeam = teamKeys.indexOf(room.currentTeam);
                        if (indexOfCurrentTeam === teamKeys.length - 1)
                            room.currentTeam = teamKeys[0];
                        else
                            room.currentTeam = teamKeys[indexOfCurrentTeam + 1];
                        if (!room.teams[room.currentTeam].currentPlayer)
                            room.teams[room.currentTeam].currentPlayer = [...room.teams[room.currentTeam].players][0];
                        room.currentPlayer = room.teams[room.currentTeam].currentPlayer;
                    }
                    room.readyPlayers.clear();
                },
                leaveTeams = (user, exceptId) => {
                    if (room.currentPlayer === user)
                        rotatePlayers();
                    if (room.currentTeam && room.teams[room.currentTeam] && room.teams[room.currentTeam].players.size === 1)
                        rotateTeams();
                    Object.keys(room.teams).forEach(teamId => {
                        if (teamId !== exceptId && room.teams[teamId].players.delete(user) && room.teams[teamId].players.size === 0)
                            delete room.teams[teamId];
                    });
                    if (room.currentPlayer === user)
                        room.currentPlayer = null;
                    if (!room.teams[room.currentTeam])
                        room.currentTeam = null;
                    room.readyPlayers.delete(user);
                    if (room.currentAssistant === user)
                        room.currentAssistant = null;
                },
                calcWordPoints = () => {
                    let wordPoints = 0;
                    room.currentWords.forEach(word => wordPoints += word.points);
                    if (!room.soloMode)
                        Object.keys(room.teams).forEach(teamId => {
                            if (room.teams[teamId].wordPoints !== undefined)
                                room.teams[teamId].wordPoints = wordPoints < 0 ? 0 : wordPoints;
                        });
                    else {
                        Object.keys(room.playerWordPoints).forEach(playerId => {
                            if (room.playerWordPoints[playerId] !== undefined)
                                room.playerWordPoints[playerId] = wordPoints < 0 ? 0 : wordPoints;
                        });
                    }
                },
                snapshotStageScores = () => {
                    /* Четвёртый раунд закрыт и игра тронулась дальше — фиксируем
                       счёт этапа. Событие «раунд доигран» в игре размазано: от
                       конца таймера до старта следующего раунда очки за слова
                       ещё правятся, поэтому цепляемся не за таймер, а за момент,
                       когда они уже ушли в счёт команды */
                    if (room.soloMode || room.teamStageScores || room.teamRound < 4)
                        return;
                    room.teamStageScores = {};
                    Object.keys(room.teams).forEach(teamId => {
                        room.teamStageScores[teamId] = room.teams[teamId].score;
                    });
                },
                addWordPoints = () => {
                    if (!room.soloMode)
                        Object.keys(room.teams).forEach(teamId => {
                            const team = room.teams[teamId];
                            if (team.wordPoints !== undefined) {
                                team.score += team.wordPoints;
                                delete team.wordPoints;
                            }
                        });
                    else Object.keys(room.playerWordPoints).forEach(playerId => {
                        if (room.playerWordPoints[playerId] != null) {
                            room.playerScores[playerId] = room.playerScores[playerId] || 0;
                            room.playerScores[playerId] += room.playerWordPoints[playerId];
                            delete room.playerWordPoints[playerId];
                        }
                    });
                    snapshotStageScores();
                },
                stopTimer = () => {
                    room.timer = null;
                    clearInterval(timer);
                },
                recordWordTime = () => {
                    const round = this.state.round;
                    if (!round || round.lastWordTime == null) return;
                    const now = Date.now();
                    round.wordGuessTimes.push(now - round.lastWordTime);
                    round.lastWordTime = now;
                },
                isGameFinished = () => {
                    if (room.soloMode)
                        return room.soloModeRound >= room.soloModeGoal;
                    if (Object.keys(room.teams).indexOf(room.currentTeam) !== 0)
                        return false;
                    let mostPoints = 0;
                    const teamsReachedGoal = Object.keys(room.teams).filter(teamId => {
                        const points = room.teams[teamId].score + (room.teams[teamId].wordPoints || 0);
                        if (points > mostPoints)
                            mostPoints = points;
                        return points >= room.goal;
                    });
                    const reachedScores = teamsReachedGoal
                        .map(teamId => room.teams[teamId].score + (room.teams[teamId].wordPoints || 0))
                        .sort((a, b) => b - a);
                    return teamsReachedGoal.length > 0
                        && (teamsReachedGoal.length === 1 || reachedScores[0] !== reachedScores[1]);
                },
                writeRoundLog = () => {
                    const round = this.state.round;
                    if (!round) return;
                    try {
                        const dictionary = room.level === 5 ? "nometa"
                            : (room.level === 0 || room.packName) ? "custom"
                                : String(room.level);
                        const logItem = {
                            _id: round.id,
                            datetime: new Date().toISOString(),
                            goal: room.soloMode ? room.soloModeGoal : room.goal,
                            teamTime: room.roundTime,
                            gameType: room.mode,
                            dictionary,
                            customPackName: room.packName || undefined,
                            isRanked: !!room.ranked,
                            explainerId: round.explainerId,
                            guesserIds: round.guesserIds,
                            words: room.currentWords.map(w => w.word),
                            wordIds: null,
                            wordGuessTimes: round.wordGuessTimes,
                            wordScores: room.currentWords.map(w => w.points),
                            roomId: room.roomId,
                            teamIndex: round.teamIndex,
                            teamCount: round.teamCount,
                            gameEntryIndex: round.gameEntryIndex,
                            isFinished: isGameFinished(),
                        };
                        fs.appendFile(`${appDir}/alias-stats.db`, JSON.stringify(logItem) + '\n', () => {});
                    } catch (error) {
                        registry.log(`alias round log error: ${error.message}`);
                    }
                },
                endRound = () => {
                    if (this.state.activeWord) {
                        room.currentWords.push({
                            points: 1,
                            word: this.state.activeWord,
                            reported: isWordReported(this.state.activeWord, room.level === 5)
                        });
                        recordWordTime();
                    }
                    send(room.onlinePlayers, "active-word", null);
                    this.state.activeWord = undefined;
                    calcWordPoints();
                    if (room.phase !== 1) {
                        if (!room.soloMode)
                            room.teamRound++;
                        rotatePlayers();
                        rotateTeams();
                    }
                    stopTimer();
                    room.phase = 1;
                    writeRoundLog();
                },
                startTimer = () => {
                    room.timer = room.roundTime * 1000;
                    let time = new Date();
                    timer = setInterval(() => {
                        room.timer -= new Date() - time;
                        time = new Date();
                        if (room.timer <= 0) {
                            endRound();
                            send(room.onlinePlayers, "timer-end");
                            update();
                        }
                    }, 100);
                },
                resetOrder = () => {
                    Object.keys(room.teams).forEach(teamId => {
                        const team = room.teams[teamId];
                        team.currentPlayer = [...team.players][0];
                    });
                    room.currentTeam = Object.keys(room.teams)[0];
                    room.currentPlayer = room.teams[room.currentTeam] && room.teams[room.currentTeam].currentPlayer;
                    if (room.soloMode && room.teams[room.currentTeam])
                        setAssistant([...room.teams[room.currentTeam].players][1]);
                },
                restartGame = () => {
                    checkWin();
                    this.state.gameEntryIndex = (this.state.gameEntryIndex || 0) + 1;
                    this.state.round = null;
                    this.state.winProcessed = false;
                    addWordPoints();
                    room.phase = 0;
                    room.currentWords = [];
                    room.readyPlayers.clear();
                    //room.wordIndex = 0;
                    room.wordsEnded = false;
                    room.soloModeRound = 0;
                    room.teamRound = 0;
                    room.teamStageScores = null;
                    room.rankedResultsSaved = false;
                    room.rankedScoreDiffs = {};
                    Object.keys(room.teams).forEach(teamId => {
                        const team = room.teams[teamId];
                        delete team.wordPoints;
                        team.score = 0;
                    });
                    Object.keys(room.playerScores).forEach(playerId => {
                        delete room.playerScores[playerId];
                        delete room.playerWordPoints[playerId];
                    });
                    resetOrder();
                },
                selectWordSet = (wordSet, user) => {
                    if (!isNaN(parseFloat(wordSet))) {
                        room.currentWords = [];
                        room.packName = null;
                        const difficulty = parseFloat(wordSet);
                        if (!~[1, 2, 3, 4, 5].indexOf(difficulty) > 0) {
                            if (user)
                                send(user, "message", "You did something wrong");
                        } else {
                            room.level = difficulty;
                            this.state.roomWordsList = shuffleArray([...defaultWords[difficulty]]);
                            room.wordIndex = 0;
                            room.wordsEnded = false;
                        }
                        update();
                    }
                },
                removePlayer = playerId => {
                    Object.keys(room.teams).forEach(teamId => {
                        const team = room.teams[teamId];
                        if (team.players.delete(playerId)) {
                            if (team.players.size === 0) {
                                if (room.currentTeam === teamId)
                                    rotateTeams();
                                delete room.teams[teamId];
                            } else if (team.currentPlayer === playerId)
                                rotatePlayers(teamId);
                        }
                    });
                    room.readyPlayers.delete(playerId);
                    if (room.spectators.has(playerId) || !room.onlinePlayers.has(playerId)) {
                        room.spectators.delete(playerId);
                        delete room.playerNames[playerId];
                        delete room.rankedUsers[playerId];
                        this.emit("user-kicked", playerId);
                    } else
                        room.spectators.add(playerId);
                },
                setTurn = playerId => {
                    Object.keys(room.teams).forEach(teamId => {
                        const team = room.teams[teamId];
                        [...team.players].forEach(teamPlayerId => {
                            if (teamPlayerId === playerId) {
                                team.currentPlayer = playerId;
                                room.currentPlayer = playerId;
                                room.currentTeam = teamId;
                                room.readyPlayers.clear();
                            }
                        })
                    });
                },
                setAssistant = playerId => {
                    room.currentAssistant = playerId;
                    room.readyPlayers.clear();
                },
                checkDrawData = (data) => data && data.dots
                    && data.dots.length > 0
                    && data.thickness > 0
                    && data.thickness < 10,
                registerRankedUser = (user, authUser) => {
                    rankedUsers[authUser._id] = {
                        score: 1000,
                        scoreNoMeta: 1000,
                        scoreEasy: 1000,
                        name: authUser.name,
                        id: authUser._id,
                        registerTime: new Date()
                    };
                    fs.writeFile(`${appDir}/auth-users.json`, JSON.stringify(rankedUsers, null, 4),
                        (err) => {
                            if (!err) {
                                loginUserRanked(user, authUser._id);
                            } else {
                                delete rankedUsers[authUser._id];
                                registry.log(`- auth-users.json saving error ${err.message}`);
                                send(user, "message", `Ошибка регистрации: ${err.message}`);
                            }
                        })
                },
                loginUserRanked = (user, rankedUserId) => {
                    room.rankedUsers[user] = rankedUsers[rankedUserId];
                },
                toggleRanked = (state, mode) => {
                    room.ranked = state;
                    room.rankedMode = mode || 'normal';
                    room.rankedNoMeta = room.rankedMode === 'nometa';
                    selectWordSet(room.rankedMode === 'nometa' ? 5 : room.rankedMode === 'easy' ? 1 : 2);
                    if (room.ranked) {
                        room.soloModeGoal = 1;
                        room.roundTime = 60;
                        room.mode = 'solo';
                        room.deafMode = false;
                        toggleSoloMode(true);
                        for (const player of [...room.onlinePlayers]) {
                            authRanked(player, true);
                        }
                        const firstTeam = Object.keys(room.teams)[0];
                        if (firstTeam)
                            room.teams[firstTeam].players.forEach((playerId) => {
                                if (!room.rankedUsers[playerId]) {
                                    leaveTeams(playerId);
                                    room.spectators.add(playerId);
                                }
                            });
                        update();
                    }
                },
                authRanked = (user, register) => {
                    if (room.authUsers[user]) {
                        const authUser = room.authUsers[user];
                        if (rankedUsers[authUser._id])
                            loginUserRanked(user, authUser._id);
                        else if (register)
                            registerRankedUser(user, authUser);
                    }
                },
                onUserAuth = (user) => {
                    authRanked(user, room.ranked);
                    update();
                },
                toggleSoloMode = (state) => {
                    room.soloMode = state;
                    if (room.soloMode) {
                        const firstTeam = Object.keys(room.teams)[0];
                        Object.keys(room.teams).forEach((teamId) => {
                            if (firstTeam !== teamId && firstTeam) {
                                room.teams[teamId].players.forEach((playerId) =>
                                    room.teams[firstTeam].players.add(playerId));
                                delete room.teams[teamId];
                            }
                        });
                    } else room.currentAssistant = null;
                    restartGame();
                },
                saveRankedResults = (user, leaverId) => {
                    if (room.ranked && (room.phase === 1 || leaverId) && room.hostId === user
                        && room.rankedUsers[user]?.moderator) {
                        const scoreKey = room.rankedMode === 'nometa' ? 'scoreNoMeta' : room.rankedMode === 'easy' ? 'scoreEasy' : 'score';
                        const users = [...room.teams[Object.keys(room.teams)[0]].players];
                        const players = users.map((player) => room.rankedUsers[player].id);
                        const playerScores = {};
                        const rankedScoreDiffs = {};
                        let totalPoints = 0;
                        for (const user of users) {
                            const player = room.rankedUsers[user].id;
                            playerScores[player] = (room.playerScores[user] || 0) + (room.playerWordPoints[user] || 0);
                        }
                        const scores = [...new Set(Object.keys(playerScores).map((user) => playerScores[user]))]
                            .sort((a, b) => a - b).reverse();
                        const scoreRanks = {};
                        let leaverPlayer;
                        for (const user of users) {
                            const player = room.rankedUsers[user].id;
                            if (user === leaverId)
                                leaverPlayer = player;
                            totalPoints += (playerScores[player] || 0);
                            scoreRanks[player] = !leaverId ? (scores.indexOf(playerScores[player]) + 1) : (
                                player === leaverPlayer ? 2 : 1
                            );
                            rankedScoreDiffs[player] = 0;
                        }
                        totalPoints = totalPoints / users.length;
                        const rankedBaseMultiplier = 20;
                        const rankedScoreMultiplier = 400;
                        const skillGroupMultipliers = [
                            [1.5, 0.5],
                            [1.25, 0.75],
                            [1, 1],
                            [0.75, 1.25],
                        ];
                        const leaverLoseCount = 5;
                        const skillGroupCondition = [35, 25, 15, 0];
                        const skillGroup = skillGroupCondition.findIndex((condition) => totalPoints >= condition);
                        const skillGroupMultiplier = skillGroupMultipliers[skillGroup];
                        for (const player of players) {
                            const playersYouWon = Object.keys(scoreRanks)
                                .filter((scorePlayer) => scorePlayer !== player && scoreRanks[scorePlayer] > scoreRanks[player]).length;
                            const playersYouLose = leaverPlayer !== player ? Object.keys(scoreRanks)
                                    .filter((scorePlayer) => scorePlayer !== player && scoreRanks[scorePlayer] < scoreRanks[player]).length
                                : leaverLoseCount;
                            const playersYouDraw = Object.keys(scoreRanks)
                                .filter((scorePlayer) => scorePlayer !== player && scoreRanks[scorePlayer] === scoreRanks[player]).length;
                            const otherPlayers = players.filter((otherPlayer) => otherPlayer !== player);
                            const avgRankScore = otherPlayers.reduce((acc, otherPlayer) =>
                                (rankedUsers[otherPlayer][scoreKey] || 1000) + acc, 0) / otherPlayers.length;
                            const expectedVictory = 1 / (1 + 10 ** ((avgRankScore - (rankedUsers[player][scoreKey] || 1000)) / rankedScoreMultiplier));
                            const rankedScoreDiff = rankedBaseMultiplier
                                * (((1 - expectedVictory) * playersYouWon)
                                    + ((0.5 - expectedVictory) * playersYouDraw)
                                    + ((0 - expectedVictory) * playersYouLose));
                            if (leaverPlayer === player || !leaverPlayer)
                                rankedScoreDiffs[player] = Math.round(rankedScoreDiff * skillGroupMultiplier[rankedScoreDiff > 0 ? 0 : 1]);
                            else if (leaverPlayer)
                                rankedScoreDiffs[player] = 0;
                        }
                        const prevScores = {};
                        Object.keys(rankedScoreDiffs).forEach((player) => prevScores[player] = rankedUsers[player][scoreKey] || 1000);
                        const gameResult = {
                            playerScores,
                            playerRanks: scoreRanks,
                            rankedScoreDiffs,
                            datetime: new Date().toISOString(),
                            moderator: room.rankedUsers[user].id,
                            noMeta: room.rankedNoMeta,
                            easy: room.rankedMode === 'easy',
                            rankedMode: room.rankedMode,
                            prevScores,
                            skillGroup: ['Very High', 'High', 'Normal', 'Low'][skillGroup]
                        };
                        if (Object.keys(rankedScoreDiffs).some((player) => isNaN(rankedScoreDiffs[player])))
                            send(user, 'message', `Ошибка сохранения результата: ${JSON.stringify(rankedScoreDiffs)}`)
                        else
                            fs.appendFile(`${appDir}/ranked-games.txt`, `${JSON.stringify(gameResult)}\n`, (error) => {
                                if (error)
                                    send(user, 'message', `Ошибка сохранения результата: ${error.message}`)
                                else {
                                    rankedGames.push(gameResult);
                                    for (const [index, player] of players.entries()) {
                                        rankedUsers[player][scoreKey] = (rankedUsers[player][scoreKey] || 1000) + rankedScoreDiffs[player];
                                        room.rankedScoreDiffs[users[index]] = rankedScoreDiffs[player];
                                    }
                                    checkWin();
                                    room.rankedResultsSaved = true;
                                    room.currentWords = [];
                                    room.phase = 0;
                                    fs.writeFile(`${appDir}/auth-users.json`, JSON.stringify(rankedUsers, null, 4),
                                        () => {
                                        });
                                    addWordPoints();
                                    if (leaverId)
                                        removePlayer(leaverId);
                                    update();
                                }
                            })
                    }
                },
                checkWin = () => {
                    let winners = [];
                    if (!room.soloMode) {
                        if (Object.keys(room.teams).indexOf(room.currentTeam) === 0) {
                            let mostPoints = 0,
                                mostPointsTeam,
                                teamsReachedGoal = Object.keys(room.teams).filter(teamId => {
                                    const
                                        team = room.teams[teamId],
                                        points = team.score + (team.wordPoints || 0);
                                    if (points > mostPoints) {
                                        mostPoints = points;
                                        mostPointsTeam = teamId;
                                    }
                                    return points >= room.goal;
                                }),
                                teamsReachedGoalScores = teamsReachedGoal.map((teamId) => room.teams[teamId].score + (room.teams[teamId].wordPoints || 0)).sort((a, b) => b - a);
                            if (teamsReachedGoal.length > 0 && (teamsReachedGoal.length === 1 || teamsReachedGoalScores[0] !== teamsReachedGoalScores[1])) {
                                winners = [...room.teams[mostPointsTeam].players];
                            }
                        }
                    } else if (room.soloModeRound >= room.soloModeGoal) {
                        const playerWin = Object.keys(room.playerScores).sort((idA, idB) =>
                            (room.playerScores[idB] + (room.playerWordPoints[idB] || 0)) - (room.playerScores[idA] + (room.playerWordPoints[idA] || 0)))[0];
                        winners = [playerWin];
                    }
                    if (!this.state.winProcessed && winners.length > 0 && (room.soloMode ? room.onlinePlayers.size >= 3 : room.onlinePlayers.size >= 4)) {
                        this.state.winProcessed = true;
                        for (const user of winners) {
                            const userData = {user, room};
                            registry.authUsers.processAchievement(userData, registry.achievements.win100Alias.id);
                            registry.authUsers.processAchievement(userData, registry.achievements.win1000Alias.id);
                            registry.authUsers.processAchievement(userData, registry.achievements.win10000Alias.id);
                            registry.authUsers.processAchievement(userData, registry.achievements.winGames.id, {game: registry.games.alias.id});
                            if (room.goal >= 100)
                                registry.authUsers.processAchievement(userData, registry.achievements.aliasMarathon.id);
                            if (room.ranked)
                                registry.authUsers.processAchievement(userData, registry.achievements.rankedAliasWin.id);                        }
                    }
                },
                userJoin = (data) => {
                    const user = data.userId;
                    if (!room.playerNames[user])
                        room.spectators.add(user);
                    room.onlinePlayers.add(user);
                    room.playerNames[user] = data.userName.substr && data.userName.substr(0, 60);

                    if (!this.state.roomWordsList)
                        selectWordSet(room.rankedMode === 'nometa' ? 5 : room.rankedMode === 'easy' ? 1 : 2);
                    if (room.currentPlayer === user && this.state.activeWord)
                        send(user, "active-word", {
                            word: this.state.activeWord,
                            reported: isWordReported(this.state.activeWord, room.level === 5)
                        });
                    update();
                    if (room.drawMode && this.state.drawList.length)
                        send(user, "draw-commit", this.state.drawList);
                },
                userLeft = (user) => {
                    room.onlinePlayers.delete(user);
                    if (room.spectators.has(user)) {
                        delete room.playerNames[user];
                        delete room.rankedUsers[user];
                    }
                    room.spectators.delete(user);
                    room.readyPlayers.delete(user);
                    if (room.onlinePlayers.size === 0)
                        stopTimer();
                    update();
                },
                userEvent = (user, event, data) => {
                    this.lastInteraction = new Date();
                    try {
                        if (this.eventHandlers[event])
                            this.eventHandlers[event](user, data[0], data[1], data[2], data[3]);
                    } catch (error) {
                        console.error(error);
                        registry.log(error.message);
                    }
                };
            this.updatePublicState = update;
            this.userJoin = userJoin;
            this.userLeft = userLeft;
            this.userEvent = userEvent;
            this.onUserAuth = onUserAuth;
            this.eventHandlers = {
                ...this.eventHandlers,
                "team-join": (user, id) => {
                    if (!room.ranked || ((id === "new" || room.teams[id]) && room.rankedUsers[user]
                        && (!room.teams[id] || room.teams[id].players.size < 4))) {
                        if (id === "new" && (!room.soloMode || !Object.keys(room.teams).length)) {
                            id = makeId();
                            room.teams[id] = {score: 0, players: new JSONSet()};
                        }
                        if (room.teams[id] && !room.teams[id].players.has(user)) {
                            leaveTeams(user, id);
                            room.spectators.delete(user);
                            room.teams[id].players.add(user);
                            update();
                        }
                    }
                },
                "spectators-join": (user) => {
                    leaveTeams(user);
                    room.spectators.add(user);
                    update();
                },
                "action": (user) => {
                    if (!room.rankedResultsSaved && room.ranked && room.phase === 1 && room.soloModeRound === room.soloModeGoal)
                        saveRankedResults(user);
                    else if (room.phase === 0 && room.hostId === user && Object.keys(room.teams).length > 0
                        && (!room.soloMode || room.teams[Object.keys(room.teams)[0]].players.size > 1)
                        && (!room.ranked || room.teams[room.currentTeam].players.size === 4)) {
                        room.phase = 1;
                        room.currentTeam = room.currentTeam || Object.keys(room.teams)[0];
                        const currentTeam = room.teams[room.currentTeam];
                        currentTeam.currentPlayer = currentTeam.currentPlayer || [...currentTeam.players][0];
                        room.currentPlayer = currentTeam.currentPlayer;
                        if (room.soloMode)
                            room.currentAssistant = room.currentAssistant || [...currentTeam.players][1];
                    } else if (room.phase === 1
                        && (!room.soloMode
                            ? (room.teams[room.currentTeam].players.has(user))
                            : (room.currentPlayer === user || room.currentAssistant === user))) {
                        if (room.currentPlayer !== user || (!room.soloMode
                            ? room.readyPlayers.size !== room.teams[room.currentTeam].players.size
                            : room.readyPlayers.size !== 2))
                            if (room.readyPlayers.has(user))
                                room.readyPlayers.delete(user);
                            else
                                room.readyPlayers.add(user);
                        else {
                            room.phase = 2;
                            this.state.drawList = [];
                            this.state.drawTempList = [];
                            send(room.onlinePlayers, "draw-clear");
                            room.readyPlayers.clear();
                            addWordPoints();
                            room.currentWords = [];
                            if (!room.soloMode)
                                room.teams[room.currentTeam].wordPoints = 0;
                            else {
                                room.playerWordPoints[room.currentPlayer] = 0;
                                room.playerWordPoints[room.currentAssistant] = 0;
                            }
                            const roundTeam = room.teams[room.currentTeam];
                            const roundGuessers = room.soloMode
                                ? [room.currentAssistant]
                                : [...roundTeam.players].filter(p => p !== room.currentPlayer);
                            this.state.round = {
                                id: crypto.randomUUID(),
                                explainerId: registry.authUsers.getUserId(room.currentPlayer, room),
                                guesserIds: roundGuessers.map(p => registry.authUsers.getUserId(p, room)),
                                wordGuessTimes: [],
                                lastWordTime: null,
                                teamIndex: Object.keys(room.teams).indexOf(room.currentTeam),
                                teamCount: Object.keys(room.teams).length,
                                gameEntryIndex: this.state.gameEntryIndex || 0,
                            };
                            startTimer();
                        }
                    }
                    if (room.phase === 2
                        && (!room.deafMode ? room.currentPlayer === user : (room.teams[room.currentTeam].players.has(user) && room.currentPlayer !== user)
                            && !this.wordSkippedCoolDown)) {
                        if (room.currentWords.length > 99)
                            endRound();
                        if (room.currentBet > room.currentWords.length + 1) {
                            if (room.wordIndex < this.state.roomWordsList.length) {
                                const randomWord = this.state.roomWordsList[room.wordIndex++];
                                if (this.state.activeWord) {
                                    room.currentWords.push({
                                        points: 1,
                                        word: this.state.activeWord,
                                        reported: isWordReported(this.state.activeWord, room.level === 5)
                                    });
                                    recordWordTime();
                                }
                                this.state.activeWord = randomWord;
                                if (this.state.round && this.state.round.lastWordTime == null)
                                    this.state.round.lastWordTime = Date.now();
                                send(room.currentPlayer, "active-word", {
                                    word: this.state.activeWord,
                                    reported: isWordReported(this.state.activeWord, room.level === 5)
                                });
                                if (room.deafMode) {
                                    this.wordSkippedCoolDown = true;
                                    setTimeout(() => {
                                        this.wordSkippedCoolDown = false;
                                    }, 1000);
                                }
                            } else {
                                endRound();
                                room.wordsEnded = true;
                            }
                        } else
                            endRound();
                    }
                    update();
                },
                "set-score": (user, data) => {
                    if (room.hostId === user && room.teams[data.teamId]) {
                        const team = room.teams[data.teamId];
                        if (team && !isNaN(parseInt(data.score)))
                            team.score = parseInt(data.score);
                        update();
                    }
                },
                "set-player-score": (user, data) => {
                    if (room.hostId === user && room.playerNames[data.playerId] && !isNaN(parseInt(data.score))) {
                        room.playerScores[data.playerId] = parseInt(data.score);
                        update();
                    }
                },
                "stop-game": (user) => {
                    if (room.hostId === user) {
                        endRound();
                        room.phase = 0;
                        checkWin();
                        update();
                    }
                },
                "set-word-points": (user, value) => {
                    if (room.hostId === user || Object.keys(room.teams).some((teamId) => room.teams[teamId].players.has(user))) {
                        room.currentWords = value;
                        room.readyPlayers.delete(room.currentPlayer);
                        calcWordPoints();
                        writeRoundLog();
                        update();
                        send(room.onlinePlayers, "highlight-user", user);
                    }
                },
                "remove-player": (user, playerId) => {
                    if (room.hostId === user && playerId && (!room.ranked || room.phase === 0)) {
                        removePlayer(playerId);
                    }
                    update();
                },
                "remove-player-ranked": (user, playerId) => {
                    if (room.hostId === user && playerId && room.ranked && room.phase === 1) {
                        saveRankedResults(user, playerId);
                    }
                    update();
                },
                "shuffle-players": (user) => {
                    if (room.hostId === user) {
                        let currentPlayers = [];
                        Object.keys(room.teams).forEach(teamId => {
                            const team = room.teams[teamId];
                            currentPlayers = currentPlayers.concat([...team.players]);
                            team.players = new JSONSet();
                        });
                        shuffleArray(currentPlayers);
                        while (currentPlayers.length > 0) {
                            Object.keys(room.teams).forEach(teamId => {
                                if (currentPlayers.length > 0)
                                    room.teams[teamId].players.add(currentPlayers.pop());
                            });
                        }
                        resetOrder();
                        update();
                    }
                },
                "restart-game": (user) => {
                    if (room.hostId === user)
                        restartGame();
                    update();
                },
                "set-round-time": (user, time) => {
                    if (!room.ranked && room.hostId === user && !isNaN(time))
                        room.roundTime = time || 0;
                    update();
                },
                "set-goal": (user, goal) => {
                    if (!room.ranked && room.hostId === user && !isNaN(goal) && goal > 0) {
                        if (!room.soloMode)
                            room.goal = goal;
                        else
                            room.soloModeGoal = goal;
                    }
                    update();
                },
                "select-word-set": (user, wordSet) => {
                    if (!room.ranked && room.phase === 0 && room.hostId === user)
                        selectWordSet(wordSet, user);
                },
                "give-host": (user, playerId) => {
                    // организатор турика передаёт хост в любой комнате, даже не будучи хостом
                    if ((room.hostId === user || isTurikAdmin(user)) && playerId) {
                        room.hostId = playerId;
                        this.emit("host-changed", user, playerId);
                    }
                    update();
                },
                "set-turn": (user, playerId) => {
                    if (room.hostId === user && playerId)
                        setTurn(playerId);
                    update();
                },
                "set-assistant": (user, playerId) => {
                    if (room.hostId === user && playerId)
                        setAssistant(playerId);
                    update();
                },
                "set-mode": (user, mode) => {
                    if (!room.ranked && room.phase === 0 && room.hostId === user
                        && ['team', 'solo', 'deaf'].includes(mode) && mode !== room.mode) {
                        room.mode = mode;
                        room.deafMode = false;
                        if (mode === 'team')
                            toggleSoloMode(false);
                        else if (mode === 'solo')
                            toggleSoloMode(true);
                        else if (mode === 'deaf') {
                            room.deafMode = true;
                            toggleSoloMode(false);
                        }
                    }
                    update();
                },
                "toggle-draw-mode": (user, state) => {
                    if (room.phase === 0 && room.hostId === user)
                        room.drawMode = state;
                    update();
                },
                "draw-add": (user, data) => {
                    if (!room.drawCommitOnly && room.drawMode && room.currentPlayer === user && checkDrawData(data)) {
                        this.state.drawTempList.push(data);
                        send([...room.onlinePlayers].filter((id) => id !== user), "draw-add", data);
                    }
                },
                "draw-commit": (user, data) => {
                    if (room.drawMode && room.currentPlayer === user && checkDrawData(data)) {
                        this.state.drawTempList = [];
                        this.state.drawList.push(data);
                        send([...room.onlinePlayers].filter((id) => id !== user), "draw-commit", [data]);
                    }
                },
                "draw-clear": (user) => {
                    if (room.drawMode && room.currentPlayer === user) {
                        this.state.drawTempList = [];
                        this.state.drawList = [];
                        send(room.onlinePlayers, "draw-clear");
                    }
                },
                "view-words-pack": (user, packName, index, isNew) => {
                    if (!(packName.indexOf && ~packName.indexOf("..."))) {
                        fs.readFile(`${appDir}/custom/${(isNew ? "new/" : "")}${packName}.json`, "utf8", function (err, str) {
                            if (str) {
                                const data = JSON.parse(str);
                                send(user, "words-pack", {
                                    wordList: data.wordList,
                                    author: data.author,
                                    packName,
                                    index
                                });
                            }
                            if (err)
                                send(user, "message", JSON.stringify(err));
                        });

                    }
                },
                "words-pack-list": (user) => {
                    fs.readdir(`${appDir}/custom`, "utf8", function (err, files) {
                        if (files)
                            send(user, "words-pack-list", files
                                .filter((name) => name.endsWith(".json"))
                                .map((name) => name.replace(".json", "")));
                        if (err)
                            send(user, "message", err);
                    });
                },
                "setup-words": (user, packName, words) => {
                    if (room.hostId === user && words.length <= 10000) {
                        if (words) {
                            this.state.roomWordsList = shuffleArray(words);
                            room.wordIndex = 0;
                            room.wordsEnded = false;
                            room.level = 0;
                            room.packName = packName;
                            update();
                        }
                    }
                },
                "setup-words-preset": (user, packName) => {
                    if (room.hostId === user) {
                        fs.readFile(`${appDir}/custom/${packName}.json`, "utf8", (err, str) => {
                            if (str) {
                                const data = JSON.parse(str);
                                this.state.roomWordsList = shuffleArray(data.wordList);
                                room.wordIndex = 0;
                                room.wordsEnded = false;
                                room.level = 0;
                                room.packName = packName;
                                update();
                            }
                            if (err)
                                send(user, "message", JSON.stringify(err));
                        });
                    }
                },
                "report-word": (user, word, level) => {
                    if (!isWordReported(word, room.level === 5) && room.currentWords.some((it) => it.word === word)
                        && room.level !== 0 && room.level !== level && [0, 1, 2, 3, 4, 5].includes(level)) {
                        let currentLevel = room.level;
                        const reportInfo = {
                            datetime: +new Date(),
                            user: user,
                            authUser: room.authUsers[user]?._id,
                            playerName: room.playerNames[user],
                            word: word,
                            currentLevel: currentLevel,
                            level: level,
                            processed: false,
                            approved: null
                        };
                        room.currentWords.filter((it) => it.word === word)[0].reported = true;
                        reportedWordsData.push(reportInfo);
                        updateReportView();
                        if (autoDenialRules.some((it) => it[0] === currentLevel && it[1] === level)) {
                            reportInfo.processed = true;
                            reportInfo.approved = false;
                        } else {
                            if (currentLevel === 5 || level === 5) {
                                reportedWordsNoMeta.push(word);
                            } else {
                                reportedWords.push(word);
                            }
                        }
                        fs.appendFile(`${appDir}/reported-words.txt`, `${JSON.stringify(reportInfo)}\n`, () => {
                            if (sortMode) {
                                const moderData = [{
                                    "datetime": reportInfo.datetime,
                                    "approved": true,
                                    "level": level
                                }];
                                this.eventHandlers["apply-words-moderation"](user, moderKey, moderData);
                                update();
                            }
                        });
                        if (!sortMode) update();
                    }
                },
                "get-word-reports-data": (user, data) => {
                    const offset = data && data.offset || 0;
                    const limit = data && data.limit || 250;
                    const noMeta = data && data.noMeta || false;
                    let newWords = 0;
                    let approved = 0;
                    let processed = 0;
                    const filteredData = reportedWordsData.filter(it => noMeta ? (it.currentLevel === 5 || it.level === 5) : (it.currentLevel !== 5 && it.level !== 5));
                    const filteredView = reportedWordsView.filter(it => noMeta ? (it.currentLevel === 5 || it.level === 5) : (it.currentLevel !== 5 && it.level !== 5));
                    filteredData.forEach(it => {
                        if (it.processed) processed++;
                        if (it.approved) approved++;
                        if (it.newWord && it.approved) newWords += (it.wordList ? it.wordList.length : 1);
                    });
                    send(user, "word-reports-data", {
                        words: filteredView.slice(offset, offset + limit),
                        total: filteredData.length,
                        viewTotal: filteredView.length,
                        offset,
                        approved,
                        processed,
                        noMeta,
                        new: newWords
                    });
                },
                "apply-words-moderation": (user, sentModerKey, moderData) => {
                    if (moderData && moderData[0] && sentModerKey === moderKey) {
                        let hasChanges = false;
                        const reportAchievements = [];
                        moderData.forEach((moderData) => {
                            reportedWordsData.some((reportData) => {
                                if (reportData.datetime === moderData.datetime && !reportData.processed) {
                                    hasChanges = true;
                                    reportData.level = moderData.level;
                                    reportData.processed = true;
                                    reportData.approved = moderData.approved;
                                    Object.assign(moderData, reportData);
                                    if (reportData.currentLevel === 5 || reportData.level === 5) {
                                        const reportedWordIndex = reportedWordsNoMeta.indexOf(moderData.word);
                                        if (reportedWordIndex !== -1)
                                            reportedWordsNoMeta.splice(reportedWordIndex, 1);
                                    } else {
                                        const reportedWordIndex = reportedWords.indexOf(moderData.word);
                                        if (reportedWordIndex !== -1)
                                            reportedWords.splice(reportedWordIndex, 1);
                                    }
                                    if (reportData.custom) {
                                        if (reportData.approved) {
                                            fs.rename(
                                                `${appDir}/custom/new/${reportData.datetime}.json`,
                                                `${appDir}/custom/${reportData.packName}.json`, () => {
                                                    updateExistingPacks();
                                                }
                                            );
                                            reportAchievements.push({
                                                authUser: reportData.authUser,
                                                achievement: registry.achievements.createPack.id
                                            });
                                        } else
                                            fs.unlink(`${appDir}/custom/new/${reportData.datetime}.json`, () => {
                                            });
                                    } else {
                                        if (reportData.approved) {
                                            if (!reportData.newWord) {
                                                const wordIndexToRemove = defaultWords[reportData.currentLevel].indexOf(reportData.word);
                                                if (wordIndexToRemove !== -1) {
                                                    defaultWords[reportData.currentLevel].splice(wordIndexToRemove, 1);
                                                    if (reportData.level !== 0)
                                                        defaultWords[reportData.level].push(reportData.word);
                                                }
                                                reportAchievements.push({
                                                    authUser: reportData.authUser,
                                                    achievement: registry.achievements.reportWords.id
                                                });
                                            } else {
                                                reportData.wordList.filter((word) => {
                                                    if (reportData.level === 5) {
                                                        return (!defaultWords[5] || !~defaultWords[5].indexOf(word));
                                                    } else {
                                                        return !~defaultWords[1].indexOf(word)
                                                            && !~defaultWords[2].indexOf(word)
                                                            && !~defaultWords[3].indexOf(word)
                                                            && !~defaultWords[4].indexOf(word);
                                                    }
                                                }).forEach((word) => {
                                                    defaultWords[reportData.level].push(word);

                                                    reportAchievements.push({
                                                        authUser: reportData.authUser,
                                                        achievement: registry.achievements.addWords.id
                                                    });
                                                });
                                            }
                                        }
                                    }
                                    return true;
                                }
                            });
                        });
                        updateReportView();
                        (async () => {
                            for (const item of reportAchievements) {
                                if (item.authUser)
                                    await registry.authUsers.processAchievement({authUser: item.authUser}, item.achievement);
                            }
                        })();
                        if (!hasChanges)
                            send(user, "word-reports-request-status", "Success");
                        else
                            fs.writeFile(`${appDir}/moderated-words.json`, JSON.stringify(defaultWords, null, 4), (err) => {
                                if (!err) {
                                    fs.writeFile(`${appDir}/reported-words.txt`,
                                        reportedWordsData.map((it) => JSON.stringify(it)).join("\n") + "\n",
                                        () => {
                                            let aliasPlayers = [];
                                            registry.roomManagers.forEach((roomManager, roomPath) => {
                                                if (roomPath === path) {
                                                    roomManager.rooms.forEach((roomData) => {
                                                        aliasPlayers = aliasPlayers.concat([...roomData.room.onlinePlayers]);
                                                    });
                                                }
                                            });
                                            if (!sortMode)
                                                userRegistry.send(aliasPlayers, "word-report-notify", moderData);
                                        }
                                    );
                                    if (!sortMode) {
                                        send(user, "word-reports-request-status", "Success");
                                    }
                                } else
                                    send(user, "word-reports-request-status", err.message)
                            });
                    } else
                        send(user, "word-reports-request-status", "Wrong key");
                },
                "remove-user-reports": (user, sentModerKey, removeUser) => {
                    if (removeUser && sentModerKey === moderKey) {
                        reportedWordsData.forEach((reportData) => {
                            if (!reportData.processed && reportData.user === removeUser) {
                                reportData.processed = true;
                                reportData.approved = false;
                                if (reportData.custom)
                                    fs.unlink(`${appDir}/custom/new/${reportData.datetime}.json`, () => {
                                    });
                            }
                        });
                        updateReportView();
                        fs.writeFile(`${appDir}/reported-words.txt`,
                            reportedWordsData.map((it) => JSON.stringify(it)).join("\n") + "\n",
                            () => {
                            }
                        );
                        if (!sortMode)
                            send(user, "word-reports-request-status", "Success");
                    } else
                        send(user, "word-reports-request-status", "Wrong key");
                },
                "add-moder-report": (user, type, noMeta, sentModerKey, words) => {
                    if (sentModerKey !== moderKey) {
                        return send(user, "word-reports-request-status", "Wrong key");
                    }
                    if (noMeta && type !== "remove") {
                        return send(user, "word-reports-request-status", "Invalid type for noMeta");
                    }
                    if (words && words.length) {
                        let wordList = [...(new Set(words.split("\n").map((word) => word.trim().replace(/­/g, ""))))];
                        wordList = wordList.filter((word) => word && word.trim().length > 0);
                        const reportList = [];
                        wordList.forEach((word) => {
                            let currentLevel = null;
                            if (noMeta) {
                                if (defaultWords[5] && ~defaultWords[5].indexOf(word)) {
                                    currentLevel = 5;
                                }
                            } else {
                                [1, 2, 3, 4].some((level) => {
                                    if (defaultWords[level] && ~defaultWords[level].indexOf(word)) {
                                        currentLevel = level;
                                        return true;
                                    }
                                });
                            }
                            
                            if (currentLevel !== null) {
                                let newLevel = 0;
                                if (type === "edit") {
                                    newLevel = currentLevel === 4 ? 3 : currentLevel + 1;
                                }
                                
                                const reportInfo = {
                                    datetime: +new Date(),
                                    user: user,
                                    authUser: room.authUsers[user]?._id,
                                    playerName: room.playerNames[user],
                                    word: word,
                                    currentLevel: currentLevel,
                                    level: newLevel,
                                    processed: false,
                                    approved: null
                                };
                                reportList.push(reportInfo);
                                reportedWordsData.push(reportInfo);
                                if (currentLevel === 5 || newLevel === 5) {
                                    reportedWordsNoMeta.push(word);
                                } else {
                                    reportedWords.push(word);
                                }
                                updateReportView();
                            }
                        });
                        if (reportList.length) {
                            fs.appendFile(`${appDir}/reported-words.txt`,
                                `${reportList.map((it) => JSON.stringify(it)).join("\n")}\n`, () => {
                                });
                            if (!sortMode) {
                                send(user, "word-reports-request-status", "Silent Success");
                            }
                        }
                    }
                },
                "add-words": (user, words, level, packName) => {
                    if (words && words.length) {
                        let wordList = [...(new Set(words.split("\n").map((word) => word.trim().replace(/­/g, ""))))];
                        if (wordList[0] === "!edit" || wordList[0] === "!remove") return;
                        if (level === "custom" && wordList.length <= room.customWordsLimit
                            && packName && packName.length <= 40 && !~packName.indexOf("...")) {
                            wordList = wordList.filter((word) => word
                                && word.trim().length > 0);
                            if (wordList.length > 0) {
                                const reportInfo = {
                                    datetime: +new Date(),
                                    user: user,
                                    authUser: room.authUsers[user]?._id,
                                    playerName: room.playerNames[user],
                                    custom: true,
                                    packName: packName,
                                    processed: false,
                                    approved: null
                                };
                                fs.writeFile(`${appDir}/custom/new/${reportInfo.datetime}.json`, `${JSON.stringify({
                                    wordList, author: reportInfo.playerName, packName
                                }, null, true)}`, (err) => {
                                    if (!err) {
                                        reportedWordsData.push(reportInfo);
                                        updateReportView();
                                        fs.appendFile(`${appDir}/reported-words.txt`, `${JSON.stringify(reportInfo)}\n`, () => {
                                        });
                                    } else
                                        send(user, err);
                                });
                            }
                        } else if (wordList.length <= 50 && [1, 2, 3, 4, 5].includes(level)) {
                            wordList = [...new Set(wordList.map((word) => word.toLowerCase()))];
                            wordList = wordList.filter((word) => {
                                if (!word || word.length > 50 || word.trim().length === 0) return false;
                                if (level === 5) {
                                    return (!defaultWords[5] || !~defaultWords[5].indexOf(word));
                                } else {
                                    return (!defaultWords[1] || !~defaultWords[1].indexOf(word))
                                        && (!defaultWords[2] || !~defaultWords[2].indexOf(word))
                                        && (!defaultWords[3] || !~defaultWords[3].indexOf(word))
                                        && (!defaultWords[4] || !~defaultWords[4].indexOf(word));
                                }
                            });
                            if (wordList.length > 0) {
                                let datetime = +new Date();
                                const reportList = wordList.map(word => ({
                                    datetime: datetime++,
                                    user: user,
                                    authUser: room.authUsers[user]?._id,
                                    playerName: room.playerNames[user],
                                    newWord: true,
                                    wordList: [word],
                                    level: level,
                                    processed: false,
                                    approved: null
                                }))
                                reportedWordsData.push(...reportList);
                                updateReportView();
                                fs.appendFile(`${appDir}/reported-words.txt`, `${reportList.map((it) => JSON.stringify(it)).join("\n")}\n`, () => {
                                });
                            }
                        }
                    }
                },
                "toggle-ranked": (user, rankedMode) => {
                    if (room.phase === 0 && room.hostId === user && room.rankedUsers[user]?.moderator)
                        toggleRanked(!room.ranked, rankedMode);
                    update();
                },
                "check-ranked-account": (user) => {
                    authRanked(user, true);
                    update();
                },
                "toggle-theme": (user) => {
                    registry.authUsers.processAchievement({user, room}, registry.achievements.aliasDarkTheme.id);
                },
                "allow-report": (user) => {
                    registry.authUsers.processAchievement({user, room}, registry.achievements.allowReportsAlias.id);
                }
            };
        }

        getPlayerCount() {
            return Object.keys(this.room.playerNames).length;
        }

        getActivePlayerCount() {
            return this.room.onlinePlayers.size;
        }

        getLastInteraction() {
            return this.lastInteraction;
        }

        getSnapshot() {
            return {
                room: this.room,
                state: {
                    activeWord: this.state.activeWord,
                    roomWordsList: null

                }
            };
        }

        setSnapshot(snapshot) {
            Object.assign(this.room, snapshot.room);
            this.state = snapshot.state;
            if (this.room.level === 0)
                this.room.level = 2;
            this.state.roomWordsList = shuffleArray([...defaultWords[this.room.level]]);
            this.room.phase = 0;
            this.room.currentBet = Infinity;
            this.room.timer = null;
            this.room.onlinePlayers = new JSONSet();
            this.room.spectators = new JSONSet();
            this.room.readyPlayers = new JSONSet(this.room.readyPlayers);
            Object.keys(this.room.teams).forEach((teamId) => {
                this.room.teams[teamId].players = new JSONSet(this.room.teams[teamId].players);
            });
            this.room.onlinePlayers.clear();
        }
    }

    function makeId() {
        let text = "";
        const possible = "abcdefghijklmnopqrstuvwxyz0123456789";

        for (let i = 0; i < 5; i++)
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        return text;
    }

    function shuffleArray(array) {
        let currentIndex = array.length, temporaryValue, randomIndex;
        while (0 !== currentIndex) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }
        return array;
    }

    class JSONSet extends Set {
        constructor(iterable) {
            super(iterable)
        }

        toJSON() {
            return [...this]
        }
    }

    registry.createRoomManager(path, GameState);
}

module.exports = init;
