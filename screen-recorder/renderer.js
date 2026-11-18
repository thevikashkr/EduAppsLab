const AUTH_STORAGE_KEY = "clearframe.accounts";
const ACTIVE_ACCOUNT_KEY = "clearframe.activeAccount";
const RECORDINGS_STORAGE_KEY = "clearframe.recordings";
const MAX_SCREENS = 4;
const TRIAL_LIMIT_MS = 5 * 60 * 1000;

const byId = (id) => document.getElementById(id);
const authView = byId("auth-view");
const appView = byId("app-view");
const screenDialog = byId("screen-dialog");
const screenList = byId("screen-list");
const toast = byId("toast");
const canvas = byId("recording-canvas");
const context = canvas.getContext("2d");
const state = {
  authMode: "register",
  account: null,
  screens: [],
  previewStreams: [],
  previewVideos: [],
  streams: [],
  cameraStream: null,
  audioContext: null,
  audioDestination: null,
  hasAudioInput: false,
  recorder: null,
  outputStream: null,
  chunks: [],
  drawFrame: null,
  timer: null,
  startedAt: 0,
  stopAfter: 0,
  isRecording: false,
  isSelectingArea: false,
  cropSelection: null,
  selectionDraft: null,
  dragStart: null,
  compositionCanvas: document.createElement("canvas"),
  previewUrl: null,
  lastRecordingFilename: null,
  recordingUrl: null,
  toastTimeout: null
};

function readStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    throw new Error(`Could not read local app data: ${error.message}`);
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new Error(`Could not save local app data: ${error.message}`);
  }
}

function accountIsPremium(account) {
  return account?.plan === "premium";
}

function accountHasTrial(account) {
  return account?.plan === "trial" && Date.now() < account.trialEndsAt;
}

function canRecord() {
  return accountIsPremium(state.account) || accountHasTrial(state.account);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  byId("register-tab").classList.toggle("active", isRegister);
  byId("login-tab").classList.toggle("active", !isRegister);
  byId("name-field").classList.toggle("hidden", !isRegister);
  byId("name-input").required = isRegister;
  byId("password-input").autocomplete = isRegister ? "new-password" : "current-password";
  byId("auth-title").textContent = isRegister ? "Your next great recording starts here." : "Welcome back to EduRecScreen.";
  byId("auth-description").textContent = isRegister ? "Create an account to start your 30-day trial." : "Log in to your local EduRecScreen account.";
  byId("auth-submit").innerHTML = isRegister
    ? 'Request your 1-month trial <span aria-hidden="true">→</span>'
    : 'Log in to EduRecScreen <span aria-hidden="true">→</span>';
  byId("auth-error").textContent = "";
  byId("password-input").value = "";
}

function passwordDigest(salt, password) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

async function authenticate(event) {
  event.preventDefault();
  const submit = byId("auth-submit");
  const email = byId("email-input").value.trim().toLowerCase();
  const password = byId("password-input").value;
  const name = byId("name-input").value.trim();
  const errorMessage = byId("auth-error");
  errorMessage.textContent = "";
  submit.disabled = true;

  try {
    const accounts = readStorage(AUTH_STORAGE_KEY, {});
    if (state.authMode === "register") {
      if (!name) throw new Error("Please enter your name.");
      if (password.length < 8) throw new Error("Your password must be at least 8 characters.");
      if (accounts[email]) throw new Error("An account already exists for that email. Try logging in.");
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const now = Date.now();
      const account = {
        name,
        email,
        passwordSalt: salt,
        passwordHash: await passwordDigest(salt, password),
        createdAt: now,
        trialEndsAt: now + 30 * 24 * 60 * 60 * 1000,
        plan: "trial"
      };
      accounts[email] = account;
      writeStorage(AUTH_STORAGE_KEY, accounts);
      writeStorage(ACTIVE_ACCOUNT_KEY, email);
      state.account = account;
    } else {
      const account = accounts[email];
      if (!account || await passwordDigest(account.passwordSalt, password) !== account.passwordHash) {
        throw new Error("That email and password don’t match. Please try again.");
      }
      writeStorage(ACTIVE_ACCOUNT_KEY, email);
      state.account = account;
    }
    byId("auth-form").reset();
    showApp();
  } catch (error) {
    errorMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function showAuth() {
  authView.classList.remove("hidden");
  appView.classList.add("hidden");
  setAuthMode("register");
}

function displayDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(timestamp));
}

function updateTrialStatus() {
  const days = Math.max(0, Math.ceil((state.account.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)));
  const premium = accountIsPremium(state.account);
  const active = accountHasTrial(state.account);
  const totalTrialDays = 30;
  byId("trial-card").classList.toggle("hidden", premium);
  byId("trial-days").textContent = active ? `${days} day${days === 1 ? "" : "s"} left` : "Trial ended";
  byId("trial-progress-fill").style.width = `${Math.min(100, Math.max(2, (days / totalTrialDays) * 100))}%`;
  byId("trial-plan-status").textContent = premium ? "FULL ACCESS" : active ? "CURRENT PLAN" : "TRIAL ENDED";
  byId("about-plan").textContent = premium ? "EduRecScreen Plus" : active ? `Free trial · ${days} days left` : "Free trial ended";
  byId("recording-state").textContent = premium ? "Full access" : active ? "Ready to record" : "Trial ended";
  byId("output-quality").textContent = premium ? "UP TO 4K" : "UP TO 720P";
  byId("auto-stop").disabled = state.isRecording;
  Array.from(byId("auto-stop").options).forEach((option) => {
    if (!premium && Number(option.value) > 5) option.disabled = true;
    else option.disabled = false;
  });
  if (!premium && Number(byId("auto-stop").value) > 5) byId("auto-stop").value = "5";
  byId("start-recording").disabled = !state.screens.length || state.isRecording || !canRecord();
  byId("choose-screen").disabled = state.isRecording;
  byId("select-area").disabled = state.isRecording || !state.screens.length;
  ["microphone-toggle", "system-audio-toggle", "camera-toggle"].forEach((id) => {
    byId(id).disabled = state.isRecording;
  });
}

function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  const firstName = state.account.name.trim().split(/\s+/)[0] || "Friend";
  const initial = firstName.slice(0, 1).toUpperCase();
  byId("profile-name").textContent = state.account.name;
  byId("profile-email").textContent = state.account.email;
  byId("avatar-initial").textContent = initial;
  byId("topbar-account").textContent = initial;
  byId("about-avatar").textContent = initial;
  byId("about-name").textContent = state.account.name;
  byId("about-email").textContent = state.account.email;
  byId("about-joined").textContent = `Member since ${displayDate(state.account.createdAt)}`;
  byId("auto-stop").value = accountIsPremium(state.account) ? "0" : "5";
  updateTrialStatus();
  renderLibrary();
  showPage("record");
}

function showPage(page) {
  ["record", "library", "plan", "about"].forEach((name) => {
    byId(`page-${name}`).classList.toggle("hidden", name !== page);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  byId("page-title").textContent = ({ record: "Record", library: "My recordings", plan: "Plan & pricing", about: "About me" })[page] || "Record";
}

function openPageFromEvent(event) {
  const button = event.target.closest("[data-page]");
  if (button) showPage(button.dataset.page);
}

function showToast(message) {
  clearTimeout(state.toastTimeout);
  toast.textContent = message;
  toast.classList.remove("hidden");
  state.toastTimeout = setTimeout(() => toast.classList.add("hidden"), 4500);
}

async function openScreenPicker() {
  stopScreenPreview();
  byId("screen-error").textContent = "";
  screenList.innerHTML = "";
  screenDialog.classList.remove("hidden");
  byId("confirm-screen-selection").disabled = true;
  screenList.innerHTML = '<div class="screen-option-info"><small>Finding connected screens…</small></div>';
  try {
    const screens = await window.clearframe.getScreens();
    if (!screens.length) {
      screenList.innerHTML = "";
      byId("screen-error").textContent = "No screens were found. Connect a display and try again.";
      return;
    }
    screenList.innerHTML = "";
    screens.forEach((screen, index) => {
      const option = document.createElement("label");
      option.className = "screen-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "screen";
      checkbox.value = screen.id;
      checkbox.checked = state.screens.some((selected) => selected.id === screen.id) || (!state.screens.length && index === 0);
      checkbox.addEventListener("change", () => {
        if (screenList.querySelectorAll('input:checked').length > MAX_SCREENS) {
          checkbox.checked = false;
          byId("screen-error").textContent = "You can record up to four screens at once.";
        } else {
          byId("screen-error").textContent = "";
        }
      });
      const mark = document.createElement("span");
      mark.className = "screen-option-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "▣";
      const info = document.createElement("span");
      info.className = "screen-option-info";
      const name = document.createElement("strong");
      name.textContent = screen.name;
      const description = document.createElement("small");
      description.textContent = `Display ${index + 1}`;
      info.append(name, description);
      option.append(checkbox, mark, info);
      screenList.append(option);
    });
    byId("confirm-screen-selection").disabled = false;
  } catch (error) {
    screenList.innerHTML = "";
    byId("screen-error").textContent = `Could not list screens: ${error.message}`;
  }
}

function closeScreenPicker() {
  screenDialog.classList.add("hidden");
  if (state.screens.length && !state.isRecording) startScreenPreview();
}

function commitScreenSelection() {
  const selectedIds = Array.from(screenList.querySelectorAll('input[name="screen"]:checked')).map((checkbox) => checkbox.value);
  if (selectedIds.length === 0) {
    byId("screen-error").textContent = "Select at least one display to continue.";
    return;
  }
  state.screens = Array.from(screenList.querySelectorAll(".screen-option")).filter((option) => option.querySelector("input").checked).map((option) => ({
    id: option.querySelector("input").value,
    name: option.querySelector(".screen-option-info strong").textContent
  }));
  byId("selected-screens-label").textContent = `${state.screens.length} screen${state.screens.length === 1 ? "" : "s"} selected`;
  state.cropSelection = null;
  state.selectionDraft = null;
  state.isSelectingArea = false;
  canvas.classList.remove("selecting-area");
  byId("select-area").textContent = "Select area";
  byId("select-area").disabled = false;
  byId("preview-placeholder").classList.add("hidden");
  byId("preview-label").textContent = "LIVE PREVIEW · NOT RECORDING";
  byId("recording-message").textContent = "Live preview only. Nothing is saved until you start recording.";
  screenDialog.classList.add("hidden");
  updateTrialStatus();
  startScreenPreview();
}

function updateCanvasLayout() {
  const premium = accountIsPremium(state.account);
  canvas.width = premium ? 3840 : 1280;
  canvas.height = premium ? 2160 : 720;
  state.compositionCanvas.width = canvas.width;
  state.compositionCanvas.height = canvas.height;
}

async function captureStreamFor(screen, includeAudio) {
  await window.clearframe.prepareScreenCapture(screen.id, includeAudio);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: accountIsPremium(state.account) ? 3840 : 1280 },
        height: { ideal: accountIsPremium(state.account) ? 2160 : 720 }
      },
      audio: includeAudio && navigator.platform.startsWith("Win")
    });
    await window.clearframe.completeScreenCapture();
    return stream;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await window.clearframe.cancelScreenCapture();
    throw error;
  }
}

function drawContain(drawContext, streamVideo, x, y, width, height) {
  const sourceWidth = streamVideo.videoWidth || width;
  const sourceHeight = streamVideo.videoHeight || height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  drawContext.drawImage(streamVideo, drawX, drawY, drawWidth, drawHeight);
}

function drawCover(drawContext, streamVideo, x, y, width, height) {
  const sourceWidth = streamVideo.videoWidth || width;
  const sourceHeight = streamVideo.videoHeight || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  const cropX = (sourceWidth - cropWidth) / 2;
  const cropY = (sourceHeight - cropHeight) / 2;
  drawContext.drawImage(streamVideo, cropX, cropY, cropWidth, cropHeight, x, y, width, height);
}

function startCanvasRendering(videos) {
  const composition = state.compositionCanvas.getContext("2d");
  let lastFrameTime = 0;
  const draw = (timestamp) => {
    if (timestamp - lastFrameTime < 1000 / 30) {
      state.drawFrame = requestAnimationFrame(draw);
      return;
    }
    lastFrameTime = timestamp;
    composition.fillStyle = "#1c2a30";
    composition.fillRect(0, 0, canvas.width, canvas.height);
    const columns = Math.ceil(Math.sqrt(videos.length));
    const rows = Math.ceil(videos.length / columns);
    const gap = videos.length === 1 ? 0 : 10;
    const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
    const cellHeight = (canvas.height - gap * (rows + 1)) / rows;
    videos.forEach(({ video }, index) => {
      drawContain(composition, video, gap + (index % columns) * (cellWidth + gap), gap + Math.floor(index / columns) * (cellHeight + gap), cellWidth, cellHeight);
    });
    if (state.cropSelection && state.isRecording) {
      const { x, y, width, height } = state.cropSelection;
      const scale = Math.min(canvas.width / width, canvas.height / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const drawX = (canvas.width - drawWidth) / 2;
      const drawY = (canvas.height - drawHeight) / 2;
      context.fillStyle = "#1c2a30";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(state.compositionCanvas, x, y, width, height, drawX, drawY, drawWidth, drawHeight);
    } else {
      context.drawImage(state.compositionCanvas, 0, 0);
    }
    if (state.cameraStream && state.cameraStream.active && state.isRecording) {
      const cameraVideo = state.cameraStream.__video;
      if (cameraVideo?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const scale = canvas.width / 1280;
        const diameter = Math.min(canvas.width * 0.18, 620);
        const radius = diameter / 2;
        const x = canvas.width - diameter - 32 * scale;
        const y = canvas.height - diameter - 32 * scale;
        context.fillStyle = "#f7fbf8";
        context.save();
        context.beginPath();
        context.arc(x + radius, y + radius, radius + 5 * scale, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
        context.clip();
        drawCover(context, cameraVideo, x, y, diameter, diameter);
        context.restore();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 3 * scale;
        context.beginPath();
        context.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
        context.stroke();
      }
    }
    if (state.isRecording) drawRecordingWatermark();
    if (!state.isRecording && (state.isSelectingArea || state.selectionDraft || state.cropSelection)) drawSelectionOverlay();
    state.drawFrame = requestAnimationFrame(draw);
  };
  state.drawFrame = requestAnimationFrame(draw);
}

function drawSelectionOverlay() {
  const selection = state.selectionDraft || state.cropSelection;
  if (!selection) {
    context.fillStyle = "#09131555";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const { x, y, width, height } = selection;
  context.fillStyle = "#09131555";
  context.fillRect(0, 0, canvas.width, y);
  context.fillRect(0, y + height, canvas.width, canvas.height - y - height);
  context.fillRect(0, y, x, height);
  context.fillRect(x + width, y, canvas.width - x - width, height);
  context.strokeStyle = "#8bdbb7";
  context.lineWidth = Math.max(2, canvas.width / 800);
  context.setLineDash([12, 8]);
  context.strokeRect(x, y, width, height);
  context.setLineDash([]);
}

function drawRecordingWatermark() {
  const scale = canvas.width / 1280;
  const fontSize = 17 * scale;
  const paddingX = 14 * scale;
  const badgeHeight = 42 * scale;
  const left = 24 * scale;
  const top = canvas.height - badgeHeight - 24 * scale;
  const label = "RECORDING · EDURECSCREEN";
  const elapsedSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
  const elapsed = [
    String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0"),
    String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0"),
    String(elapsedSeconds % 60).padStart(2, "0")
  ].join(":");

  context.save();
  context.font = `600 ${fontSize}px sans-serif`;
  const width = context.measureText(label).width + context.measureText(elapsed).width + 62 * scale + paddingX * 2;
  context.fillStyle = "#10191dcc";
  context.beginPath();
  context.roundRect(left, top, width, badgeHeight, 8 * scale);
  context.fill();
  context.fillStyle = "#f06d64";
  context.beginPath();
  context.arc(left + paddingX + 6 * scale, top + badgeHeight / 2, 5 * scale, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.textBaseline = "middle";
  context.fillText(label, left + paddingX + 18 * scale, top + badgeHeight / 2);
  context.fillStyle = "#c8d2d0";
  context.fillText(elapsed, left + width - paddingX - context.measureText(elapsed).width, top + badgeHeight / 2);
  context.restore();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))
  };
}

function updateRegionSelection(event) {
  if (!state.isSelectingArea || !state.dragStart || state.isRecording) return;
  const point = canvasPoint(event);
  const x = Math.min(point.x, state.dragStart.x);
  const y = Math.min(point.y, state.dragStart.y);
  const width = Math.abs(point.x - state.dragStart.x);
  const height = Math.abs(point.y - state.dragStart.y);
  state.selectionDraft = { x, y, width, height };
}

async function startScreenPreview({ updateMessage = true } = {}) {
  if (!state.screens.length || state.isRecording) return;
  stopScreenPreview();
  try {
    updateCanvasLayout();
    for (const screen of state.screens) {
      state.previewStreams.push(await captureStreamFor(screen, false));
    }
    state.previewVideos = await Promise.all(state.previewStreams.map((stream, index) => new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.onloadedmetadata = () => video.play().then(() => resolve({ video, name: state.screens[index].name })).catch(reject);
      video.onerror = () => reject(new Error(`Could not show ${state.screens[index].name}.`));
    })));
    byId("preview-placeholder").classList.add("hidden");
    byId("preview-label").textContent = "LIVE PREVIEW · NOT RECORDING";
    if (updateMessage) byId("recording-message").textContent = "Live preview only. Nothing is saved until you start recording.";
    startCanvasRendering(state.previewVideos);
  } catch (error) {
    stopScreenPreview();
    byId("preview-placeholder").classList.remove("hidden");
    byId("preview-label").textContent = "SCREENS SELECTED";
    const reason = error.name ? `${error.name}: ${error.message}` : error.message;
    if (updateMessage) byId("recording-message").textContent = `Could not preview your screens: ${reason}`;
    showToast(`Could not preview your screens: ${reason}`);
  }
}

function stopScreenPreview() {
  if (state.drawFrame !== null) cancelAnimationFrame(state.drawFrame);
  state.drawFrame = null;
  state.previewStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  state.previewStreams = [];
  state.previewVideos = [];
}

function addAudioToMix(stream) {
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) return;
  state.hasAudioInput = true;
  const source = state.audioContext.createMediaStreamSource(new MediaStream(audioTracks));
  source.connect(state.audioDestination);
}

function setupTimer() {
  clearInterval(state.timer);
  const update = () => {
    const elapsed = Date.now() - state.startedAt;
    const totalSeconds = Math.floor(elapsed / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    byId("preview-timer").textContent = `${hours}:${minutes}:${seconds}`;
    if (state.stopAfter && elapsed >= state.stopAfter) stopRecording();
    if (!canRecord()) stopRecording();
  };
  update();
  state.timer = setInterval(update, 1000);
}

async function startRecording() {
  if (!state.screens.length) {
    showToast("Choose a screen before recording.");
    return;
  }
  if (!canRecord()) {
    showToast("Your trial has ended. Visit Plan & pricing to see your options.");
    showPage("plan");
    updateTrialStatus();
    return;
  }

  state.isRecording = true;
  state.streams = [];
  state.chunks = [];
  state.recorder = null;
  state.hasAudioInput = false;
  updateTrialStatus();
  byId("recording-message").textContent = "Getting your screens ready…";
  byId("recording-state").textContent = "Getting ready";

  try {
    updateCanvasLayout();
    stopScreenPreview();
    const screenStreams = [];
    for (let index = 0; index < state.screens.length; index += 1) {
      const stream = await captureStreamFor(state.screens[index], index === 0 && byId("system-audio-toggle").checked);
      screenStreams.push(stream);
      state.streams.push(stream);
    }
    const videos = await Promise.all(screenStreams.map((stream, index) => new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.onloadedmetadata = () => video.play().then(() => resolve({ video, name: state.screens[index].name })).catch(reject);
      video.onerror = () => reject(new Error(`Could not show ${state.screens[index].name}.`));
    })));

    if (byId("camera-toggle").checked) {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const cameraVideo = document.createElement("video");
      cameraVideo.muted = true;
      cameraVideo.playsInline = true;
      cameraVideo.srcObject = state.cameraStream;
      state.cameraStream.__video = cameraVideo;
      await new Promise((resolve, reject) => {
        cameraVideo.onloadedmetadata = () => cameraVideo.play().then(resolve).catch(reject);
        cameraVideo.onerror = () => reject(new Error("Could not start your camera."));
      });
      byId("camera-indicator").classList.remove("hidden");
    }

    startCanvasRendering(videos);
    state.audioContext = new AudioContext();
    state.audioDestination = state.audioContext.createMediaStreamDestination();
    await state.audioContext.resume();
    screenStreams.forEach(addAudioToMix);

    if (byId("microphone-toggle").checked) {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      state.streams.push(microphoneStream);
      addAudioToMix(microphoneStream);
    }

    const canvasStream = canvas.captureStream(30);
    const audioTracks = state.hasAudioInput ? state.audioDestination.stream.getAudioTracks() : [];
    const recordingTracks = [...canvasStream.getVideoTracks(), ...audioTracks];
    state.outputStream = new MediaStream(recordingTracks);
    const premium = accountIsPremium(state.account);
    const mimeTypes = state.hasAudioInput
      ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      : ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    const recorderOptions = {
      videoBitsPerSecond: premium ? 28_000_000 : 6_000_000,
      ...(state.hasAudioInput ? { audioBitsPerSecond: 192_000 } : {})
    };
    if (mimeType) recorderOptions.mimeType = mimeType;
    state.recorder = new MediaRecorder(state.outputStream, recorderOptions);
    state.recorder.ondataavailable = (event) => {
      if (event.data.size) state.chunks.push(event.data);
    };
    state.recorder.onerror = (event) => {
      byId("recording-message").textContent = `Recording error: ${event.error?.message || "The recorder stopped unexpectedly."}`;
      stopRecording();
    };
    state.recorder.onstop = finishRecording;
    state.recorder.start(1000);
    window.clearframe.setRecordingState(true);
    state.startedAt = Date.now();
    const selectedStop = Number(byId("auto-stop").value) * 60 * 1000;
    state.stopAfter = accountIsPremium(state.account)
      ? selectedStop
      : Math.min(selectedStop || TRIAL_LIMIT_MS, TRIAL_LIMIT_MS);
    byId("preview-placeholder").classList.add("hidden");
    byId("preview-label").textContent = "RECORDING";
    byId("preview-timer").classList.remove("hidden");
    byId("start-recording").classList.add("hidden");
    byId("stop-recording").classList.remove("hidden");
    byId("recording-message").textContent = "Recording is active. Minimize EduRecScreen to capture other windows; the saved video includes a recording watermark.";
    byId("recording-state").textContent = "Recording";
    setupTimer();
  } catch (error) {
    state.isRecording = false;
    window.clearframe.setRecordingState(false);
    cleanupCapture();
    updateTrialStatus();
    byId("recording-state").textContent = canRecord() ? "Ready to record" : "Trial ended";
    const reason = `Could not start the recording: ${error.name ? `${error.name}: ` : ""}${error.message}`;
    byId("preview-label").textContent = "SCREENS SELECTED";
    if (state.screens.length) await startScreenPreview();
    byId("recording-message").textContent = reason;
  }
}

function stopRecording() {
  if (!state.isRecording || !state.recorder || state.recorder.state === "inactive") return;
  state.isRecording = false;
  byId("stop-recording").disabled = true;
  byId("recording-message").textContent = "Saving your recording…";
  state.recorder.stop();
}

function cleanupCapture() {
  clearInterval(state.timer);
  state.timer = null;
  if (state.drawFrame !== null) cancelAnimationFrame(state.drawFrame);
  state.drawFrame = null;
  state.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  state.streams = [];
  if (state.outputStream) state.outputStream.getTracks().forEach((track) => track.stop());
  state.outputStream = null;
  state.audioDestination = null;
  state.hasAudioInput = false;
  if (state.cameraStream) state.cameraStream.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  if (state.audioContext && state.audioContext.state !== "closed") state.audioContext.close();
  state.audioContext = null;
  byId("camera-indicator").classList.add("hidden");
}

function finishRecording() {
  const mimeType = state.recorder?.mimeType || "video/webm";
  const blob = new Blob(state.chunks, { type: mimeType });
  state.chunks = [];
  state.recorder = null;
  state.isRecording = false;
  window.clearframe.setRecordingState(false);
  cleanupCapture();
  byId("stop-recording").disabled = false;
  byId("stop-recording").classList.add("hidden");
  byId("start-recording").classList.remove("hidden");
  byId("preview-timer").classList.add("hidden");
  byId("recording-state").textContent = canRecord() ? "Recording saved" : "Trial ended";
  byId("preview-label").textContent = "SCREENS SELECTED";
  byId("recording-message").textContent = blob.size ? "Saving your recording to Downloads…" : "No video data was captured. Please try recording again.";
  if (!blob.size) {
    byId("preview-placeholder").classList.remove("hidden");
    updateTrialStatus();
    if (state.screens.length) startScreenPreview();
    return;
  }

  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = URL.createObjectURL(blob);
  const date = new Date();
  const extension = mimeType.toLowerCase().startsWith("video/mp4") ? "mp4" : "webm";
  const filename = `EduRecScreen-${date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}.${extension}`;
  const download = document.createElement("a");
  download.href = state.recordingUrl;
  download.download = filename;
  state.lastRecordingFilename = filename;
  document.body.append(download);
  download.click();
  download.remove();

  const recordings = readStorage(RECORDINGS_STORAGE_KEY, []);
  recordings.unshift({ id: crypto.randomUUID(), filename, createdAt: Date.now(), size: blob.size });
  try {
    writeStorage(RECORDINGS_STORAGE_KEY, recordings);
  } catch (error) {
    showToast(`Your video was downloaded, but the library could not be updated: ${error.message}`);
  }
  byId("last-recording-name").textContent = filename;
  byId("last-recording-card").classList.remove("hidden");
  byId("preview-placeholder").classList.remove("hidden");
  byId("preview-label").textContent = "LIVE PREVIEW";
  renderLibrary();
  updateTrialStatus();
  if (state.screens.length) startScreenPreview({ updateMessage: false });
}

function renderLibrary() {
  const recordings = readStorage(RECORDINGS_STORAGE_KEY, []);
  byId("recording-count").textContent = String(recordings.length);
  byId("library-empty").classList.toggle("hidden", recordings.length > 0);
  const list = byId("library-list");
  list.replaceChildren();
  recordings.forEach((recording) => {
    const row = document.createElement("article");
    row.className = "library-item";
    const icon = document.createElement("span");
    icon.className = "library-item-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▶";
    const details = document.createElement("div");
    details.className = "library-item-details";
    const filename = document.createElement("strong");
    filename.textContent = recording.filename;
    const metadata = document.createElement("small");
    const size = recording.size < 1024 * 1024
      ? `${Math.max(1, Math.round(recording.size / 1024))} KB`
      : `${(recording.size / (1024 * 1024)).toFixed(1)} MB`;
    metadata.textContent = `${displayDate(recording.createdAt)} · ${size} · saved to Downloads`;
    details.append(filename, metadata);
    row.append(icon, details);
    list.append(row);
  });
}

function requestSubscription() {
  showToast("Subscriptions are not connected in this local demo. No payment has been taken.");
}

function signOut() {
  stopScreenPreview();
  try {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  } catch (error) {
    showToast(`Could not sign out: ${error.message}`);
    return;
  }
  state.account = null;
  state.screens = [];
  state.cropSelection = null;
  showAuth();
}

function restoreAccount() {
  try {
    const email = readStorage(ACTIVE_ACCOUNT_KEY, null);
    if (!email) return showAuth();
    const accounts = readStorage(AUTH_STORAGE_KEY, {});
    const account = accounts[email];
    if (!account) return showAuth();
    state.account = account;
    showApp();
  } catch (error) {
    showAuth();
    byId("auth-error").textContent = error.message;
  }
}

byId("register-tab").addEventListener("click", () => setAuthMode("register"));
byId("login-tab").addEventListener("click", () => setAuthMode("login"));
byId("auth-form").addEventListener("submit", authenticate);
document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", openPageFromEvent));
byId("choose-screen").addEventListener("click", openScreenPicker);
byId("choose-screen-empty").addEventListener("click", openScreenPicker);
byId("close-screen-dialog").addEventListener("click", closeScreenPicker);
byId("cancel-screen-selection").addEventListener("click", closeScreenPicker);
byId("confirm-screen-selection").addEventListener("click", commitScreenSelection);
byId("start-recording").addEventListener("click", startRecording);
byId("stop-recording").addEventListener("click", stopRecording);
byId("select-area").addEventListener("click", () => {
  if (state.cropSelection && !state.isSelectingArea) {
    state.cropSelection = null;
    state.selectionDraft = null;
    byId("select-area").textContent = "Select area";
    byId("recording-message").textContent = "Full screen area selected.";
    return;
  }
  if (state.isSelectingArea) {
    state.isSelectingArea = false;
    state.selectionDraft = null;
    canvas.classList.remove("selecting-area");
    return;
  }
  state.cropSelection = null;
  state.selectionDraft = null;
  state.isSelectingArea = true;
  canvas.classList.add("selecting-area");
  byId("recording-message").textContent = "Drag across the preview to select an area, then start recording.";
});
canvas.addEventListener("pointerdown", (event) => {
  if (!state.isSelectingArea || state.isRecording) return;
  canvas.setPointerCapture(event.pointerId);
  state.dragStart = canvasPoint(event);
  state.selectionDraft = { x: state.dragStart.x, y: state.dragStart.y, width: 0, height: 0 };
});
canvas.addEventListener("pointermove", updateRegionSelection);
canvas.addEventListener("pointerup", (event) => {
  if (!state.isSelectingArea || !state.dragStart || state.isRecording) return;
  updateRegionSelection(event);
  if (state.selectionDraft?.width >= 80 && state.selectionDraft?.height >= 60) {
    state.cropSelection = state.selectionDraft;
    state.selectionDraft = null;
    state.isSelectingArea = false;
    canvas.classList.remove("selecting-area");
    byId("select-area").textContent = "Clear area";
    byId("recording-message").textContent = "Recording area selected. Press start when you’re ready.";
  } else {
    state.selectionDraft = null;
    byId("recording-message").textContent = "Drag a larger area to select it, or press Escape to cancel.";
  }
  state.dragStart = null;
});
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.isSelectingArea) {
    state.isSelectingArea = false;
    state.selectionDraft = null;
    canvas.classList.remove("selecting-area");
  }
});
byId("subscribe-button").addEventListener("click", requestSubscription);
byId("sign-out").addEventListener("click", signOut);
byId("about-sign-out").addEventListener("click", signOut);
byId("open-library").addEventListener("click", () => showPage("library"));
window.clearframe.onNavigate((page) => showPage(page));
window.clearframe.onRecordingDownload(({ filename, success, error }) => {
  if (filename !== state.lastRecordingFilename) return;
  if (success) {
    byId("recording-message").textContent = "Your recording is saved to your Downloads folder.";
    return;
  }
  byId("recording-message").textContent = `Could not save your recording: ${error}`;
  showToast(`Could not save your recording: ${error}`);
});
window.addEventListener("beforeunload", () => {
  stopScreenPreview();
  cleanupCapture();
});

restoreAccount();
