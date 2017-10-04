//import React from "react";
//import ReactDOM from "react-dom"
//import io from "socket.io"
function makeId() {
    let text = "";
    const possible = "abcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < 5; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}


class Teams extends React.Component {
    render() {
        const
            data = this.props.data,
            handleTeamClick = this.props.handleTeamClick;
        if (data.phase === 0)
            data.teams["new"] = {
                players: [],
                score: 0
            };
        return (
            <div
                className={
                    "team-list"
                    + (data.phase !== 0 ? " started" : " not-started")
                }>
                {data.teams && Object.keys(data.teams).map((teamId, index) =>
                    (<div onClick={() => handleTeamClick(teamId)} className={
                        "team"
                        + (teamId !== "new" || data.phase !== 0 ? "" : " join")
                        + (data.currentTeam === teamId ? " current" : "")
                        + (data.teams[teamId].score + (data.teams[teamId].wordPoints || 0) >= data.goal ? " goal-reached" : "")
                        + (data.teams[teamId].winner ? " winner" : "")
                    } key={index}>
                        <div className="score">Score: {data.teams[teamId].score}
                            <span className={
                                "word-points"
                                + (data.teams[teamId].wordPoints ? " active" : "")
                                + (data.teams[teamId].wordPoints > 0 ? " positive" : "")
                                + (data.teams[teamId].wordPoints < 0 ? " negative" : "")
                            }>{Math.abs(data.teams[teamId].wordPoints)}</span>
                        </div>
                        <div className="players-container">
                            {
                                data.teams[teamId].players && data.teams[teamId].players.map(
                                    (player, index) => (<Player key={index} data={data} id={player}/>)
                                )
                            }
                        </div>
                    </div>)
                )}
            </div>
        );
    }
}

class Spectators extends React.Component {
    render() {
        const data = this.props.data,
            handleSpectatorsClick = this.props.handleSpectatorsClick;
        return (
            <div
                onClick={handleSpectatorsClick}
                className={
                    "spectators"
                    + (data.phase !== 0 ? " started" : " not-started")
                }>
                {
                    data.spectators && data.spectators.map(
                        (player, index) => (<Player key={index} data={data} id={player}/>)
                    )
                }
            </div>
        );
    }
}

class Timer extends React.Component {
    render() {
        return (
            <div className="timer">
                {this.props.data.timer && (new Date(this.props.data.timer)).toUTCString().match(/(\d\d:\d\d )/)[0].trim()}
            </div>
        );
    }
}

class Words extends React.Component {
    render() {
        const data = this.props.data,
            handleChange = this.props.handleChange;
        return (
            <div className={
                "words"
                + (data.phase === 1 ? " counting" : "")
            }>
                {data.currentWords && ((!(data.activeWord && data.phase === 2) ? data.currentWords : data.currentWords.concat([{
                    points: 1,
                    word: data.activeWord
                }])).map((word, index) => (
                    <div className="word">{word.word}
                        <input
                            className={word.points > 0 ? "positive" : (word.points === 0 ? "" : "negative")}
                            type="number" value={word.points} min="-2" max="1"
                            onChange={evt => !isNaN(evt.target.valueAsNumber) && handleChange(index, evt.target.valueAsNumber)}
                        />
                    </div>
                )))}
            </div>
        );
    }
}

class Player extends React.Component {
    render() {
        const data = this.props.data,
            id = this.props.id;
        return (
            <div className={
                "player"
                + (~data.readyPlayers.indexOf(id) ? " ready" : "")
                + (!~data.onlinePlayers.indexOf(id) ? " offline" : "")
                + (id === data.userId ? " self" : "")
                + (id === data.currentPlayer ? " current" : "")
            }>
                {data.playerNames[id]}
            </div>
        );
    }
}

class Game extends React.Component {
    componentDidMount() {
        const initArgs = {};
        if (!localStorage.userId) {
            while (!localStorage.userName)
                localStorage.userName = prompt("Your name");
            localStorage.userId = makeId();
        }
        if (!location.hash)
            location.hash = makeId();
        initArgs.roomId = location.hash.substr(1);
        initArgs.userId = this.userId = localStorage.userId;
        initArgs.userName = localStorage.userName;
        this.socket = io();
        this.socket.on("state", state => this.setState(Object.assign({
            userId: this.userId,
            activeWord: this.state.activeWord
        }, state)));
        this.socket.on("active-word", word => {
            this.setState(Object.assign({}, this.state, {
                userId: this.userId,
                activeWord: word
            }));
        });
        this.socket.on("timer-end", () => {
            this.timerSound.play();
        });
        this.socket.on("message", text => {
            alert(text);
        });
        this.socket.on("disconnect", () => {
            this.setState({
                inited: false
            });
            window.location.reload();
        });
        document.title = `Alias - ${initArgs.roomId}`;
        this.socket.emit("init", initArgs);
        this.timerSound = new Audio("beep.mp3");
    }

    constructor() {
        super();
        this.state = {
            inited: false
        };
    }

    handleSpectatorsClick() {
        if (this.state.phase === 0)
            this.socket.emit("spectators-join");
    }

    handleTeamClick(id) {
        if (this.state.phase === 0)
            this.socket.emit("team-join", id);
    }

    handleAction() {
        this.socket.emit("action");
    }

    handleChangeWordPoints(id, value) {
        if (value > -2 && value < 2) {
            this.state.currentWords[id].points = value;
            this.socket.emit("set-word-points", this.state.currentWords);
        }
    }

    handleChangeBet(value) {
        this.socket.emit("set-words-bet", value);
    }

    handleHostAction(evt) {
        const action = evt.target.className;
        if (action === "set-score")
            this.socket.emit("set-score", prompt("Team number"), prompt("Score"));
        else if (action === "remove-player")
            this.socket.emit("remove-player", prompt("Nickname"));
        else if (action === "set-round-time")
            this.socket.emit("set-round-time", prompt("Round time in seconds"));
        else if (action === "set-goal")
            this.socket.emit("set-goal", prompt("Words count to win"));
        else if (action === "setup-words")
            this.socket.emit("setup-words", prompt("URL to words separated by lines"));
        else if (action === "select-word-set")
            this.socket.emit("select-word-set", prompt("1-3 difficulty levels. Default is 23 which means 2 and 3 both"));
        else if (action === "give-host")
            this.socket.emit("give-host", prompt("Nickname"));
        else if (action === "change-name") {
            const name = prompt("New name");
            this.socket.emit("change-name", name);
            localStorage.userName = name;
        }
        else if (action === "restart-game" && confirm("Restart? Are you sure?"))
            this.socket.emit("restart-game");
        else if (action !== "restart-game")
            this.socket.emit(action);
    }

    render() {
        clearTimeout(this.timeOut);
        if (this.state.inited && !this.state.playerNames[this.state.userId])
            return (<div>You were kicked</div>);
        else if (this.state.inited) {
            const
                data = this.state,
                isHost = data.hostId === data.userId,
                isTurn = data.currentPlayer === data.userId,
                isTeamTurn = data.currentTeam && data.teams[data.currentTeam] && !!~data.teams[data.currentTeam].players.indexOf(data.userId),
                currentTeam = data.teams[data.currentTeam];
            let actionText, statusText,
                showWordsBet = false,
                gameIsOver;
            if (data.phase === 0) {
                if (Object.keys(data.teams).length > 0 || Object.keys(data.teams).filter(teamId => data.teams[teamId].players.length > 1).length > 1) {
                    if (isHost) {
                        statusText = "You can start the game";
                        actionText = "Start";
                    }
                    else
                        statusText = "Host can start the game";
                }
                else
                    statusText = "Waiting for players";
            }
            else if (data.phase === 1) {
                if (Object.keys(data.teams).indexOf(data.currentTeam) === 0) {
                    let mostPoints = 0,
                        mostPointsTeam,
                        teamsReachedGoal = Object.keys(data.teams).filter(teamId => {
                            const
                                team = data.teams[teamId],
                                points = team.score + (team.wordPoints || 0);
                            if (points > mostPoints) {
                                mostPoints = points;
                                mostPointsTeam = teamId;
                            }
                            return points >= data.goal;
                        });
                    if (teamsReachedGoal.length > 0 && (teamsReachedGoal.length === 1 || teamsReachedGoal.filter(teamId => {
                            const
                                team = data.teams[teamId],
                                firstTeam = data.teams[teamsReachedGoal[0]];
                            return (team.score + (team.wordPoints || 0)) === (firstTeam.score + (firstTeam.wordPoints || 0));
                        }).length === 1)) {
                        gameIsOver = true;
                        data.teams[mostPointsTeam].winner = true;
                        statusText = `Team ${Object.keys(data.teams).indexOf(mostPointsTeam) + 1} wins!`;
                    }
                }
                //showWordsBet = true;
                if (!gameIsOver) {
                    if (isTurn && data.readyPlayers.length === currentTeam.players.length) {
                        actionText = "Start!";
                        statusText = "Prepare to explain things";
                    } else if (isTeamTurn) {
                        actionText = "Ready";
                        statusText = "Waiting for team.";
                    }
                    else
                        statusText = "Waiting for other team.";
                }
            }
            else if (data.phase === 2) {
                if (isTurn) {
                    statusText = "Explain things!";
                    actionText = "Next";
                }
                else if (isTeamTurn)
                    statusText = "Call out things!";
                else
                    statusText = "Other team playing, keep silent.";
                const timerSecondDiff = ((this.state.timer % 100) || 100);
                if (this.state.timer - timerSecondDiff > 0) {
                    let timeStart = new Date();
                    this.timeOut = setTimeout(() => {
                        //console.log(`timer: ${this.state.timer} diff: ${timerSecondDiff}`);
                        if (data.phase === 2 && this.state.timer)
                            this.setState(Object.assign({}, this.state, {timer: this.state.timer - (new Date() - timeStart)}));
                    }, timerSecondDiff);
                }
            }
            if (this.state.dictMode && this.state.dictLength === 0) {
                actionText = null;
                statusText = "No more words, GG"
            }
            showWordsBet = false;
            return (
                <div className="game">
                    <div className={
                        "game-board"
                        + (this.state.inited ? " active" : "")
                        + (gameIsOver ? " game-over" : "")
                    }>
                        <div
                            title={`${this.state.dictInitLength - this.state.dictLength} of ${this.state.dictInitLength} completed`}
                            className={
                                "dict-progress"
                                + (this.state.dictMode ? " active" : "")
                            }
                        >
                            <div className="dict-progress-bar"
                                 style={{width: `${this.state.dictMode && (100 - Math.round((this.state.dictLength / this.state.dictInitLength) * 100))}%`}}/>
                        </div>
                        Teams:
                        <Teams data={this.state} handleTeamClick={id => this.handleTeamClick(id)}/>
                        <br/>
                        <div className={
                            "spectators-section"
                            + ((this.state.phase === 0 || this.state.spectators && this.state.spectators.length) ? " active" : "")
                        }>
                            Spectators:
                            <br/>
                            <Spectators data={this.state} handleSpectatorsClick={() => this.handleSpectatorsClick()}/>
                        </div>
                        <div className="control-pane">
                            <Timer data={this.state}/>
                            <Words data={this.state}
                                   handleChange={(id, value) => this.handleChangeWordPoints(id, value)}/>
                            <br/>
                            <div className="action-pane">
                                <div className="status-text">
                                    {statusText}
                                    <span className={
                                        "words-bet-label"
                                        + ((showWordsBet) ? " active" : "")
                                    }> Words: </span>
                                    <input
                                        className={
                                            "words-bet-input"
                                            + ((showWordsBet) ? " active" : "")
                                        }
                                        disabled={!(isTurn && this.state.phase === 1)}
                                        type="number" min="1" max="99" value={data.currentBet}
                                        onChange={(evt) => !isNaN(evt.target.valueAsNumber)
                                            && this.handleChangeBet(evt.target.valueAsNumber)}/>
                                </div>
                                <div onClick={() => this.handleAction()}
                                     className={
                                         "button-action"
                                         + (data.readyPlayers && ~data.readyPlayers.indexOf(data.userId) ? " pressed" : "")
                                         + (!!actionText ? " active" : "")
                                     }>{actionText}</div>
                            </div>
                        </div>
                        <div className="host-controls">
                            <div className="host-controls-menu" onClick={evt => this.handleHostAction(evt)}>
                                {isHost ? (
                                    <div>
                                        <div className="shuffle-players">Shuffle players</div>
                                        <div className="remove-player">Remove player</div>
                                        <div className="remove-offline">Remove offline</div>
                                        <div className="restart-round">Restart round</div>
                                        <div className="restart-game">Restart game</div>
                                        <div className="skip-player">Skip player</div>
                                        <div className="stop-timer">Stop timer</div>
                                        <div className="skip-turn">Skip turn</div>
                                        <div className="set-score">Set score</div>
                                        <div className="set-goal">Set goal</div>
                                        <div className="give-host">Give host</div>
                                        <div className="setup-words">Setup words</div>
                                        <div className="select-word-set">Select word set</div>
                                        <div className="set-round-time">Set round time</div>
                                        <div className="stop-game">Manage teams</div>
                                    </div>
                                ) : ""}
                                <div>
                                    <div className="change-name">Change name</div>
                                </div>
                            </div>
                            <i className="material-icons settings-button">settings</i>
                        </div>
                    </div>
                </div>
            );
        }
        else return (<div/>);
    }
}

ReactDOM.render(
    <Game/>,
    document.getElementById('root')
);
