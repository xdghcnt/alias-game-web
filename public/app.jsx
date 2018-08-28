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
                        <div className="score">
                            {data.hostId === data.userId ?
                                (<i className="material-icons host-button change-score"
                                    title="Change"
                                    onClick={(evt) => this.props.handleSetScore(teamId, evt)}>
                                    edit
                                </i>) : ""}
                            Score: {data.teams[teamId].score}
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
                                    (player, index) => (<Player key={index} data={data} id={player}
                                                                handleRemovePlayer={this.props.handleRemovePlayer}
                                                                handleGiveHost={this.props.handleGiveHost}
                                                                handleSetTurn={this.props.handleSetTurn}/>)
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
                        (player, index) => (<Player key={index} data={data} id={player} spectator={true}
                                                    handleRemovePlayer={this.props.handleRemovePlayer}
                                                    handleGiveHost={this.props.handleGiveHost}
                                                    handleSetTurn={this.props.handleSetTurn}/>)
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
                {(data.hostId === data.userId) ? (
                    <div className="player-host-controls">
                        {!this.props.spectator ?
                            (<i className="material-icons host-button"
                                title="Give turn"
                                onClick={(evt) => this.props.handleSetTurn(id, evt)}>
                                reply
                            </i>) : ""}
                        {data.userId !== id ?
                            (<i className="material-icons host-button"
                                title="Give host"
                                onClick={(evt) => this.props.handleGiveHost(id, evt)}>
                                vpn_key
                            </i>) : ""}
                        {data.userId !== id ?
                            (<i className="material-icons host-button"
                                title="Remove"
                                onClick={(evt) => this.props.handleRemovePlayer(id, evt)}>
                                delete_forever
                            </i>) : ""}
                    </div>
                ) : ""}
            </div>
        );
    }
}

class Game extends React.Component {
    componentDidMount() {
        const initArgs = {};
        if (parseInt(localStorage.darkTheme))
            document.body.classList.add("dark-theme");
        if (!localStorage.userId || !localStorage.token) {
            while (!localStorage.userName)
                localStorage.userName = prompt("Your name");
            localStorage.userId = makeId();
            localStorage.token = makeId();
        }
        if (!location.hash)
            location.hash = makeId();
        initArgs.roomId = location.hash.substr(1);
        initArgs.userId = this.userId = localStorage.userId;
        initArgs.userName = localStorage.userName;
        initArgs.token = localStorage.token;
        this.socket = window.socket.of("alias");
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
        window.socket.on("disconnect", (event) => {
            this.setState({
                inited: false,
                disconnected: true,
                disconnectReason: event.reason
            });
        });
        this.socket.on("auth-required", () => {
            this.setState(Object.assign({}, this.state, {
                userId: this.userId,
                authRequired: true
            }));
            if (grecaptcha)
                grecaptcha.render("captcha-container", {
                    sitekey: "",
                    callback: (key) => this.socket.emit("auth", key, initArgs)
                });
            else
                setTimeout(() => window.location.reload(), 3000)
        });
        this.socket.on("reload", () => {
            setTimeout(() => window.location.reload(), 3000);
        });
        document.title = `Alias - ${initArgs.roomId}`;
        this.socket.emit("init", initArgs);
        this.timerSound = new Audio("/alias/beep.mp3");
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

    handleClickChangeName() {
        const name = prompt("New name");
        this.socket.emit("change-name", name);
        localStorage.userName = name;
    }

    handleClickShuffle() {
        this.socket.emit("shuffle-players");
    }

    handleClickLevel(level) {
        this.socket.emit("select-word-set", level);
    }

    handleClickCustom() {
        this.socket.emit("setup-words", prompt("URL to words separated by lines"));
    }

    handleClickRestart() {
        if (this.gameIsOver || confirm("Restart? Are you sure?"))
            this.socket.emit("restart-game");
    }

    handleToggleTheme() {
        localStorage.darkTheme = !parseInt(localStorage.darkTheme) ? 1 : 0;
        document.body.classList.toggle("dark-theme");
        this.setState(Object.assign({
            userId: this.userId,
            activeWord: this.state.activeWord
        }, this.state));
    }

    handleClickStop() {
        this.socket.emit("stop-game");
    }

    handleClickResume() {
        this.socket.emit("action");
    }

    handleRemovePlayer(id, evt) {
        evt.stopPropagation();
        if (confirm(`Removing ${this.state.playerNames[id]}?`))
            this.socket.emit("remove-player", id);
    }

    handleGiveHost(id, evt) {
        evt.stopPropagation();
        if (confirm(`Give host ${this.state.playerNames[id]}?`))
            this.socket.emit("give-host", id);
    }

    handleSetTurn(id, evt) {
        evt.stopPropagation();
        this.socket.emit("set-turn", id);
    }

    handleSetScore(id, evt) {
        evt.stopPropagation();
        this.socket.emit("set-score", {id: id, score: prompt("Score")});
    }

    handleChangeGoal(value) {
        this.socket.emit("set-goal", value);
    }

    handleChangeRoundTime(value) {
        this.socket.emit("set-round-time", value)
    }

    render() {
        clearTimeout(this.timeOut);
        if (this.state.disconnected)
            return (<div
                className="kicked">Disconnected{this.state.disconnectReason ? ` (${this.state.disconnectReason})` : ""}</div>);
        else if (this.state.inited) {
            document.body.classList.add("captcha-solved");
            const
                data = this.state,
                isHost = data.hostId === data.userId,
                isTurn = data.currentPlayer === data.userId,
                isTeamTurn = data.currentTeam && data.teams[data.currentTeam] && !!~data.teams[data.currentTeam].players.indexOf(data.userId),
                currentTeam = data.teams[data.currentTeam];
            let actionText, statusText,
                showWordsBet = false,
                gameIsOver,
                hasPlayers = data.phase !== 0;
            if (data.phase === 0) {
                hasPlayers = Object.keys(data.teams).length > 0 || Object.keys(data.teams).filter(teamId => data.teams[teamId].players.length > 1).length > 1;
                if (hasPlayers) {
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
                this.gameIsOver = gameIsOver;
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
            if (!gameIsOver) {
                if (this.state.dictMode && this.state.dictLength === 0) {
                    actionText = null;
                    statusText = "No more words, GG"
                } else if (data.wordsEnded) {
                    actionText = null;
                    statusText = `No more words`;
                }
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
                        <Teams data={this.state} handleTeamClick={id => this.handleTeamClick(id)}
                               handleRemovePlayer={(id, evt) => this.handleRemovePlayer(id, evt)}
                               handleGiveHost={(id, evt) => this.handleGiveHost(id, evt)}
                               handleSetScore={(id, evt) => this.handleSetScore(id, evt)}
                               handleSetTurn={(id, evt) => this.handleSetTurn(id, evt)}/>
                        <br/>
                        <div className={
                            "spectators-section"
                            + ((this.state.phase === 0 || this.state.spectators && this.state.spectators.length) ? " active" : "")
                        }>
                            Spectators:
                            <br/>
                            <Spectators data={this.state}
                                        handleSpectatorsClick={() => this.handleSpectatorsClick()}
                                        handleRemovePlayer={(id, evt) => this.handleRemovePlayer(id, evt)}
                                        handleGiveHost={(id, evt) => this.handleGiveHost(id, evt)}
                                        handleSetTurn={(id, evt) => this.handleSetTurn(id, evt)}/>
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
                            <div className="host-controls-menu">
                                <div>
                                    <div className="little-controls">
                                        <div className="game-settings">
                                            <div className="set-goal"><i title="goal"
                                                                         className="material-icons">flag</i>
                                                {(isHost && this.state.phase === 0) ? (<input id="goal"
                                                                                              type="number"
                                                                                              defaultValue="20" min="0"
                                                                                              onChange={evt => !isNaN(evt.target.valueAsNumber)
                                                                                                  && this.handleChangeGoal(evt.target.valueAsNumber)}
                                                />) : (<span className="value">{this.state.goal}</span>)}
                                            </div>
                                            <div className="set-round-time"><i title="time"
                                                                               className="material-icons">timer</i>
                                                {(isHost && this.state.phase === 0) ? (<input id="round-time"
                                                                                              type="number"
                                                                                              defaultValue="60" min="0"
                                                                                              onChange={evt => !isNaN(evt.target.valueAsNumber)
                                                                                                  && this.handleChangeRoundTime(evt.target.valueAsNumber)}
                                                />) : (<span className="value">{this.state.roundTime}</span>)}
                                            </div>
                                        </div>
                                        {(isHost && this.state.phase === 0) ? (
                                            <div className="shuffle-players settings-button"
                                                 onClick={() => this.handleClickShuffle()}>shuffle players<i
                                                className="material-icons">casino</i>
                                            </div>) : ""}
                                    </div>
                                    <div className="start-game-buttons">
                                        <div
                                            className={((isHost && this.state.phase === 0) ? " settings-button" : "") + (this.state.level === 1 ? " level-selected" : "")}
                                            onClick={() => this.handleClickLevel(1)}><i
                                            className="material-icons">pets</i>Easy
                                        </div>
                                        <div
                                            className={((isHost && this.state.phase === 0) ? " settings-button" : "") + (this.state.level === 2 ? " level-selected" : "")}
                                            onClick={() => this.handleClickLevel(2)}><i
                                            className="material-icons">child_friendly</i>Normal
                                        </div>
                                        <div
                                            className={((isHost && this.state.phase === 0) ? " settings-button" : "") + (this.state.level === 3 ? " level-selected" : "")}
                                            onClick={() => this.handleClickLevel(3)}><i
                                            className="material-icons">school</i>Hard
                                        </div>
                                    </div>
                                    <div
                                        className={"custom-game-button" +
                                        ((isHost && this.state.phase === 0) ? " settings-button" : "") + (this.state.level === 0 ? " level-selected" : "")}
                                        onClick={() => (isHost && this.state.phase === 0) && this.handleClickCustom()}>
                                        <i
                                            className="material-icons">accessible</i>Custom
                                    </div>
                                </div>
                            </div>
                            <div className="side-buttons">
                                {(isHost && hasPlayers && (data.phase === 0 || this.gameIsOver)) ?
                                    (<i onClick={() => this.handleClickRestart()}
                                        className="material-icons start-game settings-button">sync</i>) : ""}
                                {(isHost && hasPlayers) ? (data.phase === 0
                                    ? (<i onClick={() => this.handleClickResume()}
                                          className="material-icons start-game settings-button">play_arrow</i>)
                                    : (<i onClick={() => this.handleClickStop()}
                                          className="material-icons start-game settings-button">pause</i>)) : ""}
                                <i onClick={() => this.handleClickChangeName()}
                                   className="toggle-theme material-icons settings-button">edit</i>
                                {!parseInt(localStorage.darkTheme)
                                    ? (<i onClick={() => this.handleToggleTheme()}
                                          className="toggle-theme material-icons settings-button">brightness_2</i>)
                                    : (<i onClick={() => this.handleToggleTheme()}
                                          className="toggle-theme material-icons settings-button">wb_sunny</i>)}
                            </div>
                            <i className="material-icons">settings</i>
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
