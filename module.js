function init(wsServer, path) {
    const
        fs = require('fs'),
        http = require("http"),
        express = require('express'),
        app = wsServer.app,
        users = wsServer.users.of("alias");

    let defaultWords;
    fs.readFile(`${__dirname}/words.json`, "utf8", function (err, words) {
        defaultWords = JSON.parse(words);
    });

    app.get(path, function (req, res) {
        res.sendFile(`${__dirname}/public/app.html`);
    });
    app.use("/alias", express.static(`${__dirname}/public`));

    const rooms = new Map();

    users.on("user-joined", (id, data) => {
        if (data && data.roomId && !rooms.has(data.roomId))
            rooms.set(data.roomId, new GameState(id, data, users));
    });

    class GameState {
        constructor(hostId, hostData, userRegistry) {
            const room = {
                inited: true,
                hostId: hostId,
                phase: 0,
                spectators: new JSONSet(),
                playerNames: {},
                readyPlayers: new JSONSet(),
                onlinePlayers: new JSONSet(),
                roundTime: 60,
                currentBet: Infinity,
                goal: 20,
                currentWords: [],
                teams: {},
                wordIndex: 0,
                wordsEnded: false,
                level: 2
            };
            let timer, activeWord, roomWordsList;
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
                        if (indexOfCurrentPlayer === currentTeam.players.size - 1)
                            currentTeam.currentPlayer = currentPlayerKeys[0];
                        else
                            currentTeam.currentPlayer = currentPlayerKeys[indexOfCurrentPlayer + 1];
                        if (room.currentPlayer === currentPlayer)
                            room.currentPlayer = currentTeam.currentPlayer;
                    }
                },
                rotateTeams = () => {
                    if (room.currentTeam) {
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
                    if (room.currentTeam && room.teams[room.currentTeam].players.size === 1)
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
                    Object.keys(room.teams).forEach(teamId => {
                        if (room.teams[teamId].wordPoints !== undefined)
                            room.teams[teamId].wordPoints = wordPoints < 0 ? 0 : wordPoints;
                    });
                },
                addWordPoints = () => {
                    Object.keys(room.teams).forEach(teamId => {
                        const team = room.teams[teamId];
                        if (team.wordPoints !== undefined) {
                            team.score += team.wordPoints;
                            delete team.wordPoints;
                        }
                    });
                },
                stopTimer = () => {
                    room.timer = null;
                    clearInterval(timer);
                },
                endRound = () => {
                    if (activeWord)
                        room.currentWords.push({points: 1, word: activeWord});
                    send(room.onlinePlayers, "active-word", null);
                    activeWord = undefined;
                    calcWordPoints();
                    rotatePlayers();
                    rotateTeams();
                    stopTimer();
                    room.phase = 1;
                },
                startTimer = () => {
                    room.timer = room.roundTime * 1000;
                    timer = setInterval(() => {
                        room.timer -= 100;
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
                },
                restartGame = () => {
                    addWordPoints();
                    room.phase = 0;
                    room.currentWords = [];
                    room.readyPlayers.clear();
                    //room.wordIndex = 0;
                    room.wordsEnded = false;
                    Object.keys(room.teams).forEach(teamId => {
                        const team = room.teams[teamId];
                        delete team.wordPoints;
                        team.score = 0;
                    });
                    resetOrder();
                },
                selectWordSet = (wordSet, user) => {
                    if (!isNaN(parseFloat(wordSet))) {
                        const difficulty = parseFloat(wordSet);
                        if (!~[1, 2, 3].indexOf(difficulty) > 0) {
                            if (user)
                                send(user, "message", "You did something wrong");
                        }
                        else {
                            room.level = difficulty;
                            roomWordsList = shuffleArray([...defaultWords[difficulty]]);
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
                            }
                            else if (team.currentPlayer === playerId)
                                rotatePlayers(teamId);
                        }
                    });
                    delete room.playerNames[playerId];
                    room.readyPlayers.delete(playerId);
                    room.onlinePlayers.delete(playerId);
                    room.spectators.delete(playerId);
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
                joinUser = (user, data) => {
                    if (!room.playerNames[user])
                        room.spectators.add(user);
                    room.onlinePlayers.add(user);
                    room.playerNames[user] = data.userName.substr && data.userName.substr(0, 60);
                    if (!roomWordsList)
                        selectWordSet(2);
                    if (room.currentPlayer === user && activeWord)
                        send(user, "active-word", activeWord);
                    update();
                };
            joinUser(hostId, hostData);
            userRegistry.on("user-joined", (user, data) => {
                joinUser(user, data);
            });
            userRegistry.on("user-left", (user) => {
                room.onlinePlayers.delete(user);
                if (room.spectators.has(user))
                    delete room.playerNames[user];
                room.spectators.delete(user);
                room.readyPlayers.delete(user);
                update();
            });
            userRegistry.on("user-event", (user, eventName, data) => {
                try {
                    if (this.eventHandlers[eventName])
                        this.eventHandlers[eventName](user, data[0]);
                } catch (error) {
                    console.error(error);
                }
            });
            this.eventHandlers = {
                "team-join": (user, id) => {
                    if (id === "new") {
                        id = makeId();
                        room.teams[id] = {score: 0, players: new JSONSet()};
                    }
                    if (room.teams[id]) {
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
                    if (room.phase === 0 && room.hostId === user && Object.keys(room.teams).length > 0) {
                        room.phase = 1;
                        room.currentTeam = room.currentTeam || Object.keys(room.teams)[0];
                        const currentTeam = room.teams[room.currentTeam];
                        currentTeam.currentPlayer = currentTeam.currentPlayer || [...currentTeam.players][0];
                        room.currentPlayer = currentTeam.currentPlayer;
                    } else if (room.phase === 1) {
                        if (room.currentPlayer !== user || room.readyPlayers.size !== room.teams[room.currentTeam].players.size)
                            if (room.readyPlayers.has(user))
                                room.readyPlayers.delete(user);
                            else
                                room.readyPlayers.add(user);
                        else {
                            room.phase = 2;
                            room.readyPlayers.clear();
                            addWordPoints();
                            room.currentWords = [];
                            startTimer();
                        }
                    }
                    if (room.phase === 2 && room.currentPlayer === user) {
                        if (room.currentWords.length > 99)
                            endRound();
                        room.teams[room.currentTeam].wordPoints = 0;
                        if (room.currentBet > room.currentWords.length + 1) {
                            if (room.wordIndex < roomWordsList.length) {
                                const randomWord = roomWordsList[room.wordIndex++];
                                if (activeWord)
                                    room.currentWords.push({points: 1, word: activeWord});
                                activeWord = randomWord;
                                send(user, "active-word", activeWord);
                            } else {
                                endRound();
                                room.wordsEnded = true;
                            }
                        }
                        else
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
                "stop-game": (user) => {
                    if (room.hostId === user) {
                        endRound();
                        room.phase = 0;
                        update();
                    }
                },
                "set-word-points": (user, value) => {
                    room.currentWords = value;
                    room.readyPlayers.delete(room.currentPlayer);
                    calcWordPoints();
                    update();
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
                    if (room.hostId === user && playerId)
                        room.hostId = playerId;
                    update();
                },
                "set-turn": (user, playerId) => {
                    if (room.hostId === user && playerId)
                        setTurn(playerId);
                    update();
                },
                "setup-words": (user, wordsURL) => {
                    if (room.hostId === user && wordsURL && wordsURL.substr(0, 4) === "http")
                        try {
                            http.get(wordsURL.replace("https", "http"),
                                res => {
                                    let str = "";
                                    res.on("data", function (chunk) {
                                        str += chunk;
                                    });

                                    res.on("end", function () {
                                        const newWords = str.toString().split("\r\n");
                                        if (newWords.length > 0) {
                                            roomWordsList = shuffleArray(newWords);
                                            room.wordIndex = 0;
                                            room.wordsEnded = false;
                                            room.level = 0;
                                            send(user, "message", "Success");
                                            update();
                                        }
                                        else
                                            send(user, "message", `You did something wrong`);
                                    });
                                },
                                err => {
                                    send(user, "message", `You did something wrong: ${err.message}`);
                                }
                            );
                        } catch (err) {
                            send(user, "message", `You did something wrong: ${err}`);
                        }
                }
            };
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
        array.sort(() => (Math.random() - 0.5));
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
}

module.exports = init;