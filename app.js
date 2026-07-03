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

// Game State variables
let myUsername = "";
let peerUsername = "";
let roomCode = "";
let role = null; // 'host' or 'peer'
let activeColor = "red"; // default selected paint color
let joinRequestInterval = null; // interval for connection handshake pings

// Minigame A (Coloring) State
let gameAPageIndex = 0;
let gameAPaints = {}; // local coloring config
let gameAPeerPaints = {}; // peer coloring config
let gameASubmitted = false;
let gameAPeerSubmitted = false;

// Minigame B (Ask & Reveal) State
let gameBQuestionIndex = 0;
let gameBSubmitted = false;
let gameBPeerSubmitted = false;
let gameBAnswer = "";
let gameBPeerAnswer = "";

// Initialize BroadcastChannel
const channel = new BroadcastChannel("friends_games_sync");

// Register DOM Elements
const views = {
  menu: document.getElementById("view-menu"),
  lobby: document.getElementById("view-lobby"),
  hub: document.getElementById("view-hub"),
  gameA: document.getElementById("view-game-a"),
  gameB: document.getElementById("view-game-b")
};

// Toast Notifications Helper
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

// Router: switch active view
function showView(viewId) {
  Object.keys(views).forEach(key => {
    if (key === viewId) {
      views[key].classList.add("active");
    } else {
      views[key].classList.remove("active");
    }
  });
}

// Generate a random 5-digit room code
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNOPQRSTUVWXYZ23456789"; // Removed ambiguous letters/numbers
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Broadcast wrapper
function broadcast(message) {
  channel.postMessage({
    roomCode: roomCode,
    sender: myUsername,
    ...message
  });
}

// Handle Room joining logic
function setupRoom(roleType, code, myName) {
  role = roleType;
  roomCode = code.toUpperCase();
  myUsername = myName;
  
  if (role === "host") {
    document.getElementById("lobby-code").innerText = roomCode;
    document.getElementById("lobby-host-name").innerText = myUsername;
    document.getElementById("lobby-status").innerText = "Waiting for Player 2 to join...";
    document.getElementById("lobby-status").className = "status-indicator status-waiting";
    showView("lobby");
    showToast("Lobby created! Share the code with Player 2.");
  } else {
    // Peer does not show lobby, it connects directly after request gets approved
    broadcast({ type: "JOIN_REQUEST", peerName: myUsername });
    showToast("Connecting to room " + roomCode + "...");
    
    // Set up connection handshake pings in case host loaded slow or is currently rendering
    if (joinRequestInterval) clearInterval(joinRequestInterval);
    joinRequestInterval = setInterval(() => {
      if (peerUsername) {
        clearInterval(joinRequestInterval);
        joinRequestInterval = null;
      } else {
        broadcast({ type: "JOIN_REQUEST", peerName: myUsername });
      }
    }, 1200);
  }
}

// Reset entire game connection
function resetToMenu(toastMessage) {
  if (joinRequestInterval) {
    clearInterval(joinRequestInterval);
    joinRequestInterval = null;
  }
  myUsername = "";
  peerUsername = "";
  roomCode = "";
  role = null;
  
  // reset view inputs
  document.getElementById("input-roomcode").value = "";
  showView("menu");
  
  if (toastMessage) {
    showToast(toastMessage);
  }
}

// ----------------------------------------------------
// BroadcastChannel Incoming Message Routing
// ----------------------------------------------------
channel.onmessage = (event) => {
  const data = event.data;
  
  // Ignore messages not matching our room code (unless it's a join request searching for host)
  if (data.roomCode !== roomCode && data.type !== "JOIN_REQUEST") {
    return;
  }
  
  switch (data.type) {
    
    case "JOIN_REQUEST":
      // If we are host, waiting in lobby, and code matches, accept peer
      if (role === "host" && roomCode === data.roomCode && !peerUsername) {
        peerUsername = data.peerName;
        showToast(peerUsername + " joined the lobby!");
        
        // Broadcast acknowledgement to let peer know they are connected
        broadcast({
          type: "JOIN_ACK",
          hostName: myUsername,
          peerName: peerUsername
        });
        
        transitionToHub();
      }
      break;
      
    case "JOIN_ACK":
      // If we are peer waiting for connection and code matches our request
      if (role === "peer" && data.peerName === myUsername && !peerUsername) {
        peerUsername = data.hostName;
        showToast("Connected to host: " + peerUsername);
        transitionToHub();
      }
      break;
      
    case "GAME_SELECT":
      // Both load selected game
      loadGame(data.gameId, false); // false means we don't re-broadcast
      break;
      
    case "GAME_A_SUBMIT":
      // Peer submitted boundaries paints
      if (data.sender === peerUsername) {
        gameAPeerPaints = data.paints;
        gameAPeerSubmitted = true;
        updateGameAStatus();
        checkGameAReveal();
      }
      break;
      
    case "GAME_B_SUBMIT":
      // Peer submitted icebreaker response
      if (data.sender === peerUsername) {
        gameBPeerAnswer = data.answer;
        gameBPeerSubmitted = true;
        updateGameBStatus();
        checkGameBReveal();
      }
      break;
      
    case "NEXT_QUESTION":
      // Sync prompt page or question index
      gameBQuestionIndex = data.questionIndex;
      resetGameBFields();
      break;
      
    case "PAGINATION_CHANGE":
      // Sync pagination in boundaries coloring game
      gameAPageIndex = data.pageIndex;
      resetGameAFields();
      break;
      
    case "RESET_TO_HUB":
      transitionToHub(false);
      break;
      
    case "DISCONNECT":
      resetToMenu("Connection closed: Peer left the game.");
      break;
  }
};

// Send DISCONNECT when closing tab or window
window.onbeforeunload = () => {
  if (roomCode) {
    broadcast({ type: "DISCONNECT" });
  }
};

// ----------------------------------------------------
// Transition: Game Choice Hub
// ----------------------------------------------------
function transitionToHub(shouldBroadcast = true) {
  if (joinRequestInterval) {
    clearInterval(joinRequestInterval);
    joinRequestInterval = null;
  }
  
  if (shouldBroadcast) {
    broadcast({ type: "RESET_TO_HUB" });
  }
  
  // Set players matchup headers
  document.getElementById("hub-player-1").innerText = role === "host" ? myUsername + " (P1)" : peerUsername + " (P1)";
  document.getElementById("hub-player-2").innerText = role === "peer" ? myUsername + " (P2)" : peerUsername + " (P2)";
  
  showView("hub");
}

// ----------------------------------------------------
// Load and Reset Minigames
// ----------------------------------------------------
function loadGame(gameId, shouldBroadcast = true) {
  if (shouldBroadcast) {
    broadcast({ type: "GAME_SELECT", gameId });
  }
  
  if (gameId === "game-a") {
    gameAPageIndex = 0;
    resetGameAFields();
    showView("gameA");
  } else if (gameId === "game-b") {
    // If Host, pick a random starting question index
    if (role === "host") {
      gameBQuestionIndex = Math.floor(Math.random() * ICEBREAKER_QUESTIONS.length);
      broadcast({ type: "NEXT_QUESTION", questionIndex: gameBQuestionIndex });
    }
    resetGameBFields();
    showView("gameB");
  }
}

// Reset Coloring game state & UI
function resetGameAFields() {
  gameAPaints = {};
  gameAPeerPaints = {};
  gameASubmitted = false;
  gameAPeerSubmitted = false;
  
  // Update prompt
  document.getElementById("game-a-prompt").innerText = BOUNDARY_CONTEXTS[gameAPageIndex];
  document.getElementById("game-a-page-num").innerText = gameAPageIndex + 1;
  
  // Reset SVGs coloring
  document.querySelectorAll(".body-region").forEach(el => {
    el.removeAttribute("data-color");
  });
  
  // Show play views and hide reveal views
  document.getElementById("game-a-play-stage").style.display = "grid";
  document.getElementById("game-a-reveal-stage").style.display = "none";
  
  // Enable submit buttons
  const submitBtn = document.getElementById("btn-game-a-submit");
  submitBtn.disabled = false;
  submitBtn.innerText = "Submit Configuration";
  submitBtn.classList.remove("btn-disabled");
  
  updateGameAStatus();
}

// Reset Icebreaker game state & UI
function resetGameBFields() {
  gameBAnswer = "";
  gameBPeerAnswer = "";
  gameBSubmitted = false;
  gameBPeerSubmitted = false;
  
  // Clear textarea
  document.getElementById("input-game-b-answer").value = "";
  
  // Update question prompt
  document.getElementById("game-b-question-text").innerText = ICEBREAKER_QUESTIONS[gameBQuestionIndex];
  
  // Show play views and hide reveal views
  document.getElementById("game-b-play-stage").style.display = "block";
  document.getElementById("game-b-reveal-stage").style.display = "none";
  
  // Enable submit
  const submitBtn = document.getElementById("btn-game-b-submit");
  submitBtn.disabled = false;
  submitBtn.innerText = "Submit Secret Answer";
  submitBtn.classList.remove("btn-disabled");
  
  updateGameBStatus();
}

// ----------------------------------------------------
// MINIGAME A: COLORING GAME LOGIC
// ----------------------------------------------------

// Handle local color palette selection
document.querySelectorAll(".palette-option").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".palette-option").forEach(item => item.classList.remove("active"));
    el.classList.add("active");
    activeColor = el.getAttribute("data-color");
  });
});

// Paint interactive mannequin parts
document.getElementById("interactive-mannequin").addEventListener("click", (e) => {
  if (gameASubmitted) return; // block modifications after submitting
  
  const region = e.target.getAttribute("data-region");
  if (region) {
    // Select all paths representing this region (e.g. both arms or both legs)
    const matchingElements = document.querySelectorAll(`#interactive-mannequin [data-region="${region}"]`);
    
    // Toggle color if already painted with the same color, otherwise set color
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

// Submit Coloring config
document.getElementById("btn-game-a-submit").addEventListener("click", () => {
  if (gameASubmitted) return;
  
  gameASubmitted = true;
  
  // Disable button
  const submitBtn = document.getElementById("btn-game-a-submit");
  submitBtn.disabled = true;
  submitBtn.innerText = "Waiting for Player...";
  submitBtn.classList.add("btn-disabled");
  
  // Broadcast local coloring state
  broadcast({
    type: "GAME_A_SUBMIT",
    paints: gameAPaints
  });
  
  updateGameAStatus();
  checkGameAReveal();
});

// Sync status indicators
function updateGameAStatus() {
  const statusEl = document.getElementById("game-a-status");
  if (gameASubmitted && gameAPeerSubmitted) {
    statusEl.innerText = "Revealed!";
    statusEl.className = "status-indicator status-ready";
  } else if (gameASubmitted || gameAPeerSubmitted) {
    statusEl.innerText = "1/2 Submitted";
    statusEl.className = "status-indicator status-waiting";
  } else {
    statusEl.innerText = "Secret Stage";
    statusEl.className = "status-indicator status-waiting";
  }
}

// Transition to coloring Reveal screen if both submitted
function checkGameAReveal() {
  if (gameASubmitted && gameAPeerSubmitted) {
    showToast("Reveal! Check your comfort zones.");
    
    // Set labels
    document.getElementById("game-a-reveal-name-1").innerText = role === "host" ? myUsername + " (P1)" : peerUsername + " (P1)";
    document.getElementById("game-a-reveal-name-2").innerText = role === "peer" ? myUsername + " (P2)" : peerUsername + " (P2)";
    
    // Apply paints to reveal mannequins
    const mapP1 = role === "host" ? gameAPaints : gameAPeerPaints;
    const mapP2 = role === "peer" ? gameAPaints : gameAPeerPaints;
    
    applyMapColors("reveal-mannequin-1", mapP1);
    applyMapColors("reveal-mannequin-2", mapP2);
    
    // Switch states display
    document.getElementById("game-a-play-stage").style.display = "none";
    document.getElementById("game-a-reveal-stage").style.display = "block";
  }
}

// Apply colors from state objects to static SVGs
function applyMapColors(svgId, paintsObj) {
  // Clear first
  document.querySelectorAll(`#${svgId} .body-region`).forEach(el => {
    el.removeAttribute("data-color");
  });
  
  // Apply colors
  Object.keys(paintsObj).forEach(region => {
    const color = paintsObj[region];
    const elements = document.querySelectorAll(`#${svgId} [data-region="${region}"]`);
    elements.forEach(el => el.setAttribute("data-color", color));
  });
}

// Minigame A Pagination Click Handlers
document.getElementById("btn-game-a-next").addEventListener("click", () => {
  if (gameAPageIndex < BOUNDARY_CONTEXTS.length - 1) {
    gameAPageIndex++;
    broadcast({ type: "PAGINATION_CHANGE", pageIndex: gameAPageIndex });
    resetGameAFields();
  } else {
    showToast("Last context page reached!");
  }
});

document.getElementById("btn-game-a-prev").addEventListener("click", () => {
  if (gameAPageIndex > 0) {
    gameAPageIndex--;
    broadcast({ type: "PAGINATION_CHANGE", pageIndex: gameAPageIndex });
    resetGameAFields();
  } else {
    showToast("First context page reached!");
  }
});


// ----------------------------------------------------
// MINIGAME B: ASK & REVEAL DEEP DIVE LOGIC
// ----------------------------------------------------

// Submit Icebreaker Secret response
document.getElementById("btn-game-b-submit").addEventListener("click", () => {
  const answerVal = document.getElementById("input-game-b-answer").value.trim();
  
  if (!answerVal) {
    showToast("Please enter an answer before submitting!");
    return;
  }
  
  gameBAnswer = answerVal;
  gameBSubmitted = true;
  
  // Disable button
  const submitBtn = document.getElementById("btn-game-b-submit");
  submitBtn.disabled = true;
  submitBtn.innerText = "Answer Submitted!";
  submitBtn.classList.add("btn-disabled");
  
  broadcast({
    type: "GAME_B_SUBMIT",
    answer: gameBAnswer
  });
  
  updateGameBStatus();
  checkGameBReveal();
});

// Update Status indicators
function updateGameBStatus() {
  const statusEl = document.getElementById("game-b-status");
  if (gameBSubmitted && gameBPeerSubmitted) {
    statusEl.innerText = "Revealed!";
    statusEl.className = "status-indicator status-ready";
  } else if (gameBSubmitted || gameBPeerSubmitted) {
    statusEl.innerText = "1/2 Submitted";
    statusEl.className = "status-indicator status-waiting";
  } else {
    statusEl.innerText = "Answering Stage";
    statusEl.className = "status-indicator status-waiting";
  }
}

// Reveal answers
function checkGameBReveal() {
  if (gameBSubmitted && gameBPeerSubmitted) {
    showToast("Revealed! Read the responses.");
    
    // Set labels
    document.getElementById("game-b-reveal-name-1").innerText = role === "host" ? myUsername + " (P1)" : peerUsername + " (P1)";
    document.getElementById("game-b-reveal-name-2").innerText = role === "peer" ? myUsername + " (P2)" : peerUsername + " (P2)";
    
    // Apply texts
    const answerP1 = role === "host" ? gameBAnswer : gameBPeerAnswer;
    const answerP2 = role === "peer" ? gameBAnswer : gameBPeerAnswer;
    
    document.getElementById("game-b-reveal-text-1").innerText = answerP1;
    document.getElementById("game-b-reveal-text-2").innerText = answerP2;
    
    // Transition UI views
    document.getElementById("game-b-play-stage").style.display = "none";
    document.getElementById("game-b-reveal-stage").style.display = "block";
  }
}

// Draw next Question
document.getElementById("btn-game-b-next").addEventListener("click", () => {
  // Let anyone draw next, simple and fun
  let nextIdx = Math.floor(Math.random() * ICEBREAKER_QUESTIONS.length);
  // Avoid picking the exact same question consecutively
  while (nextIdx === gameBQuestionIndex && ICEBREAKER_QUESTIONS.length > 1) {
    nextIdx = Math.floor(Math.random() * ICEBREAKER_QUESTIONS.length);
  }
  
  gameBQuestionIndex = nextIdx;
  broadcast({ type: "NEXT_QUESTION", questionIndex: gameBQuestionIndex });
  resetGameBFields();
});


// ----------------------------------------------------
// UI INTERACTIVE CLICK HANDLERS (GENERAL)
// ----------------------------------------------------

// "Create Server" Menu Button
document.getElementById("btn-create-server").addEventListener("click", () => {
  const usernameVal = document.getElementById("input-username").value.trim();
  if (!usernameVal) {
    showToast("Please enter a username first!");
    return;
  }
  
  const roomCodeGenerated = generateRoomCode();
  setupRoom("host", roomCodeGenerated, usernameVal);
});

// "Join Server" Menu Button
document.getElementById("btn-join-server").addEventListener("click", () => {
  const usernameVal = document.getElementById("input-username").value.trim();
  const codeVal = document.getElementById("input-roomcode").value.trim().toUpperCase();
  
  if (!usernameVal) {
    showToast("Please enter a username first!");
    return;
  }
  if (!codeVal || codeVal.length !== 5) {
    showToast("Please enter a valid 5-digit room code!");
    return;
  }
  
  setupRoom("peer", codeVal, usernameVal);
});

// Join card triggers
document.getElementById("card-game-a").addEventListener("click", () => {
  loadGame("game-a");
});

document.getElementById("card-game-b").addEventListener("click", () => {
  loadGame("game-b");
});

// Exit back to game choice hub from inside a game
document.querySelectorAll(".btn-to-hub").forEach(btn => {
  btn.addEventListener("click", () => {
    transitionToHub();
  });
});
