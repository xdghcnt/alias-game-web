const
    path = require('path'),
    fs = require('fs'),
    express = require('express'),
    socketIo = require("socket.io"),
    http = require('http');

function makeId() {
    let text = "";
    const possible = "abcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < 5; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

class JSONSet extends Set {
    constructor(iterable) {
        super(iterable)
    }

    toJSON() {
        return [...this]
    }
}

let defaultWords, dictWords, dictInitialLength;
fs.readFile("words.json", "utf8", function (err, words) {
    defaultWords = JSON.parse(words);
});

const
    rooms = {},
    activeWords = {},
    roomWords = {},
    usedWords = {},
    timers = {},
    defaultWordSet = "23";

// Server part
const app = express();
app.use('/', express.static(path.join(__dirname, 'public')));

const server = app.listen(8000);
console.log('Server listening on port 8000');


// Socket.IO part
const io = socketIo(server);

io.on("connection", socket => {
    let room, user,
        update = () => io.to(room.roomId).emit("state", room),
        leaveTeams = (exceptId) => {
            Object.keys(room.teams).forEach(teamId => {
                if (teamId !== exceptId && room.teams[teamId].players.delete(user) && room.teams[teamId].players.size === 0)
                    delete room.teams[teamId];
            });
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
                roomWords[room.roomId] = [...dictWords];
                room.dictLength = dictWords.size;
                fs.writeFile("dict.json", JSON.stringify({
                    words: roomWords[room.roomId],
                    initialLength: dictInitialLength
                }, null, 4));
            }
        },
        rotatePlayers = (teamId) => {
            const
                currentTeam = room.teams[teamId || room.currentTeam],
                currentPlayer = currentTeam.currentPlayer,
                currentPlayerKeys = [...currentTeam.players],
                indexOfCurrentPlayer = currentPlayerKeys.indexOf(currentTeam.currentPlayer);
            if (indexOfCurrentPlayer === currentTeam.players.size - 1)
                currentTeam.currentPlayer = currentPlayerKeys[0];
            else
                currentTeam.currentPlayer = currentPlayerKeys[indexOfCurrentPlayer + 1];
            if (room.currentPlayer === currentPlayer)
                room.currentPlayer = currentTeam.currentPlayer;
        },
        rotateTeams = () => {
            const
                teamKeys = Object.keys(room.teams),
                indexOfCurrentTeam = teamKeys.indexOf(room.currentTeam);
            if (indexOfCurrentTeam === teamKeys.length - 2)
                room.currentTeam = teamKeys[0];
            else
                room.currentTeam = teamKeys[indexOfCurrentTeam + 1];
            if (!room.teams[room.currentTeam].currentPlayer)
                room.teams[room.currentTeam].currentPlayer = [...room.teams[room.currentTeam].players][0];
            room.currentPlayer = room.teams[room.currentTeam].currentPlayer;
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
        restartGame = () => {
            addWordPoints();
            room.phase = 0;
            room.currentWords = [];
            usedWords[room.roomId] = [];
            room.readyPlayers.clear();
            Object.keys(room.teams).forEach(teamId => {
                const team = room.teams[teamId];
                delete team.wordPoints;
                team.score = 0;
            });
        },
        selectWordSet = wordSet => {
            if (wordSet === "1488") {
                fs.readFile("dict.json", "utf8", function (err, words) {
                    try {
                        const data = JSON.parse(words);
                        dictWords = data.words;
                        dictInitialLength = data.initialLength || dictWords.length;
                        roomWords[room.roomId] = dictWords;
                        dictWords = new Set(dictWords);
                        room.dictMode = true;
                        room.dictInitLength = dictInitialLength;
                        room.dictLength = dictWords.size;
                        socket.emit("message", "Success");
                        update();
                    } catch (error) {
                        socket.emit("message", `You did something wrong: ${error}`);
                    }
                });
            }
            else {
                room.dictMode = false;
                const difficultyList = wordSet.split("");
                if (difficultyList.filter(number => !~["1", "2", "3"].indexOf(number)).length > 0)
                    socket.emit("message", "You did something wrong");
                else {
                    roomWords[room.roomId] = [];
                    difficultyList.forEach(wordIndex => {
                        roomWords[room.roomId] = roomWords[room.roomId].concat(defaultWords[wordIndex]);
                    })
                }
                update();
            }
        };
    socket.on("init", args => {
        socket.join(args.roomId);
        user = args.userId;
        room = rooms[args.roomId] = rooms[args.roomId] || {
            inited: true,
            roomId: args.roomId,
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
            teams: {[makeId()]: {score: 0, players: new JSONSet()}}
        };
        usedWords[room.roomId] = [];
        if (!room.playerNames[user])
            room.spectators.add(user);
        room.onlinePlayers.add(user);
        room.playerNames[user] = args.userName;
        selectWordSet(defaultWordSet);
        if (room.currentPlayer === user && activeWords[room.roomId])
            socket.emit("active-word", activeWords[room.roomId]);
        update();
    });
    socket.on("team-join", id => {
        if (room.teams[id]) {
            if (room.teams[id].players.size === 0)
                room.teams[makeId()] = {score: 0, players: new JSONSet()};
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
            if (room.phase === 0 && room.hostId === user) {
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
                    let randomWord, result, n = 0;
                    while (!result) {
                        randomWord = roomWords[room.roomId][Math.floor(Math.random() * roomWords[room.roomId].length)];
                        if (!usedWords[room.roomId].some(word => word === randomWord) || n++ > 10)
                            result = true;
                    }
                    if (activeWords[room.roomId])
                        room.currentWords.push({points: 1, word: activeWords[room.roomId]});
                    activeWords[room.roomId] = randomWord;
                    usedWords[room.roomId].push(randomWord);
                    socket.emit("active-word", activeWords[room.roomId]);
                }
                else
                    endRound();
            }
            update();
        }
    );
    socket.on("set-score", (teamIndex, score) => {
        const team = room.teams[Object.keys(room.teams)[teamIndex - 1]];
        if (team && !isNaN(parseInt(score)))
            team.score = parseInt(score);
        update();
    });
    socket.on("stop-game", () => {
        room.phase = 0;
        update();
    });
    socket.on("set-words-bet", value => {
        //room.currentBet = value;
        update();
    });
    socket.on("set-word-points", value => {
        room.currentWords = value;
        room.readyPlayers.delete(room.currentPlayer);
        calcWordPoints();
        update();
    });
    socket.on("skip-player", () => {
        rotatePlayers();
        update();
    });
    socket.on("skip-turn", () => {
        rotatePlayers();
        rotateTeams();
        update();
    });
    socket.on("change-name", value => {
        if (value)
            room.playerNames[user] = value;
        update();
    });
    socket.on("remove-player", nickname => {
        let user;
        Object.keys(room.playerNames).forEach(userId => {
            if (room.playerNames[userId] === nickname)
                user = userId;
        });
        Object.keys(room.teams).forEach(teamId => {
            room.teams[teamId].players.delete(user);
            if (room.teams[teamId].currentPlayer === user)
                rotatePlayers(teamId);
        });
        delete room.playerNames[user];
        room.readyPlayers.delete(user);
        room.onlinePlayers.delete(user);
        room.spectators.delete(user);
        update();
    });
    socket.on("restart-round", nickname => {
        room.phase = 1;
        room.currentWords = [];
        room.readyPlayers.clear();
        update();
    });
    socket.on("restart-game", () => {
        restartGame();
        update();
    });
    socket.on("set-round-time", time => {
        room.roundTime = time;
    });
    socket.on("stop-timer", () => {
        endRound();
        update();
    });
    socket.on("set-goal", goal => {
        room.goal = goal;
        update();
    });
    socket.on("select-word-set", wordSet => {
        selectWordSet(wordSet);
    });
    socket.on("setup-words", wordsURL => {
        if (wordsURL)
            try {
                http.get(wordsURL.replace("https", "http"),
                    res => {
                        res.on("data", function (chunk) {
                            const newWords = chunk.toString().split("\r\n");
                            if (newWords.length > 0) {
                                roomWords[room.roomId] = newWords;
                                socket.emit("message", "Success");
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
});

