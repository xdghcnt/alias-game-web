const
    wsServer = new (require("ws-server-engine"))(),
    game = require("./module");
game(wsServer.app, wsServer.users.of("alias"));