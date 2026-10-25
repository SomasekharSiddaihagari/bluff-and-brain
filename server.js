const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const TOTAL_ROUNDS = 5;
const SUBMIT_SECONDS = 30;
const VOTE_SECONDS = 20;
const RECONNECT_GRACE_MS = 2 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'Bluff & Brain' }));

const QUESTIONS = [
  { q: 'What is the national animal of Scotland?', a: 'Unicorn', fact: 'The unicorn has been a Scottish heraldic symbol for centuries.' },
  { q: 'Which planet has the shortest day?', a: 'Jupiter', fact: 'Jupiter rotates once in about 10 hours.' },
  { q: 'What was the first feature-length animated film?', a: 'Snow White and the Seven Dwarfs', fact: 'Disney released it in 1937.' },
  { q: 'Which animal has three hearts?', a: 'Octopus', fact: 'Two hearts pump blood to the gills and one pumps it to the body.' },
  { q: 'What is the only mammal capable of true flight?', a: 'Bat', fact: 'Bats are the only mammals capable of sustained powered flight.' },
  { q: 'Which country invented paper?', a: 'China', fact: 'Paper-making was developed in China around 105 CE.' },
  { q: 'What is the largest desert on Earth?', a: 'Antarctic Desert', fact: 'Deserts are defined by low precipitation, not just heat.' },
  { q: 'How many bones does a shark have?', a: 'Zero', fact: 'A shark skeleton is made of cartilage rather than true bone.' },
  { q: 'Which fruit has its seeds on the outside?', a: 'Strawberry', fact: 'The tiny visible “seeds” are actually achenes on the fruit surface.' },
  { q: 'What is the smallest country in the world by area?', a: 'Vatican City', fact: 'Vatican City covers about 0.49 square kilometres.' },
  { q: 'Which bird can fly backwards?', a: 'Hummingbird', fact: 'Its rotating shoulder joints allow it to fly in reverse.' },
  { q: 'What is the hardest natural substance?', a: 'Diamond', fact: 'Diamond ranks 10 on the Mohs hardness scale.' },
  { q: 'Which sea creature has blue blood?', a: 'Horseshoe crab', fact: 'Its copper-based hemocyanin makes its blood blue.' },
  { q: 'What is the capital of Australia?', a: 'Canberra', fact: 'Canberra was selected as a compromise between Sydney and Melbourne.' },
  { q: 'Which metal is liquid at room temperature?', a: 'Mercury', fact: 'Mercury is liquid at typical room temperatures.' },
  { q: 'What is the longest bone in the human body?', a: 'Femur', fact: 'The femur is the thigh bone.' },
  { q: 'Which planet is known as the Red Planet?', a: 'Mars', fact: 'Iron oxide on its surface gives Mars its reddish colour.' },
  { q: 'What is the main ingredient in traditional hummus?', a: 'Chickpeas', fact: 'Traditional hummus combines chickpeas, tahini, lemon and garlic.' },
  { q: 'Which country is home to the ancient city of Petra?', a: 'Jordan', fact: 'Petra was a major Nabataean trading city.' },
  { q: 'How many sides does a dodecagon have?', a: 'Twelve', fact: 'A dodecagon is a twelve-sided polygon.' }
];
const rooms = new Map();
const timers = new Map();
const now = () => Date.now();
const cleanName = s => String(s || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
const cleanAnswer = s => String(s || '').trim().replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').slice(0, 100);
const randomCode = () => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out = ''; for (let i=0;i<5;i++) out += chars[crypto.randomInt(chars.length)]; return out; };
const token = () => crypto.randomBytes(24).toString('hex');
function stopTimer(room) { const t = timers.get(room.code); if (t) clearTimeout(t); timers.delete(room.code); }
function schedule(room, ms, fn) { stopTimer(room); timers.set(room.code, setTimeout(() => { timers.delete(room.code); fn(); }, ms)); }
function playerList(room) { return [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: !!p.socketId, isHost: p.id === room.hostId, submitted: !!room.submissions[p.id], voted: !!room.votes[p.id] })); }
function publicState(room, viewerId) {
  const base = { code: room.code, phase: room.phase, round: room.round, totalRounds: TOTAL_ROUNDS, players: playerList(room), hostId: room.hostId, viewerId, deadline: room.deadline || null, serverNow: now(), message: room.message || '' };
  if (room.phase === 'lobby') return base;
  const q = room.questions[room.round - 1];
  base.question = q.q;
  if (room.phase === 'submit') {
    base.mySubmitted = !!room.submissions[viewerId];
    base.submittedCount = Object.keys(room.submissions).length;
    base.requiredCount = room.players.size;
  }
  if (room.phase === 'vote') {
    base.mySubmitted = !!room.submissions[viewerId];
    base.myVoted = !!room.votes[viewerId];
    base.options = room.options.map(o => ({ id: o.id, text: o.text, own: o.ownerId === viewerId }));
    base.votedCount = Object.keys(room.votes).length;
    base.requiredCount = room.players.size;
  }
  if (room.phase === 'results' || room.phase === 'finished') {
    base.correctAnswer = q.a;
    base.fact = q.fact;
    base.options = room.options.map(o => ({ id: o.id, text: o.text, ownerId: o.ownerId, ownerName: o.ownerId ? room.players.get(o.ownerId)?.name || 'Player' : null, isCorrect: o.id === 'correct' }));
    base.roundScores = room.roundScores || [];
    base.lastRound = room.round;
  }
  return base;
}
function broadcast(room) {
  for (const p of room.players.values()) if (p.socketId) io.to(p.socketId).emit('state', publicState(room, p.id));
}
function phaseChange(room, phase, seconds) { room.phase = phase; room.deadline = seconds ? now() + seconds * 1000 : null; broadcast(room); }
function makeOptions(room) {
  const q = room.questions[room.round - 1];
  const options = [{ id: 'correct', text: q.a, ownerId: null }];
  for (const p of room.players.values()) {
    const answer = room.submissions[p.id];
    options.push({ id: `fake_${p.id}`, text: answer || 'I ran out of time!', ownerId: p.id });
  }
  for (let i = options.length - 1; i > 1; i--) { const j = 1 + crypto.randomInt(i); [options[i], options[j]] = [options[j], options[i]]; }
  room.options = options;
}
function beginVoting(room) {
  if (room.phase !== 'submit') return;
  for (const p of room.players.values()) if (!room.submissions[p.id]) room.submissions[p.id] = 'I ran out of time!';
  makeOptions(room); room.votes = {};
  phaseChange(room, 'vote', VOTE_SECONDS);
  schedule(room, VOTE_SECONDS * 1000, () => finishVoting(room));
}
function finishVoting(room) {
  if (room.phase !== 'vote') return;
  const tally = {};
  for (const [voterId, optionId] of Object.entries(room.votes)) {
    const option = room.options.find(o => o.id === optionId);
    if (!option) continue;
    if (option.id === 'correct') { const p = room.players.get(voterId); if (p) p.score += 1; }
    else if (option.ownerId && option.ownerId !== voterId) tally[option.ownerId] = (tally[option.ownerId] || 0) + 2;
  }
  for (const [pid, points] of Object.entries(tally)) { const p = room.players.get(pid); if (p) p.score += points; }
  room.roundScores = [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, gained: (room.votes[p.id] === 'correct' ? 1 : 0) + (tally[p.id] || 0) })).sort((a,b) => b.gained-a.gained || a.name.localeCompare(b.name));
  phaseChange(room, room.round >= TOTAL_ROUNDS ? 'finished' : 'results', null);
  if (room.phase === 'results') schedule(room, 8000, () => { if (room.phase === 'results') { room.round++; room.submissions = {}; room.votes = {}; room.options = []; startRound(room); } });
  else { room.winners = [...room.players.values()].filter(p => p.score === Math.max(...[...room.players.values()].map(x => x.score))).map(p => p.id); broadcast(room); }
}
function startRound(room) {
  room.submissions = {}; room.votes = {}; room.options = []; room.roundScores = [];
  phaseChange(room, 'submit', SUBMIT_SECONDS);
  schedule(room, SUBMIT_SECONDS * 1000, () => beginVoting(room));
}
function endIfTooFew(room) {
  if (room.phase !== 'lobby' && room.players.size < MIN_PLAYERS) {
    stopTimer(room); room.phase = 'lobby'; room.round = 0; room.deadline = null; room.message = 'Waiting for at least 2 players to reconnect.'; room.submissions = {}; room.votes = {}; room.options = []; broadcast(room);
  }
}
function getRoom(code) { return rooms.get(String(code || '').toUpperCase()); }
function attachPlayer(socket, room, player) { player.socketId = socket.id; player.disconnectedAt = null; socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.join(room.code); room.message = ''; broadcast(room); }

io.on('connection', socket => {
  socket.emit('hello', { maxPlayers: MAX_PLAYERS });
  socket.on('createRoom', ({ name } = {}, cb = () => {}) => {
    name = cleanName(name); if (!name) return cb({ ok:false, error:'Enter a nickname first.' });
    let code; do { code = randomCode(); } while (rooms.has(code));
    const id = token(); const p = { id, name, score:0, socketId:null, reconnectToken:token(), disconnectedAt:null };
    const room = { code, hostId:id, players:new Map([[id,p]]), phase:'lobby', round:0, questions:[], submissions:{}, votes:{}, options:[], deadline:null, message:'' };
    rooms.set(code, room); attachPlayer(socket, room, p); cb({ ok:true, code, playerId:id, reconnectToken:p.reconnectToken });
  });
  socket.on('joinRoom', ({ code, name } = {}, cb = () => {}) => {
    code = String(code || '').trim().toUpperCase(); name = cleanName(name); const room = getRoom(code);
    if (!room) return cb({ ok:false, error:'Room not found. Check the code and try again.' });
    if (!name) return cb({ ok:false, error:'Enter a nickname first.' });
    if (room.phase !== 'lobby') return cb({ ok:false, error:'This game has already started.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok:false, error:'This room is full (8 players maximum).' });
    if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return cb({ ok:false, error:'That nickname is already in use in this room.' });
    const id = token(); const p = { id, name, score:0, socketId:null, reconnectToken:token(), disconnectedAt:null };
    room.players.set(id,p); attachPlayer(socket,room,p); cb({ ok:true, code, playerId:id, reconnectToken:p.reconnectToken });
  });
  socket.on('reconnectPlayer', ({ code, playerId, reconnectToken } = {}, cb = () => {}) => {
    const room = getRoom(code); const p = room?.players.get(playerId);
    if (!room || !p || p.reconnectToken !== reconnectToken || (p.disconnectedAt && now()-p.disconnectedAt > RECONNECT_GRACE_MS)) return cb({ ok:false, error:'Your session could not be restored. Please rejoin the room.' });
    if (p.socketId && p.socketId !== socket.id) io.to(p.socketId).emit('sessionReplaced');
    attachPlayer(socket,room,p); cb({ ok:true, code:room.code, playerId:p.id, reconnectToken:p.reconnectToken });
  });
  socket.on('startGame', (_data, cb = () => {}) => {
    const room = getRoom(socket.data.roomCode); const p = room?.players.get(socket.data.playerId);
    if (!room || !p) return cb({ ok:false, error:'Join a room first.' });
    if (p.id !== room.hostId) return cb({ ok:false, error:'Only the host can start the game.' });
    if (room.phase !== 'lobby') return cb({ ok:false, error:'The game has already started.' });
    if (room.players.size < MIN_PLAYERS) return cb({ ok:false, error:'At least 2 players are required.' });
    room.questions = [...QUESTIONS].sort(() => Math.random() - .5).slice(0, TOTAL_ROUNDS);
    for (const player of room.players.values()) player.score = 0;
    room.round = 1; startRound(room); cb({ ok:true });
  });
  socket.on('submitFake', ({ answer } = {}, cb = () => {}) => {
    const room = getRoom(socket.data.roomCode); const pid = socket.data.playerId; const p = room?.players.get(pid);
    if (!room || !p || room.phase !== 'submit') return cb({ ok:false, error:'Answer submission is closed.' });
    if (room.submissions[pid]) return cb({ ok:false, error:'You have already submitted your bluff.' });
    answer = cleanAnswer(answer);
    if (answer.length < 2) return cb({ ok:false, error:'Your fake answer must have at least 2 characters.' });
    const correct = room.questions[room.round - 1].a.toLowerCase();
    if (answer.toLowerCase() === correct) return cb({ ok:false, error:'That is the real answer! Submit a believable fake instead.' });
    if (Object.values(room.submissions).some(a => a.toLowerCase() === answer.toLowerCase())) return cb({ ok:false, error:'Someone has already submitted that answer. Try a different bluff.' });
    room.submissions[pid] = answer; cb({ ok:true });
    if (Object.keys(room.submissions).length === room.players.size) { stopTimer(room); beginVoting(room); } else broadcast(room);
  });
  socket.on('castVote', ({ optionId } = {}, cb = () => {}) => {
    const room = getRoom(socket.data.roomCode); const pid = socket.data.playerId; const p = room?.players.get(pid);
    if (!room || !p || room.phase !== 'vote') return cb({ ok:false, error:'Voting is closed.' });
    if (room.votes[pid]) return cb({ ok:false, error:'Your vote has already been recorded.' });
    const option = room.options.find(o => o.id === optionId);
    if (!option) return cb({ ok:false, error:'That answer is not available.' });
    if (option.ownerId === pid) return cb({ ok:false, error:'You cannot vote for your own fake answer.' });
    room.votes[pid] = optionId; cb({ ok:true });
    if (Object.keys(room.votes).length === room.players.size) { stopTimer(room); finishVoting(room); } else broadcast(room);
  });
  socket.on('nextRound', (_data, cb = () => {}) => {
    const room = getRoom(socket.data.roomCode); const p = room?.players.get(socket.data.playerId);
    if (!room || !p) return cb({ ok:false, error:'Join a room first.' });
    if (p.id !== room.hostId) return cb({ ok:false, error:'Only the host can start the next round.' });
    if (room.phase !== 'results') return cb({ ok:false, error:'The next round is not ready.' });
    stopTimer(room); room.round++; startRound(room); cb({ ok:true });
  });
  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode); const p = room?.players.get(socket.data.playerId);
    if (!room || !p || p.socketId !== socket.id) return;
    p.socketId = null; p.disconnectedAt = now();
    if (p.id === room.hostId) {
      const next = [...room.players.values()].find(x => x.socketId);
      if (next) room.hostId = next.id;
    }
    broadcast(room);
    setTimeout(() => {
      const currentRoom = getRoom(room.code); const currentPlayer = currentRoom?.players.get(p.id);
      if (currentRoom && currentPlayer && !currentPlayer.socketId && currentPlayer.disconnectedAt && now()-currentPlayer.disconnectedAt >= RECONNECT_GRACE_MS) {
        currentRoom.players.delete(p.id);
        if (currentRoom.hostId === p.id) currentRoom.hostId = currentRoom.players.keys().next().value;
        if (currentRoom.players.size === 0) { stopTimer(currentRoom); rooms.delete(currentRoom.code); }
        else { endIfTooFew(currentRoom); broadcast(currentRoom); }
      }
    }, RECONNECT_GRACE_MS + 50);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Bluff & Brain running on http://localhost:${PORT}`));
