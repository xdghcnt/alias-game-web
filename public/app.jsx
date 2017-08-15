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
        const data = this.props.data,
            handleTeamClick = this.props.handleTeamClick;
        return (
            <div
                className={
                    "team-list"
                    + (data.phase !== 0 ? " started" : " not-started")
                }>
                {data.teams && Object.keys(data.teams).filter(it => data.phase !== 0 ? data.teams[it].players.length : true).map((teamId, index) =>
                    (<div onClick={() => handleTeamClick(teamId)} className={
                        "team"
                        + (data.teams[teamId].players.length ? "" : " join")
                        + (data.currentTeam === teamId ? " current" : "")
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

class Words extends React.Component {
    render() {
        const data = this.props.data,
            handleChange = this.props.handleChange;
        return (
            <div className={
                "words"
                + (data.phase === 1 ? " counting" : "")
            }>
                {data.currentWords && data.currentWords.map((word, index) => (
                    <div className="word">{word.word}
                        <input
                            className={word.points > 0 ? "positive" : (word.points === 0 ? "" : "negative")}
                            type="number" value={word.points} min="-2" max="1"
                            onChange={evt => !isNaN(evt.target.valueAsNumber) && handleChange(index, evt.target.valueAsNumber)}/>
                    </div>
                ))}
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
        if (!window.localStorage.userId) {
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
            activeWord: this.activeWord
        }, state)));
        this.socket.on("active-word", word => {
            this.activeWord = word;
            this.setState(Object.assign({
                userId: this.userId,
                activeWord: this.activeWord
            }, this.state));
        });
        this.socket.emit("init", initArgs);
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
        else
            this.socket.emit(action);
    }

    render() {
        if (this.state.inited) {
            const
                data = this.state,
                isHost = data.hostId === data.userId,
                isTurn = data.currentPlayer === data.userId,
                isTeamTurn = data.currentTeam && !!~data.teams[data.currentTeam].players.indexOf(data.userId),
                currentTeam = data.teams[data.currentTeam];
            let actionText, statusText,
                showWordsBet = false;
            if (data.activeWord)
                data.currentWords.push({word: data.activeWord});
            if (data.phase === 0) {
                if (true || Object.keys(data.teams).filter(teamId => data.teams[teamId].players.length > 1).length > 1) {
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
                showWordsBet = true;
                if (isTurn && data.readyPlayers.length === currentTeam.players.length) {
                    actionText = "Start!";
                } else if (isTeamTurn) {
                    actionText = "Ready";
                    statusText = "Waiting for team.";
                }
                else
                    statusText = "Waiting for other team.";
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
            }

            return (
                <div className="game">
                    <div className={
                        "game-board"
                        + (this.state.inited ? " active" : "")
                    }>
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
                        <div className={
                            "host-controls"
                            + (isHost ? " active" : "")
                        }>
                            <div className="host-controls-menu" onClick={evt => this.handleHostAction(evt)}>
                                <div className="stop-game">Manage teams</div>
                                <div className="restart-round">Restart round</div>
                                <div className="remove-player">Remove player</div>
                                <div className="skip-player">Skip player</div>
                                <div className="skip-turn">Skip turn</div>
                                <div className="set-score">Set score</div>
                            </div>
                            <i className="material-icons settings-button">settings</i>
                        </div>
                    </div>
                </div>
            );
        }
        else return (<div></div>);
    }
}

ReactDOM.render(
    <Game/>,
    document.getElementById('root')
);
