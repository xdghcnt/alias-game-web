const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const modulePath = path.resolve(__dirname,'../module.js');
const handlers = new Map(); let GameState;
const fakeFs = {
    readFileSync(p) { return JSON.stringify(p.endsWith('moderated-words.json') ? {1:['easy'],2:['normal'],3:['hard'],5:['nometa']} : {}); },
    readdir(p, cb) { queueMicrotask(()=>cb(null,['изи+ (Биатлон).json'])); },
    readFile(p,options,cb) { if(typeof options==='function') cb=options; queueMicrotask(()=>cb(null,p.endsWith('изи+ (Биатлон).json') ? JSON.stringify({wordList:['биатлон']}):'')); },
    mkdir(p,cb) {queueMicrotask(()=>cb(null));},
    writeFile(p,data,cb) {if(cb) queueMicrotask(()=>cb(null));},
    appendFile(p,data,cb) {if(cb) queueMicrotask(()=>cb(null));},
};
const sandbox = {module:{exports:{}},require:name=>name==='fs'?fakeFs:require(name),__dirname:path.dirname(modulePath),console,Date,Math,Set,Map,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},Buffer};
vm.runInNewContext(fs.readFileSync(modulePath,'utf8'),sandbox,{filename:modulePath});
const registry={config:{appDir:'/fixture',customWordsLimit:100},games:{alias:{id:'alias'}},handleAppPage(){},createRoomManager(p,C){GameState=C;},RoomState:class {constructor(id,data){this.room={roomId:data.roomId,authUsers:{},voiceEnabled:false};this.eventHandlers={};}},authUsers:{getByDiscordId:async()=>null,getUserId:id=>id},log(){}};
sandbox.module.exports({app:{get(p,h){handlers.set(p,h)},use(){}},users:registry,static:()=>()=>{}},'/bg/alias','',null);
test('Tournament rooms load the biathlon pack and snapshot at eight turns, preserving other formats',async()=>{
    await new Promise(setImmediate);
    for(const [name,rounds,team] of [['turik-biathlon-normal-1А-'+encodeURIComponent('изи+ (Биатлон)'),8,true],['turik-team-chain-hard-1А',4,true],['turik-swiss-normal-1А',4,true],['turik-solo-easy-1А',4,false],['turik-1А',4,false]]) {
        const state=new GameState('host',{roomId:name},{send(){}},registry);await new Promise(setImmediate);
        const room=state.room;assert.equal(room.soloMode,!team);assert.equal(room.turikStageRounds,rounds);
        if(rounds===8) {assert.equal(room.packName,'изи+ (Биатлон)');assert.deepEqual([...state.state.roomWordsList],['биатлон']);}
        if(!team) continue;
        room.teams={a:{score:10,players:new Set(['host','other']),currentPlayer:'host'},b:{score:5,players:new Set(['third','fourth'])}};
        room.currentTeam='a';room.currentPlayer='host';room.phase=1;room.teamRound=4;room.readyPlayers=new Set(['host','other']);
        state.eventHandlers.action('host');
        if(rounds===8 || room.turikLiveScore) assert.equal(room.teamStageScores,null);else assert.equal(room.teamStageScores.a,10);
        if(rounds===8) {
            room.phase=1;room.teamRound=8;room.readyPlayers=new Set(['host','other']);room.teams.a.score=20;
            state.eventHandlers.action('host');assert.equal(room.teamStageScores.a,20);assert.equal(room.teamStageScores.b,5);
        }
    }
});
