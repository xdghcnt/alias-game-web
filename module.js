function init(wsServer, path, moderKey) {
    const
        fs = require('fs'),
        express = require('express'),
        app = wsServer.app,
        registry = wsServer.users,
        EventEmitter = require("events"),
        channel = "alias",
        autoDenialRules = [
            [1, 3], [1, 4], [1, 0], [2, 4]
        ];

    const appDir = registry.config.appDir || __dirname;
    let defaultWords, reportedWordsData = [], reportedWords = [];

    fs.readFile(`${__dirname}/words.json`, "utf8", function (err, words) {
        defaultWords = JSON.parse(words);
        fs.readFile(`${appDir}/moderated-words.json`, "utf8", function (err, words) {
            if (words)
                defaultWords = JSON.parse(words);
        });
    });

    fs.readFile(`${appDir}/reported-words.txt`, {encoding: "utf-8"}, (err, data) => {
        if (data) {
            data.split("\n").forEach((row) => row && reportedWordsData.push(JSON.parse(row)));
            reportedWordsData.forEach((it) => !it.processed && reportedWords.push(it.word));
        }
    });

    fs.mkdir(`${appDir}/custom`, () => {
        fs.mkdir(`${appDir}/custom/new`, () => {
        });
    });

    app.get(path, function (req, res) {
        res.sendFile(`${__dirname}/public/app.html`);
    });
    app.use("/alias", express.static(`${__dirname}/public`));

    class GameState extends EventEmitter {
        constructor(hostId, hostData, userRegistry) {
            super();
            const room = {
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
                soloModeOver: false,
                packName: null,
                customWordsLimit: 1500
            };
            this.room = room;
            this.state = {
                activeWord: null,
                roomWordsList: null,
                drawList: [],
                drawTempList: []
            };
            this.lastInteraction = new Date();
            let timer;
            const
                send = (target, event, data) => userRegistry.send(target, event, data),
                update = () => {
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
                                    room.soloModeOver = true;
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
                    addWordPoints();
                    room.phase = 0;
                    room.currentWords = [];
                    room.readyPlayers.clear();
                    //room.wordIndex = 0;
                    room.wordsEnded = false;
                    room.soloModeOver = false;
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
                        registry.disconnect(playerId, "You was removed");
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
                userJoin = (data) => {
                    const user = data.userId;
                    if (!room.playerNames[user])
                        room.spectators.add(user);
                    room.onlinePlayers.add(user);
                    room.playerNames[user] = data.userName.substr && data.userName.substr(0, 60);
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
                    if (room.spectators.has(user))
                        delete room.playerNames[user];
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
            this.userJoin = userJoin;
            this.userLeft = userLeft;
            this.userEvent = userEvent;
            this.eventHandlers = {
                "team-join": (user, id) => {
                    if (id === "new") {
                        id = makeId();
                        room.teams[id] = {score: 0, players: new JSONSet()};
                    }
                    if (room.teams[id] && !room.teams[id].players.has(user)) {
                        leaveTeams(user, id);
                        room.spectators.delete(user);
                        room.teams[id].players.add(user);
                        update();
                    }
                },
                "spectators-join": (user) => {
                    leaveTeams(user);
                    room.spectators.add(user);
                    update();
                },
                "action": (user) => {
                    if (room.phase === 0 && room.hostId === user && Object.keys(room.teams).length > 0
                        && (!room.soloMode || room.teams[Object.keys(room.teams)[0]].players.size > 1)) {
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
                    if (room.phase === 2 && room.currentPlayer === user) {
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
                                send(user, "active-word", {
                                    word: this.state.activeWord,
                                    reported: !!~reportedWords.indexOf(this.state.activeWord)
                                });
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
                        room.playerScores[data.playerId] = data.score;
                        update();
                    }
                },
                "stop-game": (user) => {
                    if (room.hostId === user) {
                        endRound();
                        room.phase = 0;
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
                "change-name": (user, value) => {
                    if (value)
                        room.playerNames[user] = value.substr && value.substr(0, 60);
                    update();
                },
                "remove-player": (user, playerId) => {
                    if (room.hostId === user && playerId)
                        removePlayer(playerId);
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
                    if (room.hostId === user)
                        room.roundTime = time;
                    update();
                },
                "set-goal": (user, goal) => {
                    if (room.hostId === user)
                        room.goal = goal;
                    update();
                },
                "select-word-set": (user, wordSet) => {
                    if (room.phase === 0 && room.hostId === user)
                        selectWordSet(wordSet, user);
                },
                "give-host": (user, playerId) => {
                    if (room.hostId === user && playerId) {
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
                "toggle-solo-mode": (user, state) => {
                    if (room.phase === 0 && room.hostId === user) {
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
                "report-word": (user, word, currentLevel, level) => {
                    if (!~reportedWords.indexOf(word) && room.currentWords.some((it) => it.word === word)) {
                        const reportInfo = {
                            datetime: +new Date(),
                            user: user,
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
                        });
                        update();
                    }
                },
                "get-word-reports-data": (user) => {
                    send(user, "word-reports-data", reportedWordsData);
                },
                "apply-words-moderation": (user, sentModerKey, moderData) => {
                    if (moderData && moderData[0] && sentModerKey === moderKey) {
                        let hasChanges = false;
                        moderData.forEach((moderData) => {
                            reportedWordsData.some((reportData) => {
                                if (reportData.datetime === moderData.datetime && !reportData.processed) {
                                    hasChanges = true;
                                    reportData.processed = true;
                                    reportData.approved = moderData.approved;
                                    Object.assign(moderData, reportData);
                                    const reportedWordIndex = reportedWords.indexOf(moderData.word);
                                    if (reportedWordIndex !== -1)
                                        reportedWords.splice(reportedWordIndex, 1);
                                    if (reportData.custom) {
                                        if (reportData.approved)
                                            fs.rename(
                                                `${appDir}/custom/new/${reportData.datetime}.json`,
                                                `${appDir}/custom/${reportData.packName}.json`, () => {
                                                }
                                            );
                                        else
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
                                            } else {
                                                reportData.wordList.filter((word) =>
                                                    !~defaultWords[1].indexOf(word)
                                                    && !~defaultWords[2].indexOf(word)
                                                    && !~defaultWords[3].indexOf(word)
                                                    && !~defaultWords[4].indexOf(word)).forEach((word) => defaultWords[reportData.level].push(word));
                                            }
                                        }
                                    }
                                    return true;
                                }
                            });
                        });
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
                                            userRegistry.send(aliasPlayers, "word-report-notify", moderData);
                                        }
                                    );
                                    send(user, "word-reports-data", reportedWordsData);
                                    send(user, "word-reports-request-status", "Success");
                                } else
                                    send(user, "word-reports-request-status", err.message)
                            });
                    } else
                        send(user, "word-reports-request-status", "Wrong key");
                },
                "add-words": (user, words, level, packName) => {
                    if (words && words.length) {
                        let wordList = [...(new Set(words.split("\n").map((word) => word.trim())))];
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
                        } else if (wordList.length <= 50) {
                            wordList = [...new Set(wordList.map((word) => word.toLowerCase()))];
                            wordList = wordList.filter((word) =>
                                word
                                && word.length <= 50 && word.trim().length > 0
                                && !~defaultWords[1].indexOf(word)
                                && !~defaultWords[2].indexOf(word)
                                && !~defaultWords[3].indexOf(word)
                                && !~defaultWords[4].indexOf(word));
                            if (wordList.length > 0) {
                                const reportInfo = {
                                    datetime: +new Date(),
                                    user: user,
                                    playerName: room.playerNames[user],
                                    newWord: true,
                                    wordList,
                                    level: level,
                                    processed: false,
                                    approved: null
                                };
                                reportedWordsData.push(reportInfo);
                                fs.appendFile(`${appDir}/reported-words.txt`, `${JSON.stringify(reportInfo)}\n`, () => {
                                });
                            }
                        }
                    }
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

    registry.createRoomManager(path, channel, GameState);
}

module.exports = init;
