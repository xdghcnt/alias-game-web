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
            game = this.props.game;
        if (data.phase === 0 && (!data.soloMode || Object.keys(data.teams).length === 0))
            data.teams["new"] = {
                players: [],
                score: 0
            };
        return (
            <div
                className={cs("team-list", {started: data.phase !== 0, "not-started": data.phase === 0})}>
                {data.teams && Object.keys(data.teams).map((teamId, index) =>
                    (<div onClick={() => game.handleTeamClick(teamId)} className={cs("team", {
                        join: !(teamId !== "new" || data.phase !== 0),
                        current: data.currentTeam === teamId,
                        "goal-reached": data.teams[teamId].score + (data.teams[teamId].wordPoints || 0) >= data.goal,
                        winner: data.teams[teamId].winner
                    })} key={index}>
                        {data.soloMode ? "" : (<div className="score" onTouchStart={(e) => e.target.focus()}>
                            {data.hostId === data.userId ?
                                (<i className="material-icons host-button change-score"
                                    title="Change"
                                    onClick={(evt) => game.handleSetScore(teamId, evt)}>
                                    edit
                                </i>) : ""}
                            Score: {data.teams[teamId].score}
                            <span className={cs("word-points", {
                                active: data.teams[teamId].wordPoints,
                                positive: data.teams[teamId].wordPoints > 0,
                                negative: data.teams[teamId].wordPoints < 0
                            })}>{Math.abs(data.teams[teamId].wordPoints)}</span>
                        </div>)}
                        <div className="players-container">
                            {
                                data.teams[teamId].players && data.teams[teamId].players.map(
                                    (player, index) => (<Player key={index} data={data} id={player} game={game}/>)
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
        const
            data = this.props.data,
            game = this.props.game;
        return (
            <div
                onClick={() => game.handleSpectatorsClick()}
                className={cs("spectators", data.phase !== 0 ? " started" : " not-started")}>
                {
                    data.spectators && data.spectators.map(
                        (player, index) => (<Player key={index} data={data} id={player} spectator={true} game={game}/>)
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
        const
            data = this.props.data,
            game = this.props.game;
        return (
            <div className={cs("words", data.phase === 1 ? " counting" : "")}>
                {data.currentWords && ((!(data.activeWord && data.phase === 2) ? data.currentWords : data.currentWords.concat([{
                    points: 1,
                    word: data.activeWord,
                    reported: data.activeWordReported
                }])).map((word, index) => (
                    <div className={cs("word", {reported: word.reported})}
                         onTouchStart={(e) => e.target.focus()}>&nbsp;{word.word}&nbsp;
                        <input
                            className={cs({positive: word.points > 0, negative: word.points < 0})}
                            type="number" value={word.points} min="-2" max="1"
                            onChange={evt => game.handleChangeWordPoints(index, evt.target.valueAsNumber)}
                        />
                        {(data.level !== 0 && (data.activeWord !== word.word || word.reported)) ? (
                            <div className="report-word-menu" onTouchStart={(e) => e.target.focus()}>
                                {!word.reported ? (<div className="report-word-list">
                                    {data.level !== 1 ? (<div
                                        className="settings-button"
                                        onClick={() => game.handleClickReportWordLevel(word.word, data.level, 1)}><i
                                        className="material-icons">pets</i> Easy ←
                                    </div>) : ""}
                                    {data.level !== 2 ? (<div
                                        className="settings-button"
                                        onClick={() => game.handleClickReportWordLevel(word.word, data.level, 2)}><i
                                        className="material-icons">child_friendly</i> Normal ←
                                    </div>) : ""}
                                    {data.level !== 3 ? (<div
                                        className="settings-button"
                                        onClick={() => game.handleClickReportWordLevel(word.word, data.level, 3)}><i
                                        className="material-icons">school</i> Hard ←
                                    </div>) : ""}
                                    {data.level !== 4 ? (<div
                                        className="settings-button"
                                        onClick={() => game.handleClickReportWordLevel(word.word, data.level, 4)}><i
                                        className="material-icons">whatshot</i> Insane ←
                                    </div>) : ""}
                                    <div
                                        className="settings-button"
                                        onClick={() => game.handleClickReportWordLevel(word.word, data.level, 0)}><i
                                        className="material-icons">delete_forever</i> Remove ←
                                    </div>
                                </div>) : ""}
                                <i className="material-icons"
                                   title={!word.reported ? "Report word" : "Reported"}>
                                    report_problem
                                </i>
                            </div>) : ""}
                    </div>
                )))}
            </div>
        );
    }
}

class Player extends React.Component {
    render() {
        const
            data = this.props.data,
            game = this.props.game,
            id = this.props.id,
            isHost = data.hostId === data.userId;
        return (
            <div className={cs("player", {
                ready: ~data.readyPlayers.indexOf(id),
                offline: !~data.onlinePlayers.indexOf(id),
                self: id === data.userId,
                current: id === data.currentPlayer,
                assistant: id === data.currentAssistant
            })} data-userId={id} onTouchStart={(e) => e.target.focus()}>
                {data.playerNames[id]}
                {data.soloMode && !this.props.spectator ? (
                    <span className="player-score">&nbsp;({data.playerScores[id] || 0}<span
                        className={cs("word-points", {
                            active: data.playerWordPoints[id],
                            positive: data.playerWordPoints[id] > 0,
                            negative: data.playerWordPoints[id] < 0
                        })}>{Math.abs(data.playerWordPoints[id])}</span>{data.hostId === data.userId ?
                        (<i className="material-icons host-button change-player-score"
                            title="Change"
                            onClick={(evt) => game.handleSetPlayerScore(id, evt)}>
                            edit
                        </i>) : ""})</span>) : ""}
                {(isHost || data.hostId === id) ? (
                    <div className="player-host-controls">
                        {isHost && !this.props.spectator && id !== data.currentPlayer && id !== data.currentAssistant ?
                            (<i className="material-icons host-button"
                                title="Give turn"
                                onClick={(evt) => game.handleSetTurn(id, evt)}>
                                reply
                            </i>) : ""}
                        {isHost && !this.props.spectator && data.soloMode && id !== data.currentPlayer && id !== data.currentAssistant ?
                            (<i className="material-icons host-button"
                                title="Set assistant"
                                onClick={(evt) => game.handleSetAssistant(id, evt)}>
                                reply_all
                            </i>) : ""}
                        {isHost && data.userId !== id ?
                            (<i className="material-icons host-button"
                                title="Give host"
                                onClick={(evt) => game.handleGiveHost(id, evt)}>
                                vpn_key
                            </i>) : ""}
                        {isHost && data.userId !== id ?
                            (<i className="material-icons host-button"
                                title="Remove"
                                onClick={(evt) => game.handleRemovePlayer(id, evt)}>
                                delete_forever
                            </i>) : ""}
                        {(data.hostId === id) ? (
                            <i className="material-icons host-button inactive"
                               title="Game host">
                                stars
                            </i>
                        ) : ""}
                    </div>
                ) : ""}
            </div>
        );
    }
}

class Game extends React.Component {
    componentDidMount() {
        const initArgs = {};
        if (parseInt(localStorage.darkThemeAlias))
            document.body.classList.add("dark-theme");
        if (!localStorage.aliasUserId || !localStorage.userToken) {
            while (!localStorage.userName)
                localStorage.userName = prompt("Your name");
            localStorage.aliasUserId = makeId();
            localStorage.userToken = makeId();
        }
        if (!location.hash)
            history.replaceState(undefined, undefined, "#" + makeId());
        if (localStorage.acceptDelete) {
            initArgs.acceptDelete = localStorage.acceptDelete;
            delete localStorage.acceptDelete;
        }
        initArgs.roomId = location.hash.substr(1);
        initArgs.userId = this.userId = localStorage.aliasUserId;
        initArgs.userName = localStorage.userName;
        initArgs.token = localStorage.userToken;
        this.socket = window.socket.of("alias");
        this.socket.on("state", (state) => {
            let initDrawMode;
            if (!this.state.drawMode && state.drawMode)
                initDrawMode = true;
            if (this.state && this.state.phase === 2 && state.phase !== 2 && this.reportListToShow.length)
                setTimeout(() => this.showReportNotify(), 1000);
            this.setState(Object.assign({
                userId: this.userId,
                activeWord: this.state.activeWord,
                activeWordReported: this.state.activeWordReported,
                wordReportData: this.state.wordReportData,
                wordReportNotify: this.state.wordReportNotify,
                notificationPinned: this.state.notificationPinned,
                wordAddCount: this.state.wordAddCount,
                wordCustomCount: this.state.wordCustomCount,
                wordAddLevel: this.state.wordAddLevel,
                wordReportSent: this.state.wordReportSent,
                wordPacks: this.state.wordPacks || {}
            }, state), () => {
                if (initDrawMode) this.initDrawMode();
            });
            if (!state.drawMode && this.sketcher)
                this.sketcher = null;
            if (this.sketcher) {
                this.sketcher.setActive(this.state.currentPlayer === this.state.userId);
                this.sketcher.updateState(state);
            }
        });
        this.socket.on("active-word", (data) => {
            this.setState(Object.assign({}, this.state, {
                activeWord: data && data.word,
                activeWordReported: data && data.reported
            }));
        });
        this.socket.on("word-reports-data", (reportData) => {
            let newWordsCount = 0;
            const wordSet = new Set();
            reportData.forEach((it) => {
                if (it.newWord && it.approved) newWordsCount += it.wordList.length;
                if (it.wordList)
                    it.wordList.forEach((word) => wordSet.add(word));
                else if (it.word && !(it.currentLevel === 1 && it.level === 0)) {
                    if (wordSet.has(it.word))
                        it.hasHistory = true;
                    else
                        wordSet.add(it.word);
                }
            });
            this.setState(Object.assign({}, this.state, {
                wordReportData: {
                    words: reportData.reverse().filter((it, index) => !it.processed || index < 250),
                    wordsFull: reportData,
                    total: reportData.length,
                    approved: reportData.filter((it) => it.approved).length,
                    processed: reportData.filter((it) => it.processed).length,
                    new: newWordsCount
                }
            }));
            this.reportData = reportData;
        });
        this.socket.on("timer-end", () => {
            this.timerSound.play();
        });
        this.socket.on("message", text => {
            popup.alert({content: text});
        });
        this.socket.on("word-reports-request-status", text => {
            this.setState(Object.assign({}, this.state, {
                wordReportSent: false
            }));
            popup.alert({content: text});
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
        this.socket.on("prompt-delete-prev-room", (roomList) => {
            if (localStorage.acceptDelete =
                prompt(`Limit for hosting rooms per IP was reached: ${roomList.join(", ")}. Delete one of rooms?`, roomList[0]))
                location.reload();
        });
        this.socket.on("reload", () => {
            setTimeout(() => window.location.reload(), 3000);
        });
        this.socket.on("word-report-notify", (reportList) => {
            this.reportListToShow = this.reportListToShow.concat(reportList);
            if (this.state.phase !== 2)
                this.showReportNotify();
        });
        this.socket.on("ping", (id) => {
            this.socket.emit("pong", id);
        });
        this.socket.on("highlight-user", (userId) => {
            const playerNode = document.querySelector(`[data-userId='${userId}']`);
            if (playerNode) {
                playerNode.classList.add("highlight-anim");
                setTimeout(() => playerNode && playerNode.classList.remove("highlight-anim"), 100);
            }
        });
        this.socket.on("words-pack", (data) => {
            if (data.index != null) {
                const wordReport = this.state.wordReportData.words[data.index];
                wordReport.wordList = data.wordList;
                wordReport.loading = false;
            } else
                this.state.wordPacks[data.packName] = data;
            this.setState(Object.assign({}, this.state));
        });
        this.socket.on("words-pack-list", (list) => {
            list.forEach((packName) => {
                this.state.wordPacks[packName] = this.state.wordPacks[packName] || null;
            });
            this.setState(Object.assign({}, this.state));
        });
        document.title = `Alias - ${initArgs.roomId}`;
        this.socket.emit("init", initArgs);
        this.timerSound = new Audio("/alias/beep.mp3");
        this.reportListToShow = [];
        window.addEventListener("resize", () => {
            if (this.sketcher)
                this.sketcher.reallign_width_parent_div();
        });
    }

    initDrawMode() {
        this.sketcher = new Sketcher(document.getElementById("draw-pane"), this.socket, this.state);
        this.sketcher.setInvert(!!parseInt(localStorage.darkThemeAlias));
        if (this.state.currentPlayer === this.state.userId)
            this.sketcher.setActive(true);
    }

    showReportNotify() {
        let
            newWordsCount = 0, newWordsCountDenied = 0,
            approvedList = this.reportListToShow.filter((it) => it.approved && !it.newWord && !it.custom && it.level !== 0);
        this.reportListToShow.forEach((it) => {
            if (it.newWord)
                if (it.approved)
                    newWordsCount += it.wordList.length;
                else
                    newWordsCountDenied += it.wordList.length;
        });
        this.setState(Object.assign({}, this.state, {
            wordReportNotify: {
                approved: approvedList,
                denied: this.reportListToShow.filter((it) => !it.approved && !it.newWord && !it.custom),
                added: newWordsCount,
                addDenied: newWordsCountDenied,
                deleted: this.reportListToShow.filter((it) => it.approved && it.level === 0),
                packsAdded: this.reportListToShow.filter((it) => it.custom && it.approved).length,
                packsDenied: this.reportListToShow.filter((it) => it.custom && !it.approved).length
            }
        }));
        document.getElementById("snackbar").classList.add("show");
        clearTimeout(this.wordReportNotifyTimeout);
        this.wordReportNotifyTimeout = setTimeout(() => {
            document.getElementById("snackbar").classList.remove("show");
        }, (approvedList.length * 1000) + 3000);
        this.reportListToShow = [];
    }

    debouncedEmit(event, data) {
        clearTimeout(this.debouncedEmitTimer);
        this.debouncedEmitTimer = setTimeout(() => {
            this.socket.emit(event, data);
        }, 100);
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
        popup.prompt({content: "New name", value: this.state.playerNames[this.state.userId] || ""}, (evt) => {
            if (evt.proceed && evt.input_value.trim()) {
                this.socket.emit("change-name", evt.input_value.trim());
                localStorage.userName = evt.input_value.trim();
            }
        });
    }

    handleClickShuffle() {
        this.socket.emit("shuffle-players");
    }

    handleClickLevel(level) {
        this.socket.emit("select-word-set", level);
    }

    handleClickCustom() {
        popup.prompt({content: "URL to words separated by lines"}, (evt) => evt.proceed && this.socket.emit("setup-words", evt.input_value));
    }

    handleClickRestart() {
        if (!this.gameIsOver)
            popup.confirm({content: "Restart? Are you sure?"}, (evt) => evt.proceed && this.socket.emit("restart-game"));
        else
            this.socket.emit("restart-game")
    }

    handleClickGetReports() {
        this.socket.emit("get-word-reports-data");
    }

    handleClickCloseReports() {
        this.setState(Object.assign({}, this.state, {
            wordReportData: null
        }));
    }

    handleClickShowPack(index) {
        const wordReport = this.state.wordReportData.words[index];
        if (!wordReport.wordList) {
            wordReport.loading = true;
            this.socket.emit("view-words-pack",
                wordReport.processed ? wordReport.packName : wordReport.datetime,
                index,
                !wordReport.processed);
        } else wordReport.wordList = null;
        this.setState(Object.assign({}, this.state));
    }

    handleClickCloseWordAdd() {
        this.setState(Object.assign({}, this.state, {
            wordAddCount: null,
            wordAddLevel: 2
        }));
    }

    handleClickSubmitNewWords() {
        const
            words = document.getElementById("word-add-area").value,
            wordsPackName = document.getElementById("word-add-pack-name").value;
        if (this.state.wordAddCount > 0
            && (this.state.wordAddCount <= (this.state.wordAddLevel === "custom" ? this.state.customWordsLimit : 50))) {
            this.socket.emit("add-words", words, this.state.wordAddLevel, wordsPackName);
            this.handleClickCloseWordAdd();
        }
    }

    handleWordAddChange(value) {
        this.setState(Object.assign({}, this.state, {
            wordAddCount: (value && value.split("\n").length) || 0
        }));
    }

    handleWordAddLevel(value) {
        this.setState(Object.assign({}, this.state, {
            wordAddLevel: value
        }));
    }

    handleClickOpenWordAdd() {
        this.setState(Object.assign({}, this.state, {
            wordAddCount: 0,
            wordAddLevel: 2
        }), () => {
            document.getElementById("word-add-pack-name").value = "";
            document.getElementById("word-add-area").value = "";
            document.getElementById("word-add-area").focus();
        });
    }

    handleClickShowAllReports() {
        this.state.wordReportData.words = this.state.wordReportData.wordsFull;
        this.setState(Object.assign({}, this.state));
    }

    handleClickSubmitReports() {
        const submitData = this.state.wordReportData.words.filter(
            (it) => !it.processed && it.approved !== null
        ).map((it) => ({datetime: it.datetime, approved: it.approved}));
        if (!this.state.wordReportSent && submitData.length) {
            this.socket.emit("apply-words-moderation", document.getElementById("word-moder-key").value, submitData);
            this.setState(Object.assign({}, this.state, {
                wordReportSent: true
            }));
        }
    }

    toggleNotificationPinned() {
        this.setState(Object.assign({}, this.state, {notificationPinned: !this.state.notificationPinned}));
    }

    handleWordReportApprove(index, state) {
        const wordData = this.state.wordReportData.words[index];
        if (wordData.approved == null || wordData.approved !== state)
            wordData.approved = state;
        else
            wordData.approved = null;
        this.setState(Object.assign({}, this.state, {
            wordReportData: this.state.wordReportData
        }));
    }

    handleToggleTheme() {
        localStorage.darkThemeAlias = !parseInt(localStorage.darkThemeAlias) ? 1 : 0;
        document.body.classList.toggle("dark-theme");
        this.setState(Object.assign({}, this.state));
        if (this.sketcher)
            this.sketcher.setInvert(!!parseInt(localStorage.darkThemeAlias));
    }

    handleClickStop() {
        this.socket.emit("stop-game");
    }

    handleClickResume() {
        this.socket.emit("action");
    }

    handleRemovePlayer(id, evt) {
        evt.stopPropagation();
        popup.confirm({content: `Removing ${this.state.playerNames[id]}?`}, (evt) => evt.proceed && this.socket.emit("remove-player", id));
    }

    handleGiveHost(id, evt) {
        evt.stopPropagation();
        popup.confirm({content: `Give host ${this.state.playerNames[id]}?`}, (evt) => evt.proceed && this.socket.emit("give-host", id));
    }

    handleSetTurn(id, evt) {
        evt.stopPropagation();
        this.socket.emit("set-turn", id);
    }

    handleSetAssistant(id, evt) {
        evt.stopPropagation();
        this.socket.emit("set-assistant", id);
    }

    handleSetScore(id, evt) {
        evt.stopPropagation();
        popup.prompt({
            content: "Score",
            value: this.state.teams[id].score
        }, (evt) => evt.proceed && this.socket.emit("set-score", {
            teamId: id,
            score: evt.input_value
        }));
    }

    handleSetPlayerScore(id, evt) {
        evt.stopPropagation();
        popup.prompt({
            content: "Score",
            value: this.state.playerScores[id] && this.state.playerScores[id].score || "0"
        }, (evt) => evt.proceed && this.socket.emit("set-player-score", {
            playerId: id,
            score: evt.input_value
        }));
    }

    handleChangeGoal(value) {
        this.socket.emit("set-goal", value);
    }

    handleChangeRoundTime(value) {
        this.socket.emit("set-round-time", value)
    }

    handleClickReportWordLevel(word, currentLevel, level) {
        this.socket.emit("report-word", word, currentLevel, level);
    }

    handleClickDrawClear(evt) {
        evt.stopPropagation();
        this.socket.emit("draw-clear");
    }

    handleClickToggleDrawMode(state) {
        this.socket.emit("toggle-draw-mode", state);
    }

    handleClickToggleSoloMode(state) {
        this.socket.emit("toggle-solo-mode", state);
    }

    handleClickCloseCustom() {
        this.setState(Object.assign({}, this.state, {
            customModalActive: false,
            customPackSelected: null
        }));
    }

    handleClickOpenCustom() {
        this.socket.emit("words-pack-list");
        this.setState(Object.assign({}, this.state, {
            customModalActive: true,
            wordCustomCount: 0
        }), () => {
            if (!name && document.getElementById("custom-word-area"))
                document.getElementById("custom-word-area").focus();
        });
    }

    handleSelectCustom(name) {
        if (name && !this.state.wordPacks[name])
            this.socket.emit("view-words-pack", name);
        this.setState(Object.assign({}, this.state, {
            customPackSelected: name
        }), () => {
            if (!name && document.getElementById("custom-word-area"))
                document.getElementById("custom-word-area").focus();
        });
    }

    handleCustomWordsChange(value) {
        this.setState(Object.assign({}, this.state, {
            wordCustomCount: (value && value.split("\n").length) || 0
        }));
    }

    handleClickSetCustomWords() {
        if (this.state.customPackSelected
            || (this.state.wordCustomCount > 0 && this.state.wordCustomCount <= this.state.customWordsLimit)) {
            if (this.state.customPackSelected)
                this.socket.emit("setup-words", this.state.customPackSelected, this.state.wordPacks[this.state.customPackSelected].wordList);
            else
                this.socket.emit("setup-words", document.getElementById("custom-words-pack-name").value, document.getElementById("custom-word-area").value.split("\n"));
            this.handleClickCloseCustom();
        }
    }

    toggleWordHistory(it) {
        if (it.wordHistory)
            it.wordHistory = null;
        else {
            it.wordHistory = [];
            this.reportData.forEach((report) => {
                if (!(report.currentLevel === 1 && report.level === 0))
                    if (it.datetime > report.datetime)
                        if (!report.wordList && report.word === it.word)
                            it.wordHistory.push(report);
                        else if (report.wordList && report.wordList.includes(it.word))
                            it.wordHistory.push({
                                ...report, word: it.word, wordList: undefined
                            })
            });
        }
        this.setState(this.state);
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
                isTeamTurn = !data.soloMode
                    ? data.currentTeam && data.teams[data.currentTeam] && !!~data.teams[data.currentTeam].players.indexOf(data.userId)
                    : data.currentPlayer === data.userId || data.currentAssistant === data.userId,
                currentTeam = data.teams[data.currentTeam],
                settingsMode = isHost && this.state.phase === 0,
                parentDir = location.pathname.match(/(.+?)\//)[1];
            let actionText, statusText,
                showWordsBet = false,
                gameIsOver,
                hasPlayers = data.phase !== 0;
            if (data.phase === 0) {
                const firstTeam = data.teams[Object.keys(data.teams)[0]];
                hasPlayers = firstTeam && (!data.soloMode ? firstTeam.players.length > 0 : firstTeam.players.length > 1);
                if (hasPlayers) {
                    if (isHost) {
                        statusText = "You can start the game";
                        actionText = "Start";
                    } else
                        statusText = "Host can start the game";
                } else
                    statusText = "Waiting for players";
            } else if (data.phase === 1) {
                if (data.soloModeRound >= data.soloModeGoal) {
                    gameIsOver = true;
                    const playerWin = Object.keys(data.playerScores).sort((idA, idB) =>
                        (data.playerScores[idB] + (data.playerWordPoints[idB] || 0)) - (data.playerScores[idA] + (data.playerWordPoints[idA] || 0)))[0];
                    statusText = `Player ${data.playerNames[playerWin]} wins!`;
                }
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
                        }),
                        teamsReachedGoalScores = teamsReachedGoal.map((teamId) => data.teams[teamId].score).sort((a, b) => b - a);
                    if (teamsReachedGoal.length > 0 && (teamsReachedGoal.length === 1 || teamsReachedGoalScores[0] !== teamsReachedGoalScores[1])) {
                        gameIsOver = true;
                        data.teams[mostPointsTeam].winner = true;
                        statusText = `Team ${Object.keys(data.teams).indexOf(mostPointsTeam) + 1} wins!`;
                    }
                }
                //showWordsBet = true;
                if (!gameIsOver) {
                    if (isTurn && (!data.soloMode ? data.readyPlayers.length === currentTeam.players.length : data.readyPlayers.length === 2)) {
                        actionText = "Start!";
                        statusText = "Prepare to explain things";
                    } else if (isTeamTurn) {
                        actionText = "Ready";
                        statusText = "Waiting for team.";
                    } else
                        statusText = "Waiting for other team.";
                }
                this.gameIsOver = gameIsOver;
            } else if (data.phase === 2) {
                if (isTurn) {
                    statusText = "Explain things!";
                    actionText = "Next";
                } else if (isTeamTurn)
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
                    <div className={cs("game-board", {
                        active: this.state.inited,
                        "game-over": gameIsOver,
                        "solo-mode": this.state.soloMode
                    })}>
                        <div
                            title={`${this.state.dictInitLength - this.state.dictLength} of ${this.state.dictInitLength} completed`}
                            className={cs("dict-progress", {active: this.state.dictMode})}
                        >
                            <div className="dict-progress-bar"
                                 style={{width: `${this.state.dictMode && (100 - Math.round((this.state.dictLength / this.state.dictInitLength) * 100))}%`}}/>
                        </div>
                        {data.drawMode ? (<div id="draw-pane">
                            <i className={cs("material-icons", "button-clear-draw", {active: data.currentPlayer === data.userId})}
                               onClick={(evt) => this.handleClickDrawClear(evt)}>delete_forever</i></div>) : ""}
                        {data.soloMode ? "Players" : "Teams"}:
                        <Teams data={this.state} game={this}/>
                        <br/>
                        <div className={cs(
                            "spectators-section", {active: this.state.phase === 0 || this.state.spectators && this.state.spectators.length})}>
                            Spectators:
                            <br/>
                            <Spectators data={this.state} game={this}/>
                        </div>
                        <div className="control-pane">
                            <Timer data={this.state}/>
                            <Words data={this.state}
                                   game={this}
                                   handleChange={(id, value) => this.handleChangeWordPoints(id, value)}/>
                            <br/>
                            <div className="action-pane">
                                <div className="status-text">
                                    {statusText}
                                    <span className={cs("words-bet-label", {active: showWordsBet})}> Words: </span>
                                    <input
                                        className={cs("words-bet-input", {active: showWordsBet})}
                                        disabled={!(isTurn && this.state.phase === 1)}
                                        type="number" min="1" max="99" value={data.currentBet}
                                        onChange={(evt) => !isNaN(evt.target.valueAsNumber)
                                            && this.handleChangeBet(evt.target.valueAsNumber)}/>
                                </div>
                                <div onClick={() => this.handleAction()}
                                     className={cs(
                                         "button-action", {
                                             pressed: data.readyPlayers && ~data.readyPlayers.indexOf(data.userId),
                                             active: !!actionText
                                         })
                                     }>{actionText}</div>
                            </div>
                        </div>
                        <div className="host-controls" onTouchStart={(e) => e.target.focus()}>
                            <div className="host-controls-menu">
                                <div>
                                    <div className="little-controls">
                                        <div className="game-settings">
                                            <div className="set-goal"><i title="goal"
                                                                         className="material-icons">flag</i>
                                                {settingsMode && this.state.soloMode ? `${this.state.soloModeRound}/` : ""}
                                                {settingsMode ? (<input id="goal"
                                                                        type="number"
                                                                        min="0"
                                                                        value={!this.state.soloMode
                                                                            ? this.state.goal
                                                                            : this.state.soloModeGoal}
                                                                        onChange={evt => this.handleChangeGoal(evt.target.valueAsNumber)}
                                                />) : (<span
                                                    className="value">{this.state.soloMode
                                                    ? `${this.state.soloModeRound}/${this.state.soloModeGoal}`
                                                    : this.state.goal}</span>)}
                                            </div>
                                            <div className="set-round-time"><i title="time"
                                                                               className="material-icons">timer</i>
                                                {(settingsMode) ? (<input id="round-time"
                                                                          type="number"
                                                                          value={this.state.roundTime}
                                                                          min="0"
                                                                          onChange={evt => this.handleChangeRoundTime(evt.target.valueAsNumber)}
                                                />) : (<span className="value">{this.state.roundTime}</span>)}
                                            </div>
                                        </div>
                                        <div className={cs("team-mode", {
                                            "settings-button": settingsMode,
                                            "level-selected": !this.state.soloMode
                                        })}
                                             onClick={() => this.handleClickToggleSoloMode(false)}>team
                                        </div>
                                        <div className={cs("team-mode", {
                                            "settings-button": settingsMode,
                                            "level-selected": this.state.soloMode
                                        })}
                                             onClick={() => this.handleClickToggleSoloMode(true)}>solo
                                        </div>
                                        {(settingsMode) ? (
                                            <div className="shuffle-players settings-button"
                                                 onClick={() => this.handleClickShuffle()}>shuffle players<i
                                                className="material-icons">casino</i>
                                            </div>) : ""}
                                    </div>
                                    <div className="draw-mode-buttons">
                                        <div
                                            className={cs({
                                                "settings-button": settingsMode,
                                                "level-selected": !data.drawMode
                                            })}
                                            onClick={() => this.handleClickToggleDrawMode(false)}><i
                                            className="material-icons">record_voice_over</i>Explain
                                        </div>
                                        <div
                                            className={cs({
                                                "settings-button": settingsMode,
                                                "level-selected": data.drawMode
                                            })}
                                            onClick={() => this.handleClickToggleDrawMode(true)}><i
                                            className="material-icons">gesture</i>Draw
                                        </div>
                                    </div>
                                    <div className="start-game-buttons">
                                        <div
                                            className={cs({
                                                "settings-button": settingsMode,
                                                "level-selected": data.level === 1
                                            })}
                                            onClick={() => this.handleClickLevel(1)}><i
                                            className="material-icons">pets</i>Easy
                                        </div>
                                        <div
                                            className={cs({
                                                "settings-button": settingsMode,
                                                "level-selected": this.state.level === 2
                                            })}
                                            onClick={() => this.handleClickLevel(2)}><i
                                            className="material-icons">child_friendly</i>Normal
                                        </div>
                                        <div
                                            className={cs({
                                                "settings-button": settingsMode,
                                                "level-selected": this.state.level === 3
                                            })}
                                            onClick={() => this.handleClickLevel(3)}><i
                                            className="material-icons">school</i>Hard
                                        </div>
                                        <div
                                            className={cs({
                                                "settings-button": settingsMode,
                                                "level-selected": this.state.level === 4
                                            })}
                                            onClick={() => this.handleClickLevel(4)}><i
                                            className="material-icons">whatshot</i>Insane
                                        </div>
                                    </div>
                                    <div
                                        className={cs("custom-game-button", {
                                            "settings-button": true,
                                            "level-selected": this.state.level === 0,
                                            "has-pack-name": this.state.packName
                                        })}
                                        onClick={() => this.handleClickOpenCustom()}>
                                        <i
                                            className="material-icons">accessible</i>Custom{this.state.packName
                                        ? `: ${this.state.packName}` : ""}
                                    </div>
                                </div>
                            </div>
                            <div className="side-buttons">
                                <i onClick={() => window.location = parentDir}
                                   className="material-icons exit settings-button">exit_to_app</i>
                                <i onClick={() => this.handleClickGetReports()}
                                   className="material-icons get-reports settings-button">assignment_late</i>
                                <i onClick={() => this.handleClickOpenWordAdd()}
                                   className="material-icons get-reports settings-button">add_box</i>
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
                                {!parseInt(localStorage.darkThemeAlias)
                                    ? (<i onClick={() => this.handleToggleTheme()}
                                          className="toggle-theme material-icons settings-button">brightness_2</i>)
                                    : (<i onClick={() => this.handleToggleTheme()}
                                          className="toggle-theme material-icons settings-button">wb_sunny</i>)}
                            </div>
                            <i className="material-icons">settings</i>
                        </div>
                        {data.wordReportData ? (<div className="word-report-modal">
                            <div className="word-report-modal-content">
                                <div className="word-report-title">Words moderation
                                    <div className="word-report-modal-stats">
                                        Total<span className="word-report-stat-num">{data.wordReportData.total}</span>
                                        Processed<span
                                        className="word-report-stat-num">{data.wordReportData.processed}</span>
                                        Approved<span
                                        className="word-report-stat-num">{data.wordReportData.approved}</span>
                                        New<span
                                        className="word-report-stat-num">{data.wordReportData.new}</span>
                                    </div>
                                    <div className="word-report-modal-close"
                                         onClick={() => this.handleClickCloseReports()}>✕
                                    </div>
                                </div>
                                <div className="word-report-list">{
                                    data.wordReportData.words.length ? (<div>
                                            {data.wordReportData.words.map((it, index) => (
                                                <div className={"word-report-item"}>
                                                    <div
                                                        className="word-report-item-name">{it.playerName}</div>
                                                    <div
                                                        className="word-report-item-word">{!it.custom
                                                        ? (!it.newWord
                                                            ? <span>{it.word}{it.hasHistory ?
                                                                <span> <i onClick={() => this.toggleWordHistory(it)}
                                                                          className="material-icons history-button">
                                                                    {!it.wordHistory ? "history" : "close"}
                                                                </i>
                                                                </span> : ""}</span>
                                                            : (<div className="word-report-item-word-list">
                                                                {it.wordList.map((word) => (<div>{word}</div>))}
                                                            </div>))
                                                        : (
                                                            <span>{it.packName}&nbsp;
                                                                {!(it.processed && !it.approved)
                                                                    ? (<span
                                                                        onClick={() => !it.loading && this.handleClickShowPack(index)}
                                                                        className={cs({"custom-view-link": !it.loading})}>
                                                                        ({it.loading ? "Loading" : (it.wordList ? "Hide" : "Show")})</span>)
                                                                    : ""}
                                                                {it.wordList
                                                                    ? (<div className="word-report-item-word-list">
                                                                        {it.wordList.map((word) => (<div>{word}</div>))}
                                                                    </div>)
                                                                    : ""}</span>)}</div>
                                                    <div
                                                        className="word-report-item-transfer">
                                                        {!it.newWord && !it.custom ? ["", "Easy", "Normal", "Hard", "Insane"][it.currentLevel] : "New"} → {
                                                        !it.custom ? ["Removed", "Easy", "Normal", "Hard", "Insane"][it.level] : "Custom"}
                                                    </div>
                                                    <div
                                                        className="word-report-item-status">
                                                        {it.processed ? (it.approved ? (
                                                            <span className="approved">Approved</span>) : (
                                                            <span className="denied">Denied</span>)) : (
                                                            <div className="word-report-approve-controls">
                                                                <input id={`word-report-approve-no-${index}`}
                                                                       type="checkbox"
                                                                       checked={it.approved === false}
                                                                       onChange={() => this.handleWordReportApprove(index, false)}/>
                                                                <label htmlFor={`word-report-approve-no-${index}`}
                                                                       className="word-report-approve no">✖</label>
                                                                <input id={`word-report-approve-yes-${index}`}
                                                                       type="checkbox" checked={it.approved}
                                                                       onChange={() => this.handleWordReportApprove(index, true)}/>
                                                                <label htmlFor={`word-report-approve-yes-${index}`}
                                                                       className="word-report-approve yes">✔</label>
                                                            </div>)}
                                                    </div>
                                                    {it.wordHistory ? <div className="word-history">
                                                        {it.wordHistory.map((it) => <div className="word-report-item">
                                                            <div className="word-report-item-name">{it.playerName}</div>
                                                            <div className="word-report-item-transfer">
                                                                {!it.newWord && !it.custom ? ["", "Easy", "Normal", "Hard", "Insane"][it.currentLevel] : "New"} → {
                                                                !it.custom ? ["Removed", "Easy", "Normal", "Hard", "Insane"][it.level] : "Custom"}
                                                            </div>
                                                            <div className="word-report-item-status">
                                                                {it.approved ? (
                                                                    <span className="approved">Approved</span>) : (
                                                                    <span className="denied">Denied</span>)}
                                                            </div>
                                                        </div>)}
                                                    </div> : ""}
                                                </div>))}{(data.wordReportData.wordsFull.length > data.wordReportData.words.length) ? (
                                            <div className="word-report-show-all"
                                                 onClick={() => this.handleClickShowAllReports()}>Show all</div>) : ""}
                                        </div>)
                                        : (<div className="word-report-no-data">No words reported yet</div>)
                                }</div>
                                <div className="word-report-manage-buttons">
                                    <input className="word-moder-key" id="word-moder-key" placeholder="Moder key"
                                           type="password"/>
                                    <div className={cs("word-report-save-button", {inactive: data.wordReportSent})}
                                         onClick={() => this.handleClickSubmitReports()}>Submit
                                    </div>
                                </div>
                            </div>
                        </div>) : ""}
                        {data.wordAddCount != null ? (<div className="word-report-modal">
                            <div className="word-report-modal-content add">
                                <div className="word-report-title">Add new words
                                    <div className="word-report-modal-close"
                                         onClick={() => this.handleClickCloseWordAdd()}>✕
                                    </div>
                                </div>
                                <input
                                    style={{display: data.wordAddLevel === "custom" ? "block" : "none"}}
                                    className="word-add-pack-name"
                                    maxLength="40"
                                    id="word-add-pack-name"
                                    placeholder="Pack name"
                                />
                                <textarea
                                    id="word-add-area"
                                    onChange={((event) => this.handleWordAddChange(event.target.value))}
                                    className="word-add-textarea"/>
                                <div className="word-report-manage-buttons">
                                    <div
                                        className="word-add-level-select">
                                        <span
                                            onClick={() => this.handleWordAddLevel(1)}
                                            className={cs("settings-button", {"level-selected": data.wordAddLevel === 1})}>Easy</span>
                                        <span
                                            onClick={() => this.handleWordAddLevel(2)}
                                            className={cs("settings-button", {"level-selected": data.wordAddLevel === 2})}>Normal</span>
                                        <span
                                            onClick={() => this.handleWordAddLevel(3)}
                                            className={cs("settings-button", {"level-selected": data.wordAddLevel === 3})}>Hard</span>
                                        <span
                                            onClick={() => this.handleWordAddLevel(4)}
                                            className={cs("settings-button", {"level-selected": data.wordAddLevel === 4})}>Insane</span>
                                        <span
                                            onClick={() => this.handleWordAddLevel("custom")}
                                            className={cs("settings-button", {"level-selected": data.wordAddLevel === "custom"})}>Custom</span>
                                    </div>
                                    <div
                                        className={cs("word-add-count", {
                                            overflow: data.wordAddCount > (data.wordAddLevel === "custom" ? data.customWordsLimit : 50)
                                        })}>{data.wordAddCount}/{data.wordAddLevel === "custom" ? data.customWordsLimit : 50}
                                    </div>
                                    <div
                                        className={cs("word-report-save-button", {
                                            inactive:
                                                !(data.wordAddCount > 0 && data.wordAddCount <= (data.wordAddLevel === "custom" ? data.customWordsLimit : 50))
                                        })}
                                        onClick={() => this.handleClickSubmitNewWords()}>Submit
                                    </div>
                                </div>
                            </div>
                        </div>) : ""}
                        {data.customModalActive ? (<div className="word-report-modal custom">
                            <div className="word-report-modal-content custom">
                                <div className="word-report-title">Custom word packs
                                    {data.wordPacks[data.customPackSelected] ? (
                                        <div className="word-report-modal-stats">
                                            Words<span
                                            className="word-report-stat-num">{data.wordPacks[data.customPackSelected].wordList.length}</span>
                                            Author<span
                                            className="word-report-stat-num">{data.wordPacks[data.customPackSelected].author}</span>
                                        </div>) : ""}
                                    {settingsMode && !data.wordPacks[data.customPackSelected] ? (
                                        <input
                                            className="custom-words-pack-name"
                                            maxLength="40"
                                            id="custom-words-pack-name"
                                            placeholder="Pack name"
                                        />) : ""}
                                    <div className="word-report-modal-close"
                                         onClick={() => this.handleClickCloseCustom()}>✕
                                    </div>
                                </div>
                                <div className="custom-packs">
                                    <div className="custom-pack-list">
                                        {settingsMode ? (
                                            <div
                                                onClick={() => this.handleSelectCustom()}
                                                className={cs("custom-pack-list-item", {selected: data.customPackSelected == null})}>
                                                &lt;Custom&gt;</div>) : ""}
                                        {Object.keys(data.wordPacks).map((name) => (
                                            <div onClick={() => this.handleSelectCustom(name)}
                                                 className={cs("custom-pack-list-item", {selected: data.customPackSelected === name})}>
                                                {name}</div>))}
                                    </div>
                                    <div className="custom-pack-pane">
                                        {(settingsMode && data.customPackSelected == null)
                                            ? (<textarea
                                                id="custom-word-area"
                                                onChange={((event) => this.handleCustomWordsChange(event.target.value))}
                                                className="custom-word-textarea"/>)
                                            : data.customPackSelected != null
                                                ? (<div className="custom-pack-word-list">
                                                    {data.wordPacks[data.customPackSelected] != null
                                                        ? data.wordPacks[data.customPackSelected].wordList.map((word) => (
                                                            <div className="custom-pack-word-list-item">{word}</div>))
                                                        : "Loading"}
                                                </div>) : ""}
                                    </div>
                                </div>
                                <div className="word-report-manage-buttons">
                                    {settingsMode && data.customPackSelected == null ? (<div
                                        className={cs("word-add-count", {
                                            overflow: data.wordCustomCount > data.customWordsLimit
                                        })}>{data.wordCustomCount}/{data.customWordsLimit}
                                    </div>) : ""}
                                    {settingsMode ? <div
                                        className={cs("word-report-save-button", {
                                            inactive: !(data.customPackSelected != null
                                                || (data.wordCustomCount > 0
                                                    && data.wordCustomCount <= data.customWordsLimit))
                                        })}
                                        onClick={() => this.handleClickSetCustomWords()}>Select
                                    </div> : ""}
                                </div>
                            </div>
                        </div>) : ""}
                        <div id="snackbar" className={cs({pinned: this.state.notificationPinned})}>
                            {data.wordReportNotify ? (<div>
                                {data.wordReportNotify.approved.length ? (<div>
                                    Word reports approved
                                    <i onClick={() => this.toggleNotificationPinned()}
                                       className="material-icons pin-notification-button">attach_file</i>
                                    <div className="word-report-notify-list">
                                        {data.wordReportNotify.approved.map((it) => (<div
                                            className="word-report-notify-item">
                                            {it.word} <span className="word-report-notify-transfer">
                                        ({["", "Easy", "Normal", "Hard", "Insane"][it.currentLevel]} → {["Removed", "Easy", "Normal", "Hard", "Insane"][it.level]})
                                    </span></div>))}
                                    </div>
                                </div>) : ""}
                                {data.wordReportNotify.denied.length ? (<div>
                                    {data.wordReportNotify.approved.length ? "And " : ""} {data.wordReportNotify.denied.length}
                                    {data.wordReportNotify.approved.length ? "" : " word"} report{data.wordReportNotify.denied.length > 1 ? "s" : ""} denied
                                </div>) : ""}
                                {data.wordReportNotify.added ? (<div>
                                    {data.wordReportNotify.approved.length || data.wordReportNotify.denied.length ? "Also " : ""}{data.wordReportNotify.added} new
                                    word{data.wordReportNotify.added > 1 ? "s" : ""} added
                                </div>) : ""}
                                {data.wordReportNotify.addDenied ? (<div>
                                    {data.wordReportNotify.added
                                    || data.wordReportNotify.approved.length
                                    || data.wordReportNotify.denied.length ? "Also " : ""}{data.wordReportNotify.addDenied} new
                                    word{data.wordReportNotify.addDenied > 1 ? "s" : ""} declined
                                </div>) : ""}
                                {data.wordReportNotify.deleted.length ? (<div>
                                    {data.wordReportNotify.added
                                    || data.wordReportNotify.approved.length
                                    || data.wordReportNotify.denied.length
                                    || data.wordReportNotify.addDenied ? "Also " : ""}
                                    {data.wordReportNotify.deleted.length} word{data.wordReportNotify.deleted.length > 1 ? "s" : ""} deleted
                                </div>) : ""}
                                {data.wordReportNotify.packsAdded ? (<div>
                                    {data.wordReportNotify.added
                                    || data.wordReportNotify.approved.length
                                    || data.wordReportNotify.denied.length
                                    || data.wordReportNotify.addDenied
                                    || data.wordReportNotify.deleted.length ? "Also " : ""}
                                    {data.wordReportNotify.packsAdded} custom words
                                    pack{data.wordReportNotify.packsAdded > 1 ? "s" : ""} added
                                </div>) : ""}
                                {data.wordReportNotify.packsDenied ? (<div>
                                    {data.wordReportNotify.added
                                    || data.wordReportNotify.approved.length
                                    || data.wordReportNotify.denied.length
                                    || data.wordReportNotify.addDenied
                                    || data.wordReportNotify.deleted.length
                                    || data.wordReportNotify.packsAdded ? "Also " : ""}
                                    {data.wordReportNotify.packsDenied} custom words
                                    pack{data.wordReportNotify.packsDenied > 1 ? "s" : ""} denied
                                </div>) : ""}
                            </div>) : ""}
                        </div>
                    </div>
                </div>
            );
        } else return (
            <div/>
        );
    }
}

ReactDOM.render(
    <Game/>,
    document.getElementById('root')
);
