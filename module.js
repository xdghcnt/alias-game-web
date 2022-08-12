const fs = require("fs");

function init(wsServer, path, moderKey, fbConfig, sortMode) {
    const
        fbAdmin = require('firebase-admin'),
        fbApp = fbConfig && fbAdmin.initializeApp({credential: fbAdmin.credential.cert(fbConfig)}),
        fs = require('fs'),
        app = wsServer.app,
        registry = wsServer.users,
        autoDenialRules = [
            [1, 3], [1, 4], [1, 0], [2, 4]
        ];


    const appDir = registry.config.appDir || __dirname;
    let reportedWordsData = [], reportedWords = [], rankedGames = [];

    const rankedUsers = JSON.parse(fs.readFileSync(`${appDir}/auth-users.json`));

    const rankedUserByToken = {};

    const defaultWords = JSON.parse(fs.readFileSync(`${appDir}/moderated-words.json`));

    fs.readFile(`${appDir}/reported-words.txt`, {encoding: "utf-8"}, (err, data) => {
        if (data) {
            data.split("\n").forEach((row) => row && reportedWordsData.push(JSON.parse(row)));
            reportedWordsData.forEach((it) => !it.processed && reportedWords.push(it.word));
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

    app.get("/alias/ranked/data", (req, res) => {
        res.send({
            rankedGames,
            rankedUsers
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
                rankedUsers[req.query.user].score = parseInt(req.query.score);
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
                Object.keys(rankedGame.rankedScoreDiffs).forEach((player) => {
                    if (rankedUsers[player])
                        rankedUsers[player].score -= rankedGame.rankedScoreDiffs[player];
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
                packName: null,
                customWordsLimit: 1500,
                managedVoice: true,
                rankedUsers: {},
                ranked: false,
                rankedResultsSaved: false,
                rankedScoreDiffs: {},
                deafMode: false,
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
            };
            this.lastInteraction = new Date();
            this.wordSkippedCoolDown = false;
            let timer;
            const
                send = (target, event, data) => userRegistry.send(target, event, data),
                update = () => {
                    if (room.voiceEnabled)
                        processUserVoice();
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
                },
                stopTimer = () => {
                    room.timer = null;
                    clearInterval(timer);
                },
                endRound = () => {
                    if (this.state.activeWord)
                        room.currentWords.push({
                            points: 1,
                            word: this.state.activeWord,
                            reported: !!~reportedWords.indexOf(this.state.activeWord)
                        });
                    send(room.onlinePlayers, "active-word", null);
                    this.state.activeWord = undefined;
                    calcWordPoints();
                    if (room.phase !== 1) {
                        rotatePlayers();
                        rotateTeams();
                    }
                    stopTimer();
                    room.phase = 1;
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
                    this.state.winProcessed = false;
                    addWordPoints();
                    room.phase = 0;
                    room.currentWords = [];
                    room.readyPlayers.clear();
                    //room.wordIndex = 0;
                    room.wordsEnded = false;
                    room.soloModeRound = 0;
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
                        if (!~[1, 2, 3, 4].indexOf(difficulty) > 0) {
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
                registerRankedUser = (user, decodedToken) => {
                    const nameDuplicated = Object.keys(rankedUsers).find((rankedUserId) => {
                        return rankedUsers[rankedUserId].name === room.playerNames[user];
                    });
                    if (nameDuplicated)
                        send(user, 'auth-name-duplicated');
                    else {
                        fs.appendFile(`${appDir}/auth-logs.txt`, `${JSON.stringify({
                            user,
                            name: room.playerNames[user],
                            decodedToken
                        }, null, 4)}\n`, () => {
                        })
                        rankedUsers[decodedToken.uid] = {
                            score: 1000,
                            name: room.playerNames[user],
                            id: decodedToken.uid,
                            registerTime: new Date()
                        };
                        fs.writeFile(`${appDir}/auth-users.json`, JSON.stringify(rankedUsers, null, 4),
                            (err) => {
                                if (!err) {
                                    loginUserRanked(user, decodedToken.id);
                                } else {
                                    delete rankedUsers[decodedToken.uid];
                                    registry.log(`- auth-users.json saving error ${err.message}`);
                                    send(user, "message", `Ошибка регистрации: ${err.message}`);
                                }
                            })
                    }
                },
                loginUserRanked = (user, rankedUserId) => {
                    const rankedUser = rankedUsers[rankedUserId];
                    rankedUserByToken[user] = rankedUser;
                    room.rankedUsers[user] = rankedUser;
                    removeDuplicateUserRanked(user);
                    update();
                },
                toggleRanked = (state) => {
                    room.ranked = state;
                    selectWordSet(2);
                    if (room.ranked) {
                        room.level = 'ranked';
                        room.soloModeGoal = 1;
                        room.roundTime = 60;
                        room.mode = 'solo';
                        room.deafMode = false;
                        toggleSoloMode(true);
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
                removeDuplicateUserRanked = (newUser) => {
                    if (rankedUserByToken[newUser])
                        Object.keys(room.rankedUsers).forEach((user) => {
                            if (user !== newUser && room.rankedUsers[user].id === rankedUserByToken[newUser].id) {
                                delete room.rankedUsers[user];
                                delete rankedUserByToken[user];
                                leaveTeams(user);
                                room.spectators.add(user);
                                if (room.phase === 2)
                                    endRound();
                            }
                        });
                },
                saveRankedResults = (user, leaverId) => {
                    if (room.ranked && (room.phase === 1 || leaverId) && room.hostId === user
                        && room.rankedUsers[user]?.moderator) {
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
                                rankedUsers[otherPlayer].score + acc, 0) / otherPlayers.length;
                            const expectedVictory = 1 / (1 + 10 ** ((avgRankScore - rankedUsers[player].score) / rankedScoreMultiplier));
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
                        Object.keys(rankedScoreDiffs).forEach((player) => prevScores[player] = rankedUsers[player].score);
                        const gameResult = {
                            playerScores,
                            playerRanks: scoreRanks,
                            rankedScoreDiffs,
                            datetime: new Date(),
                            moderator: room.rankedUsers[user].id,
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
                                        rankedUsers[player].score += rankedScoreDiffs[player];
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
                            registry.authUsers.processAchievement(userData, registry.achievements.winGames.id, {game: registry.games.alias.id});
                            if (room.goal >= 100)
                                registry.authUsers.processAchievement(userData, registry.achievements.aliasMarathon.id);
                            if (room.ranked)
                                registry.authUsers.processAchievement(userData, registry.achievements.rankedAliasWin.id);
                        }
                    }
                },
                userJoin = (data) => {
                    const user = data.userId;
                    if (!room.playerNames[user])
                        room.spectators.add(user);
                    room.onlinePlayers.add(user);
                    room.playerNames[user] = data.userName.substr && data.userName.substr(0, 60);
                    if (rankedUserByToken[user]) {
                        removeDuplicateUserRanked(user);
                        room.rankedUsers[user] = rankedUserByToken[user];
                    }
                    if (!this.state.roomWordsList)
                        selectWordSet(2);
                    if (room.currentPlayer === user && this.state.activeWord)
                        send(user, "active-word", {
                            word: this.state.activeWord,
                            reported: !!~reportedWords.indexOf(this.state.activeWord)
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
                            this.eventHandlers[event](user, data[0], data[1], data[2]);
                    } catch (error) {
                        console.error(error);
                        registry.log(error.message);
                    }
                };
            this.updatePublicState = update;
            this.userJoin = userJoin;
            this.userLeft = userLeft;
            this.userEvent = userEvent;
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
                            startTimer();
                        }
                    }
                    if (room.phase === 2
                        && (!room.deafMode ? room.currentPlayer === user : room.teams[room.currentTeam].players.has(user) && !this.wordSkippedCoolDown)) {
                        if (room.currentWords.length > 99)
                            endRound();
                        if (room.currentBet > room.currentWords.length + 1) {
                            if (room.wordIndex < this.state.roomWordsList.length) {
                                const randomWord = this.state.roomWordsList[room.wordIndex++];
                                if (this.state.activeWord)
                                    room.currentWords.push({
                                        points: 1,
                                        word: this.state.activeWord,
                                        reported: !!~reportedWords.indexOf(this.state.activeWord)
                                    });
                                this.state.activeWord = randomWord;
                                send(room.currentPlayer, "active-word", {
                                    word: this.state.activeWord,
                                    reported: !!~reportedWords.indexOf(this.state.activeWord)
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
                    if (room.hostId === user && playerId && (!room.ranked || rankedUserByToken[playerId]?.moderator)) {
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
                    if (!~reportedWords.indexOf(word) && room.currentWords.some((it) => it.word === word)
                        && room.level !== 0 && room.level !== level && [0, 1, 2, 3, 4].includes(level)) {
                        let currentLevel = room.level;
                        if (currentLevel === 'ranked')
                            currentLevel = 2;
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
                        if (autoDenialRules.some((it) => it[0] === currentLevel && it[1] === level)) {
                            reportInfo.processed = true;
                            reportInfo.approved = false;
                        } else reportedWords.push(word);
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
                "get-word-reports-data": (user) => {
                    send(user, "word-reports-data", reportedWordsData);
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
                                    const reportedWordIndex = reportedWords.indexOf(moderData.word);
                                    if (reportedWordIndex !== -1)
                                        reportedWords.splice(reportedWordIndex, 1);
                                    if (reportData.custom) {
                                        if (reportData.approved) {
                                            fs.rename(
                                                `${appDir}/custom/new/${reportData.datetime}.json`,
                                                `${appDir}/custom/${reportData.packName}.json`, () => {
                                                }
                                            );
                                            reportAchievements.push({authUser: reportData.authUser, achievement: registry.achievements.createPack.id});
                                        } else
                                            fs.unlink(`${appDir}/custom/new/${reportData.packName}.json`, () => {
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
                                                reportAchievements.push({authUser: reportData.authUser, achievement: registry.achievements.reportWords.id});
                                            } else {
                                                reportData.wordList.filter((word) =>
                                                    !~defaultWords[1].indexOf(word)
                                                    && !~defaultWords[2].indexOf(word)
                                                    && !~defaultWords[3].indexOf(word)
                                                    && !~defaultWords[4].indexOf(word)).forEach((word) => {
                                                    defaultWords[reportData.level].push(word);

                                                    reportAchievements.push({authUser: reportData.authUser, achievement: registry.achievements.addWords.id});
                                                });
                                            }
                                        }
                                    }
                                    return true;
                                }
                            });
                        });
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
                                        send(user, "word-reports-data", reportedWordsData);
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
                                    fs.unlink(`${appDir}/custom/new/${reportData.packName}.json`, () => {
                                    });
                            }
                        });
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
                "add-words": (user, words, level, packName) => {
                    if (words && words.length) {
                        let wordList = [...(new Set(words.split("\n").map((word) => word.trim().replace(/­/g, ""))))];
                        if ((wordList[0] === "!edit" || wordList[0] === "!remove") && wordList[1] === moderKey) {
                            const
                                reportList = [],
                                newLevel = wordList[0] === "!remove" ? 0 : level;
                            wordList.splice(0, 2);
                            wordList.forEach((word) => {
                                let currentLevel = null;
                                [1, 2, 3, 4].some((level) => {
                                    if (level !== newLevel && ~defaultWords[level].indexOf(word)) {
                                        currentLevel = level;
                                        return true;
                                    }
                                });
                                if (currentLevel !== null) {
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
                                    reportedWords.push(word);
                                }
                            });
                            if (reportList.length)
                                fs.appendFile(`${appDir}/reported-words.txt`,
                                    `${reportList.map((it) => JSON.stringify(it)).join("\n")}\n`, () => {
                                    });
                        } else if (level === "custom" && wordList.length <= room.customWordsLimit
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
                                    if (!err)
                                        reportedWordsData.push(reportInfo);
                                    else
                                        send(user, err);
                                });
                            }
                        } else if (wordList.length <= 50 && [1, 2, 3, 4].includes(level)) {
                            wordList = [...new Set(wordList.map((word) => word.toLowerCase()))];
                            wordList = wordList.filter((word) =>
                                word
                                && word.length <= 50 && word.trim().length > 0
                                && !~defaultWords[1].indexOf(word)
                                && !~defaultWords[2].indexOf(word)
                                && !~defaultWords[3].indexOf(word)
                                && !~defaultWords[4].indexOf(word));
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
                                fs.appendFile(`${appDir}/reported-words.txt`, `${reportList.map((it) => JSON.stringify(it)).join("\n")}\n`, () => {
                                });
                            }
                        }
                    }
                },
                "fb-auth": (user, token) => {
                    if (fbApp)
                        fbApp.auth()
                            .verifyIdToken(token)
                            .then((decodedToken) => {
                                if (!rankedUsers[decodedToken.uid])
                                    registerRankedUser(user, decodedToken);
                                else
                                    loginUserRanked(user, decodedToken.uid);
                            })
                            .catch((error) => {
                                registry.log(`- login error - ${error.message}`);
                            });
                    else send(user, 'message', 'Ranked-режим не активен');
                },
                "fb-logout": (user) => {
                    delete room.rankedUsers[user];
                    delete rankedUserByToken[user];
                    if (room.ranked) {
                        leaveTeams(user);
                        room.spectators.add(user);
                    }
                    update();
                },
                "toggle-ranked": (user) => {
                    if (room.phase === 0 && room.hostId === user && room.rankedUsers[user]?.moderator)
                        toggleRanked(!room.ranked);
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
            Object.keys(this.room.rankedUsers).forEach((user) => {
                rankedUserByToken[user] = rankedUsers[this.room.rankedUsers[user].id];
                this.room.rankedUsers[user] = rankedUsers[this.room.rankedUsers[user].id];
            })
            if (this.room.level === 0)
                this.room.level = 2;
            this.state.roomWordsList = shuffleArray([...defaultWords[this.room.level === 'ranked' ? 2 : this.room.level]]);
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
