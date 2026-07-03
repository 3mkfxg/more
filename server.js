const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to local file-based SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'game.db'));

// Database Query Wrappers (Promisified)
const dbRun = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGet = (query, params = []) => new Promise((resolve, reject) => {
  db.get(query, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (query, params = []) => new Promise((resolve, reject) => {
  db.all(query, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

// Run DB Schemas/Migrations on Startup
async function initDb() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_code TEXT PRIMARY KEY,
        player1_name TEXT NOT NULL,
        player2_name TEXT,
        status TEXT NOT NULL DEFAULT 'waiting',
        active_game TEXT NOT NULL DEFAULT 'hub',
        game_a_context INTEGER DEFAULT 0,
        game_b_question INTEGER DEFAULT 0
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS coloring_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        player_name TEXT NOT NULL,
        body_part TEXT NOT NULL,
        color_value TEXT NOT NULL,
        context_id INTEGER NOT NULL,
        UNIQUE(room_code, player_name, body_part, context_id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS ask_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        player_name TEXT NOT NULL,
        question_id INTEGER NOT NULL,
        response_text TEXT NOT NULL,
        UNIQUE(room_code, player_name, question_id)
      )
    `);
    
    console.log("SQLite schema migrations executed successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}
initDb();

// Helper to generate 5-character alphanumeric room codes
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNOPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

// Create a Room (Host)
app.post('/api/room/create', async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  try {
    let roomCode = generateRoomCode();
    // Verify room code is unique
    let check = await dbGet("SELECT room_code FROM rooms WHERE room_code = ?", [roomCode]);
    while (check) {
      roomCode = generateRoomCode();
      check = await dbGet("SELECT room_code FROM rooms WHERE room_code = ?", [roomCode]);
    }

    await dbRun(
      "INSERT INTO rooms (room_code, player1_name, status) VALUES (?, ?, 'waiting')",
      [roomCode, username]
    );

    res.json({ roomCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create room." });
  }
});

// Join a Room (Peer)
app.post('/api/room/join', async (req, res) => {
  const { username, roomCode } = req.body;
  if (!username || !roomCode) {
    return res.status(400).json({ error: "Username and Room Code are required." });
  }

  const upperCode = roomCode.toUpperCase();

  try {
    const room = await dbGet("SELECT * FROM rooms WHERE room_code = ?", [upperCode]);
    if (!room) {
      return res.status(404).json({ error: "Room not found." });
    }
    if (room.player2_name) {
      if (room.player2_name === username) {
        // Reconnecting as the same username
        return res.json({ success: true });
      }
      return res.status(400).json({ error: "Room is already full." });
    }
    if (room.player1_name === username) {
      return res.status(400).json({ error: "Cannot join your own room with the same username." });
    }

    await dbRun(
      "UPDATE rooms SET player2_name = ?, status = 'active' WHERE room_code = ?",
      [username, upperCode]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to join room." });
  }
});

// Get Room Synchronization Status (Polling Endpoint)
app.get('/api/room/status/:code', async (req, res) => {
  const { code } = req.params;
  const upperCode = code.toUpperCase();

  try {
    const room = await dbGet("SELECT * FROM rooms WHERE room_code = ?", [upperCode]);
    if (!room) {
      return res.status(404).json({ error: "Room not found." });
    }

    const response = {
      roomCode: room.room_code,
      player1: room.player1_name,
      player2: room.player2_name,
      status: room.status,
      activeGame: room.active_game,
      gameAContext: room.game_a_context,
      gameBQuestion: room.game_b_question,
      gameASubmissions: { p1: false, p2: false, p1Paints: {}, p2Paints: {} },
      gameBSubmissions: { p1: false, p2: false, p1Answer: "", p2Answer: "" }
    };

    // 1. Resolve Minigame A (Coloring) data if inside game-a
    if (room.active_game === 'game-a') {
      const responses = await dbAll(
        "SELECT player_name, body_part, color_value FROM coloring_responses WHERE room_code = ? AND context_id = ?",
        [upperCode, room.game_a_context]
      );
      
      const p1Name = room.player1_name;
      const p2Name = room.player2_name;

      responses.forEach(r => {
        if (r.player_name === p1Name) {
          response.gameASubmissions.p1Paints[r.body_part] = r.color_value;
          response.gameASubmissions.p1 = true; // submitted
        } else if (r.player_name === p2Name) {
          response.gameASubmissions.p2Paints[r.body_part] = r.color_value;
          response.gameASubmissions.p2 = true; // submitted
        }
      });
      
      // If we don't have responses yet, check if they explicitly submitted an empty map
      // (Wait, we can verify by querying if they have AT LEAST ONE entry or a dummy entry.
      // To check if they submitted a configuration, we can inspect a dummy part like 'submitted_flag' or simply check if their username exists in coloring_responses for this context. We will record a dummy 'submitted' body_part = '_status' with color 'submitted' when they submit, allowing them to submit empty profiles.)
      const submissions = await dbAll(
        "SELECT DISTINCT player_name FROM coloring_responses WHERE room_code = ? AND context_id = ? AND body_part = '_status'",
        [upperCode, room.game_a_context]
      );
      submissions.forEach(s => {
        if (s.player_name === p1Name) response.gameASubmissions.p1 = true;
        if (s.player_name === p2Name) response.gameASubmissions.p2 = true;
      });
    }

    // 2. Resolve Minigame B (Ask & Reveal) data if inside game-b
    if (room.active_game === 'game-b') {
      const answers = await dbAll(
        "SELECT player_name, response_text FROM ask_responses WHERE room_code = ? AND question_id = ?",
        [upperCode, room.game_b_question]
      );

      const p1Name = room.player1_name;
      const p2Name = room.player2_name;

      answers.forEach(a => {
        if (a.player_name === p1Name) {
          response.gameBSubmissions.p1Answer = a.response_text;
          response.gameBSubmissions.p1 = true;
        } else if (a.player_name === p2Name) {
          response.gameBSubmissions.p2Answer = a.response_text;
          response.gameBSubmissions.p2 = true;
        }
      });
    }

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retrieve status." });
  }
});

// Select Game (from Game Hub)
app.post('/api/game/select', async (req, res) => {
  const { roomCode, gameId } = req.body;
  if (!roomCode || !gameId) {
    return res.status(400).json({ error: "Room Code and Game ID are required." });
  }

  try {
    // If selecting game-b, select a random question
    let qIndex = 0;
    if (gameId === 'game-b') {
      qIndex = Math.floor(Math.random() * 22); // Size of the icebreaker pool
    }

    await dbRun(
      "UPDATE rooms SET active_game = ?, game_a_context = 0, game_b_question = ? WHERE room_code = ?",
      [gameId, qIndex, roomCode.toUpperCase()]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to select game." });
  }
});

// Submit Game Response (for both Coloring and Ask)
app.post('/api/game/submit', async (req, res) => {
  const { roomCode, username, gameType, contextId, paints, questionId, answer } = req.body;
  const upperCode = roomCode.toUpperCase();

  try {
    if (gameType === 'game-a') {
      // 1. Clear previous paints for this user and context
      await dbRun(
        "DELETE FROM coloring_responses WHERE room_code = ? AND player_name = ? AND context_id = ?",
        [upperCode, username, contextId]
      );

      // 2. Insert coloring values
      for (const [bodyPart, color] of Object.entries(paints || {})) {
        await dbRun(
          "INSERT OR REPLACE INTO coloring_responses (room_code, player_name, body_part, color_value, context_id) VALUES (?, ?, ?, ?, ?)",
          [upperCode, username, bodyPart, color, contextId]
        );
      }

      // 3. Insert status flag to declare submission complete (handles empty submissions)
      await dbRun(
        "INSERT OR REPLACE INTO coloring_responses (room_code, player_name, body_part, color_value, context_id) VALUES (?, ?, '_status', 'submitted', ?)",
        [upperCode, username, contextId]
      );

    } else if (gameType === 'game-b') {
      // Insert or replace response text for this question
      await dbRun(
        "INSERT OR REPLACE INTO ask_responses (room_code, player_name, question_id, response_text) VALUES (?, ?, ?, ?)",
        [upperCode, username, questionId, answer]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Submission failed." });
  }
});

// Next Prompt/Question (Pagination or Draw Next)
app.post('/api/game/next', async (req, res) => {
  const { roomCode, gameType } = req.body;
  const upperCode = roomCode.toUpperCase();

  try {
    const room = await dbGet("SELECT * FROM rooms WHERE room_code = ?", [upperCode]);
    if (!room) return res.status(404).json({ error: "Room not found." });

    if (gameType === 'game-a') {
      // Go to next context index (0-4)
      const nextContext = (room.game_a_context + 1) % 5;
      await dbRun("UPDATE rooms SET game_a_context = ? WHERE room_code = ?", [nextContext, upperCode]);
    } else if (gameType === 'game-b') {
      // Pick a random question index (0-21) avoiding immediate repetition
      let nextQ = Math.floor(Math.random() * 22);
      while (nextQ === room.game_b_question) {
        nextQ = Math.floor(Math.random() * 22);
      }
      await dbRun("UPDATE rooms SET game_b_question = ? WHERE room_code = ?", [nextQ, upperCode]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to advance game." });
  }
});

// Prev Context (Coloring Game specific)
app.post('/api/game/prev', async (req, res) => {
  const { roomCode } = req.body;
  const upperCode = roomCode.toUpperCase();

  try {
    const room = await dbGet("SELECT * FROM rooms WHERE room_code = ?", [upperCode]);
    if (!room) return res.status(404).json({ error: "Room not found." });

    // Go to previous context index (0-4)
    const prevContext = (room.game_a_context - 1 + 5) % 5;
    await dbRun("UPDATE rooms SET game_a_context = ? WHERE room_code = ?", [prevContext, upperCode]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load previous context." });
  }
});

// Exit to Game Choice Hub
app.post('/api/game/exit', async (req, res) => {
  const { roomCode } = req.body;
  try {
    await dbRun(
      "UPDATE rooms SET active_game = 'hub' WHERE room_code = ?",
      [roomCode.toUpperCase()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to exit to hub." });
  }
});

// Leave/Reset Room (Disconnects)
app.post('/api/room/leave', async (req, res) => {
  const { roomCode, username } = req.body;
  const upperCode = roomCode.toUpperCase();

  try {
    const room = await dbGet("SELECT * FROM rooms WHERE room_code = ?", [upperCode]);
    if (room) {
      if (room.player1_name === username) {
        // If Host leaves, close/delete room and responses
        await dbRun("DELETE FROM rooms WHERE room_code = ?", [upperCode]);
        await dbRun("DELETE FROM coloring_responses WHERE room_code = ?", [upperCode]);
        await dbRun("DELETE FROM ask_responses WHERE room_code = ?", [upperCode]);
      } else if (room.player2_name === username) {
        // If Peer leaves, reset room back to waiting
        await dbRun("UPDATE rooms SET player2_name = NULL, status = 'waiting', active_game = 'hub' WHERE room_code = ?", [upperCode]);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Leave routine failed." });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server successfully started. Running locally on http://localhost:${PORT}`);
});
