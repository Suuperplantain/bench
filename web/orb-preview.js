const canvas = document.querySelector("#corona");
const stage = document.querySelector(".stage");
const launcher = document.querySelector("#orb-launcher");
const desk = document.querySelector("#side-desk");
const closeDesk = document.querySelector("#desk-close");
const repoList = document.querySelector("#repo-list");
const repoCount = document.querySelector("#repo-count");
const repoReload = document.querySelector("#repo-reload");
const workspaceRepo = document.querySelector("#workspace-repo");
const conversation = document.querySelector("#conversation");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");
const chatStatus = document.querySelector("#chat-status");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Inspired by the layered radial noise in Radiant's Eclipse Glow.
// https://radiant-shaders.com/shader/eclipse-glow (MIT, Paul Bakaus)
const vertexShader = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentShader = `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise3(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash3(cell), hash3(cell + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash3(cell + vec3(0.0, 1.0, 0.0)), hash3(cell + vec3(1.0, 1.0, 0.0)), f.x),
        f.y
      ),
      mix(
        mix(hash3(cell + vec3(0.0, 0.0, 1.0)), hash3(cell + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash3(cell + vec3(0.0, 1.0, 1.0)), hash3(cell + vec3(1.0, 1.0, 1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - resolution * 0.5) / min(resolution.x, resolution.y);
    float radius = length(uv);
    vec2 direction = uv / max(radius, 0.0001);
    float edge = 0.283;
    float distance = max(0.0, radius - edge);
    float angle = atan(direction.y, direction.x);
    float flowAngle = angle + time * 0.34;
    vec2 flowingDirection = vec2(cos(flowAngle), sin(flowAngle));

    // Time is a separate noise dimension: strands form and dissolve as they
    // travel around the rim, rather than sliding through a repeating 2D field.
    float broad = noise3(vec3(flowingDirection * 4.0, time * 0.38));
    float bend = (broad - 0.5) * distance * 6.0;
    bend += (noise3(vec3(flowingDirection * 7.0, time * 0.61)) - 0.5) * distance * 2.0;
    vec2 curved = vec2(cos(flowAngle + bend), sin(flowAngle + bend));
    float middle = noise3(vec3(curved * 11.0 + vec2(distance * 5.0, -distance * 3.0), time * 0.73));
    float fine = noise3(vec3(curved * 29.0 + vec2(-distance * 9.0, distance * 7.0), time * 1.03));
    float flowing = noise3(vec3(flowingDirection * 8.0 + vec2(distance * 14.0, distance * 9.0), time * 0.86));

    float streamer = pow(broad, 2.0) * 0.085 + pow(middle, 4.0) * 0.07;
    float reach = 0.025 + streamer + fine * 0.018;
    float envelope = exp(-pow(distance / reach, 1.25));
    float threads = pow(middle, 4.0) * 0.7 + pow(fine, 6.0) * 0.72;
    threads *= 0.65 + flowing * 0.65;
    float soft = envelope * (0.16 + threads);

    float inner = exp(-pow(distance / 0.008, 2.0));
    float edgeLight = exp(-pow(distance / 0.0025, 2.0));
    float dust = hash(floor(gl_FragCoord.xy * 0.8) + floor(time * 8.0));
    float grain = step(0.985, dust) * envelope * 0.13;
    float opacity = (soft * 0.76 + inner * 0.34 + edgeLight * 0.45 + grain)
      * smoothstep(edge - 0.005, edge + 0.008, radius);
    opacity *= 1.0 - smoothstep(0.48, 0.51, radius);

    float alpha = clamp(opacity, 0.0, 0.92);
    gl_FragColor = vec4(vec3(0.94, 0.96, 1.0) * alpha, alpha);
  }
`;

function createCorona(gl) {
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Corona shader error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertex = compile(gl.VERTEX_SHADER, vertexShader);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Corona link error:", gl.getProgramInfoLog(program));
    return null;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return {
    resolution: gl.getUniformLocation(program, "resolution"),
    time: gl.getUniformLocation(program, "time"),
  };
}

if (canvas && stage && launcher && desk && closeDesk) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
  const corona = gl && createCorona(gl);
  let frame = 0;
  let previous = 0;
  let elapsed = 0;
  let projects = [];
  let selectedProjectID = null;
  const messagesByProject = new Map();
  const activeTurns = new Set();
  const blinkTimers = new Map();
  let pointer = null;
  let gazeFrame = 0;

  function updateGaze() {
    gazeFrame = 0;
    for (const face of document.querySelectorAll(".orb-face")) {
      const rect = face.getBoundingClientRect();
      const reach = Number(face.dataset.lookRange) || 2;
      const dx = pointer ? pointer.x - (rect.left + rect.width / 2) : 0;
      const dy = pointer ? pointer.y - (rect.top + rect.height / 2) : 0;
      const distance = Math.hypot(dx, dy);
      const strength = Math.min(distance / 110, 1);
      face.style.setProperty("--look-x", `${distance ? dx / distance * reach * strength : 0}px`);
      face.style.setProperty("--look-y", `${distance ? dy / distance * reach * strength : 0}px`);
    }
  }

  function scheduleGaze() {
    if (!gazeFrame) gazeFrame = window.requestAnimationFrame(updateGaze);
  }

  function scheduleBlink(face) {
    window.clearTimeout(blinkTimers.get(face));
    if (document.hidden || reduceMotion.matches) {
      face.classList.remove("is-blinking");
      return;
    }
    const delay = 2200 + Math.random() * 4300;
    blinkTimers.set(face, window.setTimeout(() => {
      face.classList.add("is-blinking");
      blinkTimers.set(face, window.setTimeout(() => {
        face.classList.remove("is-blinking");
        scheduleBlink(face);
      }, 120));
    }, delay));
  }

  function refreshBlinking() {
    for (const face of document.querySelectorAll(".orb-face")) scheduleBlink(face);
  }

  function storedMessages(projectID) {
    if (messagesByProject.has(projectID)) return messagesByProject.get(projectID);
    let messages = [];
    try {
      const saved = JSON.parse(localStorage.getItem(`bench.orb.chat.${projectID}`) || "[]");
      if (Array.isArray(saved)) messages = saved.filter(item =>
        item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string"
      ).slice(-100);
    } catch { /* A damaged local transcript should not block the workspace. */ }
    messagesByProject.set(projectID, messages);
    return messages;
  }

  function saveMessages(projectID) {
    try { localStorage.setItem(`bench.orb.chat.${projectID}`, JSON.stringify(storedMessages(projectID).slice(-100))); }
    catch { /* Chat remains usable if local storage is unavailable. */ }
  }

  function renderConversation() {
    conversation.replaceChildren();
    if (!selectedProjectID) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = "Pick a repository on the left to start working.";
      conversation.append(empty);
      return;
    }
    const messages = storedMessages(selectedProjectID);
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = "This repository has no messages yet.";
      conversation.append(empty);
      return;
    }
    for (const message of messages) {
      const bubble = document.createElement("div");
      bubble.className = "chat-message";
      bubble.dataset.role = message.role;
      if (message.pending && !message.text) bubble.classList.add("is-pending");
      bubble.textContent = message.text || "Working…";
      conversation.append(bubble);
    }
    conversation.scrollTop = conversation.scrollHeight;
  }

  function updateComposer() {
    const project = projects.find(item => item.id === selectedProjectID);
    const busy = project && activeTurns.has(project.id);
    workspaceRepo.textContent = project ? project.name : "Choose a repository";
    chatInput.disabled = !project || busy;
    chatSend.disabled = !project || busy;
    chatInput.placeholder = project ? (busy ? "Codex is working…" : `Message Codex about ${project.name}…`) : "Choose a repository first";
    chatStatus.textContent = busy ? "Codex is working in this repository" : project ? `LOCAL · ${project.branch || "NO BRANCH"}` : "";
  }

  function selectProject(projectID) {
    selectedProjectID = projectID;
    for (const card of repoList.querySelectorAll(".repo-item")) {
      card.setAttribute("aria-pressed", String(card.dataset.projectId === projectID));
    }
    updateComposer();
    renderConversation();
    if (!chatInput.disabled) chatInput.focus({ preventScroll: true });
  }

  function renderProjects() {
    for (const face of repoList.querySelectorAll(".orb-face")) {
      window.clearTimeout(blinkTimers.get(face));
      blinkTimers.delete(face);
    }
    repoList.replaceChildren();
    repoCount.textContent = String(projects.length);
    if (!projects.length) {
      const empty = document.createElement("p");
      empty.className = "repo-message";
      empty.textContent = "No repositories found in the configured folders.";
      repoList.append(empty);
    }
    for (const project of projects) {
      const card = document.createElement("button");
      card.className = "repo-item";
      card.type = "button";
      card.dataset.projectId = project.id;
      card.setAttribute("aria-pressed", String(project.id === selectedProjectID));
      const orb = document.createElement("span");
      orb.className = "repo-orb orb-face";
      orb.dataset.lookRange = "2.5";
      orb.setAttribute("aria-hidden", "true");
      const eyes = document.createElement("span");
      eyes.className = "orb-eyes";
      eyes.append(Object.assign(document.createElement("span"), { className: "orb-eye" }),
        Object.assign(document.createElement("span"), { className: "orb-eye" }));
      orb.append(eyes);
      const face = document.createElement("span");
      face.className = "repo-card-face";
      const name = document.createElement("span");
      name.className = "repo-name";
      name.textContent = project.name;
      const branch = document.createElement("span");
      branch.className = "repo-branch";
      branch.textContent = project.branch || "no branch";
      face.append(name, branch);
      card.append(orb, face);
      repoList.append(card);
      scheduleBlink(orb);
    }
    updateGaze();
    updateComposer();
  }

  async function loadProjects() {
    repoReload.disabled = true;
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error(`Repository list failed (${response.status})`);
      const payload = await response.json();
      projects = Array.isArray(payload.projects) ? payload.projects : [];
      if (selectedProjectID && !projects.some(item => item.id === selectedProjectID)) selectedProjectID = null;
      renderProjects();
    } catch {
      repoList.replaceChildren();
      const message = document.createElement("p");
      message.className = "repo-message";
      message.textContent = "Could not load repositories. Check that the local Bench server is running, then refresh.";
      repoList.append(message);
      repoCount.textContent = "—";
    } finally {
      repoReload.disabled = false;
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const projectID = selectedProjectID;
    const message = chatInput.value.trim();
    if (!projectID || !message || activeTurns.has(projectID)) return;
    const messages = storedMessages(projectID);
    const answer = { role: "assistant", text: "", pending: true };
    messages.push({ role: "user", text: message }, answer);
    saveMessages(projectID);
    chatInput.value = "";
    activeTurns.add(projectID);
    updateComposer();
    renderConversation();
    let error = "";
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectID)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Keep changes local. Do not commit or push unless I explicitly ask in this message.\n\n${message}` }),
      });
      if (!response.ok) {
        let details;
        try { details = await response.json(); } catch { /* Use the HTTP status below. */ }
        throw new Error(details?.error || `Chat request failed (${response.status})`);
      }
      if (!response.body) throw new Error("Chat stream is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
          if (!data) continue;
          let update;
          try { update = JSON.parse(data); } catch { continue; }
          if (update.type === "delta") answer.text += update.text || "";
          if (update.type === "error") error = update.text || "Codex could not finish this turn.";
          if (update.type === "done") completed = true;
          if (selectedProjectID === projectID) renderConversation();
        }
      }
      if (!completed && !error) error = "The chat stream ended before Codex finished.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Chat request failed.";
    } finally {
      answer.pending = false;
      if (error) answer.text += `${answer.text ? "\n\n" : ""}${error}`;
      saveMessages(projectID);
      activeTurns.delete(projectID);
      if (selectedProjectID === projectID) {
        updateComposer();
        renderConversation();
        chatInput.focus({ preventScroll: true });
      }
    }
  }

  function draw() {
    if (!gl || !corona) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(corona.resolution, canvas.width, canvas.height);
    gl.uniform1f(corona.time, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function resize() {
    if (!gl) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }

  function animate(now) {
    if (previous) elapsed += Math.min((now - previous) / 1000, 0.05);
    previous = now;
    draw();
    frame = window.requestAnimationFrame(animate);
  }

  function run() {
    if (!gl || !corona || document.hidden || reduceMotion.matches || frame) return;
    frame = window.requestAnimationFrame(animate);
  }

  function pause() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }

  function setOpen(open) {
    if (open) launcher.classList.remove("is-nodding");
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Bench is open" : "Open Bench");
    launcher.setAttribute("aria-hidden", String(open));
    launcher.tabIndex = open ? -1 : 0;
    stage.classList.toggle("is-open", open);
    desk.setAttribute("aria-hidden", String(!open));
    desk.inert = !open;
    if (open) closeDesk.focus({ preventScroll: true });
    else launcher.focus({ preventScroll: true });
  }

  launcher.addEventListener("click", () => setOpen(true));
  launcher.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (reduceMotion.matches || stage.classList.contains("is-open") || launcher.classList.contains("is-nodding")) return;
    launcher.classList.add("is-nodding");
  });
  launcher.querySelector(".orb-core").addEventListener("animationend", event => {
    if (event.animationName === "orb-double-nod") launcher.classList.remove("is-nodding");
  });
  closeDesk.addEventListener("click", () => setOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && launcher.getAttribute("aria-expanded") === "true") setOpen(false);
  });
  document.addEventListener("pointermove", event => {
    if (reduceMotion.matches) return;
    pointer = { x: event.clientX, y: event.clientY };
    scheduleGaze();
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer = null; scheduleGaze(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause(); else run();
    refreshBlinking();
  });
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) { pause(); draw(); launcher.classList.remove("is-nodding"); } else run();
    pointer = null;
    scheduleGaze();
    refreshBlinking();
  });
  repoList.addEventListener("click", event => {
    const card = event.target.closest(".repo-item");
    if (card) selectProject(card.dataset.projectId);
  });
  repoReload.addEventListener("click", loadProjects);
  chatForm.addEventListener("submit", sendMessage);
  chatInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); chatForm.requestSubmit(); }
  });

  new ResizeObserver(resize).observe(canvas);
  resize();
  run();
  refreshBlinking();
  loadProjects();
}
