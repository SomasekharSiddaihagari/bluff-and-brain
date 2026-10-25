# Bluff & Brain

A real-time, room-code multiplayer trivia/bluffing game for 2–8 players. No accounts or logins. The server is authoritative for game phases, timers, vote validation, and scoring.

## Requirements
- Node.js 18 or newer
- Internet access for the first install (`npm install` downloads Express and Socket.IO)

## Run locally
```bash
npm install
npm start
```
Open **http://localhost:3000**.

### Test with two players in separate browser windows
1. Open `http://localhost:3000` in one browser window. Enter a nickname and select **Create room**.
2. Copy the five-character room code.
3. Open a second window (an incognito/private window is useful) at `http://localhost:3000`. Enter a different nickname and the room code, then select **Join game**.
4. In the host window, select **Start game**.
5. Both players submit different fake answers within 30 seconds. When everyone has submitted, voting starts automatically (or starts when the 30-second timer expires).
6. Both players vote for an answer other than their own fake. Voting closes when everyone votes or after 20 seconds. The server reveals the correct answer and updates scores.
7. Repeat for five rounds. The highest score wins; tied leaders share the win.

## Test on separate devices on the same Wi-Fi
Run the server on a computer, find its LAN IP address, and open `http://YOUR-LAN-IP:3000` on both devices. Allow incoming connections to port 3000 in the computer firewall if necessary. This is local-network testing, not internet hosting.

## Host over the internet
Deploy this Node.js project to a public Node hosting provider that supports persistent WebSocket connections. Use `npm install` / `npm start` (or its equivalent), set `PORT` if required, and share the provider's HTTPS URL. The server must remain running for room state to exist. This starter keeps rooms in memory; restarting the server clears active games. For multiple server instances, add a shared Socket.IO adapter and persistent room store before scaling horizontally.

## Game rules implemented
- 5 rounds, 2–8 players
- Host starts the game; only host can manually start the next round
- 30 seconds for bluff submissions, 20 seconds for voting
- Everyone submits one fake answer; late/missing submissions receive a server-generated placeholder
- +1 for voting for the correct answer; +2 for each vote received by a player's fake answer
- Players cannot vote for their own fake
- Votes and correct answer are hidden until the reveal
- Tied final leaders share the win
- Reconnection token retained in browser local storage; disconnected players have a two-minute grace period

## Important limitation
The game is built for a single Node server process. It is playable across the public internet only after deployment to a reachable host. The local URL is not automatically public.
