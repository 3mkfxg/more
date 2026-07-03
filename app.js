// List of 22 icebreaker questions for Minigame B
const ICEBREAKER_QUESTIONS = [
  "What is your absolute most controversial food opinion?",
  "If you could have any useless superpower, what would it be?",
  "What is the weirdest habit you had as a child?",
  "What is a song you secretly love but would never play in front of others?",
  "What is the most ridiculous thing you've ever bought?",
  "If you could swap lives with any fictional character for a day, who would it be?",
  "What is the worst advice you have ever received that you actually followed?",
  "What is the most embarrassing fashion trend you ever participated in?",
  "What is a movie you can watch over and over without getting tired of it?",
  "What is your go-to excuse to get out of social plans?",
  "If you could invite three historical figures to a dinner party, who would they be?",
  "What is the strangest dream you can actually remember?",
  "If you were a ghost, where would you choose to haunt?",
  "What is the most useless piece of trivia you know?",
  "If your life was a movie, what would the title and theme song be?",
  "What is the most unusual food combination you actually enjoy?",
  "If you could travel back in time, what decade would you visit and why?",
  "What is something you're surprisingly competitive about?",
  "What's the closest thing to real magic you've witnessed?",
  "If you had to rename yourself, what name would you choose?",
  "What is a minor inconvenience that completely ruins your day?",
  "If you were arrested with no explanation, what would your friends assume you did?"
];

// Minigame A contexts
const BOUNDARY_CONTEXTS = [
  "Where do you feel comfortable being touched by someone you don't know?",
  "Where do you feel comfortable being touched by a close friend?",
  "Where do you feel comfortable being touched by a family member?",
  "Where do you feel comfortable being touched by a romantic partner?",
  "Where do you feel comfortable being touched when you are feeling sad or distressed?"
];

// Local Client State
let myUsername = "";
let peerUsername = "";
let roomCode = "";
let role = null; // 'host' or 'peer'
let activeColor = "red"; // active painting color
let activeView = "menu"; // tracks currently displayed view

// Game specific indices (cached locally to detect changes)
let gameAPageIndex = 0;
let gameBQuestionIndex = 0;

// Local coloring paints
let gameAPaints = {};
let gameASubmitted = false;

// Polling interval reference
let pollInterval = null;

// Register Views
const views = {
  menu: document.getElementById("view-menu"),
  lobby: document.getElementById("view-lobby"),
  hub: document.getElementById("view-hub"),
  gameA: document.getElementById("view-game-a"),
  gameB: document.getElementById("view-game-b")
};

// Toast message helper
function showToast(message, duration = 3500) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(50px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Router: switch visual cards
function showView(viewId) {
  activeView = viewId;
  Object.keys(views).forEach(key => {
    if (key === viewId) {
      views[key].classList.add("active");
    } else {
      views[key].classList.remove("active");
    }
  });
}

// Start polling for real-time synchronization status
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  // Poll database every 800ms
  pollInterval = setInterval(pollRoomStatus, 800);
}

// Stop polling status
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Reset client variables back to Main Menu
function resetToMenu(toastMessage) {
  stopPolling();
  myUsername = "";
  peerUsername = "";
  roomCode = "";
  role = null;
  gameASubmitted = false;
  gameAPaints = {};
  
  document.getElementById("input-roomcode").value = "";
  showView("menu");
  
  if (toastMessage) {
    showToast(toastMessage);
  }
}

// ----------------------------------------------------
// DATABASE SYNC: POLLING LOOPS
// ----------------------------------------------------
async function pollRoomStatus() {
  if (!roomCode) return;
  
  try {
    const response = await fetch(`/api/room/status/${roomCode}`);
    if (response.status === 404) {
      resetToMenu("The host has closed the room.");
      return;
    }
    if (!response.ok) return;

    const data = await response.json();
    
    // Resolve Peer Username dynamically based on who is who
    if (myUsername === data.player1) {
      peerUsername = data.player2 || "";
      role = "host";
    } else {
      peerUsername = data.player1 || "";
      role = "peer";
    }

    // Lobby Waiting state sync
    if (data.status === "waiting" && activeView !== "lobby") {
      showView("lobby");
    } else if (data.status === "active" && activeView === "lobby") {
      showToast(`${peerUsername} has connected! Entering game choice hub.`);
      transitionToHub(data);
    }
    
    // Game transition state sync
    if (data.status === "active") {
      if (data.activeGame === "hub" && activeView !== "hub") {
        transitionToHub(data);
      } else if (data.activeGame === "game-a") {
        syncGameAState(data);
      } else if (data.activeGame === "game-b") {
        syncGameBState(data);
      }
    }
    
  } catch (err) {
    console.error("Polling error:", err);
  }
}

// Transition view: Hub
function transitionToHub(data) {
  document.getElementById("hub-player-1").innerText = data.player1 ? `${data.player1} (P1)` : "Player 1";
  document.getElementById("hub-player-2").innerText = data.player2 ? `${data.player2} (P2)` : "Player 2";
  showView("hub");
}

// ----------------------------------------------------
// SYNC MINIGAME A: COLORING MAPS
// ----------------------------------------------------
function syncGameAState(data) {
  const p1Submitted = data.gameASubmissions.p1;
  const p2Submitted = data.gameASubmissions.p2;
  const iSubmitted = role === "host" ? p1Submitted : p2Submitted;
  const peerSubmitted = role === "host" ? p2Submitted : p1Submitted;

  // 1. If active context changes on server, clear and load the new page
  if (data.gameAContext !== gameAPageIndex || activeView !== "gameA") {
    gameAPageIndex = data.gameAContext;
    gameASubmitted = false;
    gameAPaints = {};
    
    // Reset inputs
    document.getElementById("game-a-prompt").innerText = BOUNDARY_CONTEXTS[gameAPageIndex];
    document.getElementById("game-a-page-num").innerText = gameAPageIndex + 1;
    
    // Clear interactive drawing model
    document.querySelectorAll("#interactive-mannequin .body-region").forEach(el => {
      el.removeAttribute("data-color");
    });
    
    document.getElementById("game-a-play-stage").style.display = "grid";
    document.getElementById("game-a-reveal-stage").style.display = "none";
    
    // Enable submit buttons
    const submitBtn = document.getElementById("btn-game-a-submit");
    submitBtn.disabled = false;
    submitBtn.innerText = "Submit Configuration";
    submitBtn.classList.remove("btn-disabled");
    
    showView("gameA");
  }

  // 2. Update local state caches
  gameASubmitted = iSubmitted;

  // 3. Update active submit button
  const submitBtn = document.getElementById("btn-game-a-submit");
  if (gameASubmitted) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Waiting for Player...";
    submitBtn.classList.add("btn-disabled");
  }

  // 4. Update status indicator
  const statusEl = document.getElementById("game-a-status");
  if (p1Submitted && p2Submitted) {
    statusEl.innerText = "Revealed!";
    statusEl.className = "status-indicator status-ready";
  } else if (p1Submitted || p2Submitted) {
    statusEl.innerText = "1/2 Submitted";
    statusEl.className = "status-indicator status-waiting";
  } else {
    statusEl.innerText = "Secret Stage";
    statusEl.className = "status-indicator status-waiting";
  }

  // 5. If both submitted, reveal side-by-side models
  if (p1Submitted && p2Submitted) {
    document.getElementById("game-a-reveal-name-1").innerText = `${data.player1} (P1)`;
    document.getElementById("game-a-reveal-name-2").innerText = `${data.player2} (P2)`;
    
    applyMapColors("reveal-mannequin-1", data.gameASubmissions.p1Paints);
    applyMapColors("reveal-mannequin-2", data.gameASubmissions.p2Paints);
    
    document.getElementById("game-a-play-stage").style.display = "none";
    document.getElementById("game-a-reveal-stage").style.display = "block";
  }
}

// Paint static SVG paths using retrieved coloring maps
function applyMapColors(svgId, paintsObj) {
  document.querySelectorAll(`#${svgId} .body-region`).forEach(el => {
    el.removeAttribute("data-color");
  });
  Object.keys(paintsObj || {}).forEach(region => {
    const color = paintsObj[region];
    const elements = document.querySelectorAll(`#${svgId} [data-region="${region}"]`);
    elements.forEach(el => el.setAttribute("data-color", color));
  });
}

// ----------------------------------------------------
// SYNC MINIGAME B: ASK & REVEAL DEEP DIVE
// ----------------------------------------------------
function syncGameBState(data) {
  const p1Submitted = data.gameBSubmissions.p1;
  const p2Submitted = data.gameBSubmissions.p2;
  const iSubmitted = role === "host" ? p1Submitted : p2Submitted;
  const peerSubmitted = role === "host" ? p2Submitted : p1Submitted;

  // 1. If active question index changes, clear inputs and show the new prompt
  if (data.gameBQuestion !== gameBQuestionIndex || activeView !== "gameB") {
    gameBQuestionIndex = data.gameBQuestion;
    
    // Clear textbox
    document.getElementById("input-game-b-answer").value = "";
    document.getElementById("game-b-question-text").innerText = ICEBREAKER_QUESTIONS[gameBQuestionIndex];
    
    // Reset display stages
    document.getElementById("game-b-play-stage").style.display = "block";
    document.getElementById("game-b-reveal-stage").style.display = "none";
    
    // Enable submit button
    const submitBtn = document.getElementById("btn-game-b-submit");
    submitBtn.disabled = false;
    submitBtn.innerText = "Submit Secret Answer";
    submitBtn.classList.remove("btn-disabled");
    
    showView("gameB");
  }

  // 2. Update active submit button
  const submitBtn = document.getElementById("btn-game-b-submit");
  if (iSubmitted) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Answer Submitted!";
    submitBtn.classList.add("btn-disabled");
  }

  // 3. Update status indicator
  const statusEl = document.getElementById("game-b-status");
  if (p1Submitted && p2Submitted) {
    statusEl.innerText = "Revealed!";
    statusEl.className = "status-indicator status-ready";
  } else if (p1Submitted || p2Submitted) {
    statusEl.innerText = "1/2 Submitted";
    statusEl.className = "status-indicator status-waiting";
  } else {
    statusEl.innerText = "Answering Stage";
    statusEl.className = "status-indicator status-waiting";
  }

  // 4. If both submitted, reveal answers side-by-side
  if (p1Submitted && p2Submitted) {
    document.getElementById("game-b-reveal-name-1").innerText = `${data.player1} (P1)`;
    document.getElementById("game-b-reveal-name-2").innerText = `${data.player2} (P2)`;
    
    document.getElementById("game-b-reveal-text-1").innerText = data.gameBSubmissions.p1Answer;
    document.getElementById("game-b-reveal-text-2").innerText = data.gameBSubmissions.p2Answer;
    
    document.getElementById("game-b-play-stage").style.display = "none";
    document.getElementById("game-b-reveal-stage").style.display = "block";
  }
}

// ----------------------------------------------------
// INTERACTIVE LOCAL ACTIONS (POSTING TO EXPRESS API)
// ----------------------------------------------------

// Select color in Palette
document.querySelectorAll(".palette-option").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".palette-option").forEach(item => item.classList.remove("active"));
    el.classList.add("active");
    activeColor = el.getAttribute("data-color");
  });
});

// Paint mannequin paths
document.getElementById("interactive-mannequin").addEventListener("click", (e) => {
  if (gameASubmitted) return; // block painting after submitting
  
  const region = e.target.getAttribute("data-region");
  if (region) {
    const matchingElements = document.querySelectorAll(`#interactive-mannequin [data-region="${region}"]`);
    const currentColor = gameAPaints[region];
    const targetColor = currentColor === activeColor ? null : activeColor;
    
    if (targetColor) {
      gameAPaints[region] = targetColor;
      matchingElements.forEach(el => el.setAttribute("data-color", targetColor));
    } else {
      delete gameAPaints[region];
      matchingElements.forEach(el => el.removeAttribute("data-color"));
    }
  }
});

// Submit Minigame A (Coloring)
document.getElementById("btn-game-a-submit").addEventListener("click", async () => {
  if (gameASubmitted) return;
  
  try {
    const response = await fetch('/api/game/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode,
        username: myUsername,
        gameType: 'game-a',
        contextId: gameAPageIndex,
        paints: gameAPaints
      })
    });
    
    if (response.ok) {
      showToast("Config submitted successfully! Waiting for partner...");
      pollRoomStatus(); // immediate update
    } else {
      showToast("Failed to submit configurations.");
    }
  } catch (err) {
    console.error(err);
  }
});

// Submit Minigame B (Ask & Reveal)
document.getElementById("btn-game-b-submit").addEventListener("click", async () => {
  const textVal = document.getElementById("input-game-b-answer").value.trim();
  if (!textVal) {
    showToast("Please enter an answer before submitting!");
    return;
  }

  try {
    const response = await fetch('/api/game/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode,
        username: myUsername,
        gameType: 'game-b',
        questionId: gameBQuestionIndex,
        answer: textVal
      })
    });

    if (response.ok) {
      showToast("Answer submitted! Waiting for partner...");
      pollRoomStatus();
    } else {
      showToast("Failed to submit response.");
    }
  } catch (err) {
    console.error(err);
  }
});

// Create Server Button
document.getElementById("btn-create-server").addEventListener("click", async () => {
  const nameVal = document.getElementById("input-username").value.trim();
  if (!nameVal) {
    showToast("Please enter a username first!");
    return;
  }

  try {
    const response = await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: nameVal })
    });
    
    if (response.ok) {
      const data = await response.json();
      myUsername = nameVal;
      roomCode = data.roomCode;
      role = "host";
      
      document.getElementById("lobby-code").innerText = roomCode;
      document.getElementById("lobby-host-name").innerText = myUsername;
      
      showView("lobby");
      startPolling();
    } else {
      showToast("Failed to create room.");
    }
  } catch (err) {
    console.error(err);
  }
});

// Join Server Button
document.getElementById("btn-join-server").addEventListener("click", async () => {
  const nameVal = document.getElementById("input-username").value.trim();
  const codeVal = document.getElementById("input-roomcode").value.trim().toUpperCase();

  if (!nameVal) {
    showToast("Please enter a username first!");
    return;
  }
  if (!codeVal || codeVal.length !== 5) {
    showToast("Please enter a valid 5-digit room code!");
    return;
  }

  try {
    const response = await fetch('/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: nameVal, roomCode: codeVal })
    });
    
    if (response.ok) {
      myUsername = nameVal;
      roomCode = codeVal;
      role = "peer";
      
      showToast("Successfully joined room! Waiting for state sync...");
      startPolling();
    } else {
      const data = await response.json();
      showToast(data.error || "Failed to join room.");
    }
  } catch (err) {
    console.error(err);
  }
});

// Select Game Cards in Hub
document.getElementById("card-game-a").addEventListener("click", async () => {
  try {
    await fetch('/api/game/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, gameId: 'game-a' })
    });
    pollRoomStatus();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("card-game-b").addEventListener("click", async () => {
  try {
    await fetch('/api/game/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, gameId: 'game-b' })
    });
    pollRoomStatus();
  } catch (err) {
    console.error(err);
  }
});

// Back buttons in Minigames
document.querySelectorAll(".btn-to-hub").forEach(btn => {
  btn.addEventListener("click", async () => {
    try {
      await fetch('/api/game/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode })
      });
      pollRoomStatus();
    } catch (err) {
      console.error(err);
    }
  });
});

// Pagination Coloring Game
document.getElementById("btn-game-a-next").addEventListener("click", async () => {
  try {
    await fetch('/api/game/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, gameType: 'game-a' })
    });
    pollRoomStatus();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("btn-game-a-prev").addEventListener("click", async () => {
  try {
    await fetch('/api/game/prev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode })
    });
    pollRoomStatus();
  } catch (err) {
    console.error(err);
  }
});

// Draw next Question in Ask & Reveal
document.getElementById("btn-game-b-next").addEventListener("click", async () => {
  try {
    await fetch('/api/game/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, gameType: 'game-b' })
    });
    pollRoomStatus();
  } catch (err) {
    console.error(err);
  }
});

// Graceful exit on closing window/unloading
window.onbeforeunload = () => {
  if (roomCode && myUsername) {
    navigator.sendBeacon('/api/room/leave', JSON.stringify({ roomCode, username: myUsername }));
  }
};
