const
    path = require('path'),
    fs = require('fs'),
    express = require('express'),
    socketIo = require("socket.io"),
    http = require('http'),
    reCAPTCHA = require('recaptcha2'),
    logging = false;

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

const recaptcha = new reCAPTCHA({
    siteKey: "",
    secretKey: ""
});

let defaultWords, dictWords, dictInitialLength;
fs.readFile(__dirname + "/words.json", "utf8", function (err, words) {
    defaultWords = JSON.parse(words);
});

const
    rooms = {},
    activeWords = {},
    roomWords = {},
    timers = {},
    defaultWordSet = 2,
    authorizedUsers = {},
    attemptIPs = {};

// Server part
const app = express();
app.use('/', express.static(path.join(__dirname, 'public')));

app.get('/alias', function (req, res) {
    res.sendFile(__dirname + '/public/index.html');
});

const server = app.listen(1489);
console.log('Server listening on port 1489');


// Socket.IO part
const io = socketIo(server);

io.on("connection", socket => {
    let room, user, initArgs;
    socket.use((packet, next) => {
        if (packet[0] === "init" || packet[0] === "auth" || room) {
            if (logging)
                fs.appendFile(__dirname + "/logs.txt", `${(new Date()).toISOString()}: ${socket.handshake.address} - ${JSON.stringify(packet)} \n`, () => {
                });
            return next();
        }
    });
    let update = () => io.to(room.roomId).emit("state", room),
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
        leaveTeams = (exceptId) => {
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
            if (room.dictMode) {
                room.currentWords.forEach(word => {
                    if (word.points === 1)
                        dictWords.delete(word.word);
                });
                roomWords[room.roomId] = shuffleArray([...dictWords]);
                room.dictLength = dictWords.size;
                fs.writeFile(__dirname + "/dict.json", JSON.stringify({
                    words: roomWords[room.roomId],
                    initialLength: dictInitialLength
                }, null, 4), () => {
                });
            }
        },
        stopTimer = () => {
            room.timer = null;
            clearInterval(timers[room.roomId]);
        },
        endRound = () => {
            if (activeWords[room.roomId])
                room.currentWords.push({points: 1, word: activeWords[room.roomId]});
            socket.emit("active-word", null);
            activeWords[room.roomId] = undefined;
            calcWordPoints();
            rotatePlayers();
            rotateTeams();
            stopTimer();
            room.phase = 1;
        },
        startTimer = () => {
            room.timer = room.roundTime * 1000;
            timers[room.roomId] = setInterval(() => {
                room.timer -= 100;
                if (room.timer <= 0) {
                    endRound();
                    io.to(room.roomId).emit("timer-end", room);
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
        selectWordSet = wordSet => {
            if (!isNaN(parseFloat(wordSet))) {
                room.dictMode = false;
                const difficulty = parseFloat(wordSet);
                if (!~[1, 2, 3].indexOf(difficulty) > 0)
                    socket.emit("message", "You did something wrong");
                else {
                    room.level = difficulty;
                    roomWords[room.roomId] = shuffleArray(defaultWords[difficulty]);
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
        init = () => {
            socket.join(initArgs.roomId);
            user = initArgs.userId;
            room = rooms[initArgs.roomId] = rooms[initArgs.roomId] || {
                inited: true,
                roomId: initArgs.roomId,
                hostId: user,
                phase: 0,
                spectators: new JSONSet(),
                playerNames: {},
                readyPlayers: new JSONSet(),
                onlinePlayers: new JSONSet(),
                roundTime: 60,
                currentBet: Infinity,
                goal: 20,
                currentWords: [],
                dictMode: false,
                dictInitLength: null,
                dictLength: null,
                teams: {},
                wordIndex: 0,
                wordsEnded: false,
                level: defaultWordSet
            };
            if (!room.playerNames[user])
                room.spectators.add(user);
            room.onlinePlayers.add(user);
            room.playerNames[user] = initArgs.userName;
            if (!roomWords[room.roomId])
                selectWordSet(defaultWordSet);
            if (room.currentPlayer === user && activeWords[room.roomId])
                socket.emit("active-word", activeWords[room.roomId]);
            update();
        };
    socket.on("init", args => {
        initArgs = args;
        if (true || authorizedUsers[initArgs.userId + initArgs.roomId])
            init();
        else
            socket.emit("auth-required")
    });
    socket.on("team-join", id => {
        if (id === "new") {
            id = makeId();
            room.teams[id] = {score: 0, players: new JSONSet()};
        }
        if (room.teams[id]) {
            leaveTeams(id);
            room.spectators.delete(user);
            room.teams[id].players.add(user);
            update();
        }
    });
    socket.on("spectators-join", () => {
        leaveTeams();
        room.spectators.add(user);
        update();
    });
    socket.on("action", () => {
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
                room.teams[room.currentTeam].wordPoints = 0;
                if (room.currentBet > room.currentWords.length + 1) {
                    if (room.wordIndex < roomWords[room.roomId].length) {
                        const randomWord = roomWords[room.roomId][room.wordIndex++];
                        if (activeWords[room.roomId])
                            room.currentWords.push({points: 1, word: activeWords[room.roomId]});
                        activeWords[room.roomId] = randomWord;
                        socket.emit("active-word", activeWords[room.roomId]);
                    } else {
                        endRound();
                        room.wordsEnded = true;
                    }
                }
                else
                    endRound();
            }
            update();
        }
    );
    socket.on("set-score", (teamId, score) => {
        if (room.hostId === user && room.teams[teamId]) {
            const team = room.teams[teamId];
            if (team && !isNaN(parseInt(score)))
                team.score = parseInt(score);
            update();
        }
    });
    socket.on("stop-game", () => {
        if (room.hostId === user) {
            endRound();
            room.phase = 0;
            update();
        }
    });
    socket.on("set-word-points", value => {
        room.currentWords = value;
        room.readyPlayers.delete(room.currentPlayer);
        calcWordPoints();
        update();
    });
    socket.on("change-name", value => {
        if (value)
            room.playerNames[user] = value;
        update();
    });
    socket.on("remove-player", playerId => {
        if (room.hostId === user && playerId)
            removePlayer(playerId);
        update();
    });
    socket.on("shuffle-players", () => {
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
    });
    socket.on("restart-game", () => {
        if (room.hostId === user)
            restartGame();
        update();
    });
    socket.on("set-round-time", time => {
        if (room.hostId === user)
            room.roundTime = time;
        update();
    });
    socket.on("set-goal", goal => {
        if (room.hostId === user)
            room.goal = goal;
        update();
    });
    socket.on("select-word-set", wordSet => {
        if (room.phase === 0 && room.hostId === user)
            selectWordSet(wordSet);
    });
    socket.on("give-host", playerId => {
        if (room.hostId === user && playerId)
            room.hostId = playerId;
        update();
    });
    socket.on("set-turn", playerId => {
        if (room.hostId === user && playerId)
            setTurn(playerId);
        update();
    });
    socket.on("setup-words", wordsURL => {
        if (room.hostId === user && wordsURL)
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
                                roomWords[room.roomId] = shuffleArray(newWords);
                                room.wordIndex = 0;
                                room.wordsEnded = false;
                                room.level = 0;
                                socket.emit("message", "Success");
                                update();
                            }
                            else
                                socket.emit("message", `You did something wrong`);
                        });
                    },
                    err => {
                        socket.emit("message", `You did something wrong: ${err.message}`);
                    }
                );
            } catch (err) {
                socket.emit("message", `You did something wrong: ${err}`);
            }
    });
    socket.on("disconnect", () => {
        if (room) {
            room.onlinePlayers.delete(user);
            if (room.spectators.has(user))
                delete room.playerNames[user];
            room.spectators.delete(user);
            room.readyPlayers.delete(user);
            update();
        }
    });
    socket.on("auth", (key) => {
        if (initArgs && !room && !attemptIPs[socket.handshake.address]) {
            attemptIPs[socket.handshake.address] = true;
            recaptcha.validate(key)
                .then(() => {
                    authorizedUsers[initArgs.userId + initArgs.roomId] = true;
                    init();
                })
                .catch(() => socket.emit("reload"))
                .then(() => {
                    setTimeout(() => {
                        delete attemptIPs[socket.handshake.address];
                    }, 5000)
                })
        }
    });
});

