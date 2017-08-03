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
                        <div className="score">Score: {data.teams[teamId].score}</div>
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
            handleSpectatorsClick = this.props.handleSpectatorsClick
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
                + (data.phase === 3 ? " counting" : "")
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
        this.socket.on("state", state => this.setState(Object.assign({userId: this.userId}, state)));
        this.socket.emit("init", initArgs);
    }

    constructor() {
        super();
        this.state = {
            inited: false
        };
    }

    handleSpectatorsClick() {
        this.socket.emit("spectators-join");
    }

    handleTeamClick(id) {
        this.socket.emit("team-join", id);
    }

    handleAction() {
        this.socket.emit("action");
    }

    handleChangeWordPoints(id, value) {
        if (value > -2 && value < 2) {
            this.state.currentWords[id].points = value;
            this.setState(Object.assign(this.state, {currentWords: this.state.currentWords}))
        }
    }

    handleChangeBet(value) {
        this.setState(Object.assign(this.state, {currentBet: value}))
    }

    render() {
        const
            data = this.state,
            isHost = data.hostId === data.userId,
            isTurn = data.currentPlayer === data.userId;
        let actionText, statusText;
        if (data.phase === 0 && isHost)
            actionText = "Start";
        else if (data.phase === 1) {
            statusText = "Waiting for team";
            actionText = "Ready";
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
                        <div className="control-pane">
                            <Words data={this.state}
                                   handleChange={(id, value) => this.handleChangeWordPoints(id, value)}/>
                            <br/>
                            <div className="action-pane">
                                <div className="status-text">
                                    {statusText}
                                    <input
                                        className={
                                            "words-bet-input"
                                            + ((data.phase === 1 || data.phase === 2) ? " active" : "")
                                        }
                                        disabled={!isTurn || data.phase !== 1}
                                        type="number" min="0" max="99" value={data.currentBet}
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
                            <div className="button-stop-game">Manage teams</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ReactDOM.render(
    <Game/>,
    document.getElementById('root')
);
