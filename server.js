const
    path = require('path'),
    fs = require('fs'),
    express = require('express'),
    socketIo = require("socket.io");

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

const stateExample = {
    inited: true,
    started: false,
    actionRequired: true,
    readyState: true,
    actionText: "Readye",
    statusText: "Start game",
    currentTeam: 2,
    actionDisabled: false,
    currentBet: 4,
    currentPlayer: "b",
    readyPlayers: ["d", "c", "a"],
    playerNames: {a: "churuya", b: "lol", c: "lel", d: "kek"},
    onlinePlayers: ["a", "b", "c"],
    wordsBet: 4,
    phase: 0,
    currentWords: [],
    gameTime: 42321232323,
    roundTime: 12312316541,
    spectators: ["c", "d"],
    teams: {
        1: {
            score: 1231,
            players: ["a", "b"]
        },
        2: {
            score: 11,
            players: ["c", "d"]
        },
        3: {
            score: 0,
            players: []
        }
    }
};

const rooms = {};
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
            currentBet: 4,
            teams: {[makeId()]: {score: 0, players: new JSONSet()}}
        };
        if (!room.playerNames[user])
            room.spectators.add(user);
        room.onlinePlayers.add(user);
        room.playerNames[user] = args.userName;
        console.log(room);
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
        } else if (room.phase === 1) {
            if (room.readyPlayers.has(user))
                room.readyPlayers.delete(user);
            else
                room.readyPlayers.add(user);
        }
        update();
    })
});

