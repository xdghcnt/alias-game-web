class Page extends React.Component {
    constructor() {
        super();
        this.state = {moderators: [], gameList: [], players: []}
    }

    componentDidMount() {
        void this.updateData();
    }

    setModeratorStatus(id, state) {
        const toggleModerator = async (key, discord) => {
            const result = (await (await fetch(
                `/alias/ranked/toggle-moderator?key=${key}&user=${id}&discord=${discord}`
            )).json());
            if (result.message)
                popup.alert({content: result.message});
            this.updateData();
        };
        popup.prompt({
            content: "Супермодераторский ключ"
        }, async (evt) => {
            if (evt.proceed) {
                const key = evt.input_value;
                if (state)
                    popup.prompt({
                        content: "Discord ID"
                    }, async (evt) => toggleModerator(key, evt.input_value));
                else
                    toggleModerator(key);
            }
        });
    }

    setRankedScore(id, currentScore) {
        popup.prompt({
            content: "Супермодераторский ключ"
        }, async (evt) => {
            if (evt.proceed) {
                const key = evt.input_value;
                popup.prompt({
                    content: "Рейтинг",
                    value: currentScore
                }, async (evt) => {
                    if (evt.proceed) {
                        const result = (await (await fetch(
                            `/alias/ranked/edit-score?key=${key}&user=${id}&score=${evt.input_value}`
                        )).json());
                        if (result.message)
                            popup.alert({content: result.message});
                        else
                            this.updateData();
                    }
                });
            }
        });
    }

    removeGame(datetime) {
        popup.prompt({
            content: "Супермодераторский ключ"
        }, async (evt) => {
            if (evt.proceed) {
                const key = evt.input_value;
                if (evt.proceed) {
                    const result = (await (await fetch(
                        `/alias/ranked/remove-game?key=${key}&datetime=${datetime}`
                    )).json());
                    if (result.message)
                        popup.alert({content: result.message});
                    else
                        this.updateData();
                }

            }
        });
    }

    async updateData() {
        const data = (await (await fetch('/alias/ranked/data')).json());
        data.rankedGames = data.rankedGames.filter(game => !game.deleted).reverse();
        const players = Object.keys(data.authUsers).map((userId) =>
            data.authUsers[userId]).sort((a, b) => b.score - a.score);
        for (const game of data.rankedGames) {
            game.playerScoresSorted = Object.keys(game.playerRanks).sort((a, b) => {
                return game.playerRanks[a] - game.playerRanks[b];
            });
        }
        this.setState({
            authUsers: data.authUsers,
            moderators: players.filter((user) => user.moderator).map((user) => ({
                name: user.name,
                discord: user.discord,
            })),
            gameList: data.rankedGames,
            players: players.map((player) => {
                let gamesCount = 0;
                let gamesCountWin = 0;
                let totalPoints = 0;
                for (const game of data.rankedGames) {
                    if (game.playerScores[player.id])
                        gamesCount++;
                    if (game.playerRanks[player.id] === 1)
                        gamesCountWin++;
                    else if (game.playerRanks[player.id] === 2)
                        gamesCountWin += 0.6;
                    totalPoints += (game.playerScores[player.id] || 0);
                }
                return {
                    inactive: gamesCount === 0 && player.score === 1000,
                    id: player.id,
                    name: player.name,
                    score: player.score,
                    moderator: player.moderator,
                    gamesCount,
                    winRate: gamesCount ? Math.round(gamesCountWin / gamesCount * 100) : 0,
                    averagePoints: gamesCount ? (totalPoints / gamesCount).toFixed(1) : 0
                };
            }).sort((a, b) => {
                if (a.inactive && !b.inactive)
                    return 1;
                else if (!a.inactive && b.inactive)
                    return -1;
                else
                    return 0;
            }),
        })
    }

    render() {
        const data = this.state;
        return (<div className="main">
            <div className="title">Модераторы</div>
            <div className="moderators section">
                {data.moderators.map((moderator, index) =>
                    (<><a className="moderator"
                          target="_blank" title="Контакт в Discord"
                          href={`https://discordapp.com/users/${moderator.discord}/`}>{moderator.name}</a>
                        {index !== data.moderators.length - 1 ? <span className="spacer"/> : ''}</>))}
            </div>
            <div className="title">Игроки</div>
            <div className="players section">
                {data.players.map((player, index) => (<div className={cs("player-row", {
                    inactive: player.inactive
                })}>
                    <div className="rank">{index + 1}</div>
                    <div className="name">{player.name}</div>
                    <div className="score">{player.score}</div>
                    <div className="stats">
                        <div className="games-count">
                            <span className="games">Игр: {player.gamesCount}</span>
                            &nbsp;|&nbsp;
                            <span className="wins">Побед: {player.winRate}%</span>
                        </div>
                        <div className="average-words">В среднем слов: {player.averagePoints}</div>
                    </div>
                    <div className="spacer"/>
                    <div className="button edit-score"
                         onClick={() => this.setRankedScore(player.id, player.score)}
                         title="Изменить рейтинг">
                        <i className="material-icons">edit</i>
                    </div>
                    <div className="button toggle-moderator"
                         onClick={() => this.setModeratorStatus(player.id, !player.moderator)}
                         title={!player.moderator ? 'Сделать модератором' : 'Сделать немодератором'}>
                        <i className="material-icons">{player.moderator ? 'key' : 'key_off'}</i>
                    </div>
                </div>))}
            </div>
            <div className="title">Матчи</div>
            <div className="matches section">
                {data.gameList.map((gameRow) => (
                    <div className="match">
                        <div
                            className="date">{(new Date(gameRow.datetime)).toLocaleDateString()} {(new Date(gameRow.datetime)).toLocaleTimeString()}
                            <i onClick={() => this.removeGame(gameRow.datetime)}
                               className="material-icons remove-game">delete_forever</i></div>
                        <div className="players">
                            {gameRow.playerScoresSorted.map((player) => (<div className="match-player">
                                <div
                                    className="player-name">{data.authUsers[player].name} {gameRow.moderator === player ? (
                                    <i className="material-icons host-button"
                                       title="Game host">
                                        stars
                                    </i>) : ""}</div>
                                <div className="player-score">
                                    <i className="material-icons host-button"
                                       title="Взято слов">
                                        font_download
                                    </i>&nbsp;{gameRow.playerScores[player]}</div>
                                <div className="player-diff">
                                    <i className="material-icons host-button"
                                       title="Изменение рейтинга">
                                        difference
                                    </i>&nbsp;{gameRow.rankedScoreDiffs[player]}</div>
                            </div>))}
                        </div>
                        <div className="skill-group">
                            Skill group: {gameRow.skillGroup}
                        </div>
                    </div>
                ))}
            </div>
        </div>);
    }
}

ReactDOM.render(
    <Page/>
    ,
    document.getElementById('root')
);
