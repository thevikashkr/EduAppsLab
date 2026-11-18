const test = require("node:test");
const assert = require("node:assert/strict");
const { registerCapturePermissions } = require("./capture-permissions.cjs");

function createHarness(platform = "win32") {
  const webContents = {
    id: 17,
    isDestroyed: () => false,
    mainFrame: { url: "file:///app/index.html" }
  };
  const mainWindow = { webContents };
  const sources = [
    { id: "screen-1", name: "Display 1" },
    { id: "screen-2", name: "Display 2" }
  ];
  const pendingCaptures = new Map();
  const handlers = {};

  registerCapturePermissions({
    session: {
      setPermissionCheckHandler: (handler) => { handlers.check = handler; },
      setPermissionRequestHandler: (handler) => { handlers.request = handler; },
      setDisplayMediaRequestHandler: (handler, options) => {
        handlers.display = handler;
        handlers.displayOptions = options;
      }
    },
    getMainWindow: () => mainWindow,
    getScreenSources: async () => sources,
    pendingCaptures,
    platform,
    logger: { error: assert.fail }
  });

  return { webContents, mainWindow, sources, pendingCaptures, handlers };
}

test("allows a selected display-capture permission only for the app main frame", () => {
  const { webContents, pendingCaptures, handlers } = createHarness();

  assert.equal(handlers.check(webContents, "display-capture", "file://", { mediaType: "video" }), false);
  pendingCaptures.set(webContents.id, { screenId: "screen-1" });
  assert.equal(handlers.check(webContents, "display-capture", "file://", { mediaType: "video" }), true);
  assert.equal(handlers.check(webContents, "display-capture", "https://example.com", { mediaType: "video" }), false);
  assert.equal(handlers.check({ id: 18 }, "display-capture", "file://", { mediaType: "video" }), false);
});

test("allows a pending screen permission request without consuming its capture", () => {
  const { webContents, pendingCaptures, handlers } = createHarness();
  pendingCaptures.set(webContents.id, { screenId: "screen-1" });
  let allowed;

  handlers.request(webContents, "display-capture", (value) => { allowed = value; }, {
    securityOrigin: "file://",
    mediaTypes: ["video"]
  });

  assert.equal(allowed, true);
  assert.equal(pendingCaptures.has(webContents.id), true);
});

test("rejects unselected, foreign-origin, and audio-only screen permission requests", () => {
  const { webContents, pendingCaptures, handlers } = createHarness();
  let allowed;
  const request = (origin, mediaTypes) => handlers.request(
    webContents,
    "display-capture",
    (value) => { allowed = value; },
    { securityOrigin: origin, mediaTypes }
  );

  request("file://", ["video"]);
  assert.equal(allowed, false);
  pendingCaptures.set(webContents.id, { screenId: "screen-1" });
  request("https://example.com", ["video"]);
  assert.equal(allowed, false);
  request("file://", ["audio"]);
  assert.equal(allowed, false);
});

test("provides only the selected display and Windows loopback audio", async () => {
  const { webContents, mainWindow, pendingCaptures, handlers } = createHarness();
  const foreignFrame = { url: "file:///app/other.html" };
  pendingCaptures.set(webContents.id, { screenId: "screen-2", includeSystemAudio: true });

  const rejected = await new Promise((resolve) => handlers.display({
    frame: foreignFrame,
    securityOrigin: "file://",
    audioRequested: true
  }, resolve));
  assert.equal(rejected, null);

  const result = await new Promise((resolve) => handlers.display({
    frame: mainWindow.webContents.mainFrame,
    securityOrigin: "file://",
    audioRequested: true
  }, resolve));

  assert.deepEqual(result, { video: { id: "screen-2", name: "Display 2" }, audio: "loopback" });
  assert.equal(pendingCaptures.has(webContents.id), true);
});

test("does not grant system audio on other platforms or without an audio request", async () => {
  const { webContents, mainWindow, pendingCaptures, handlers } = createHarness("linux");
  pendingCaptures.set(webContents.id, { screenId: "screen-1", includeSystemAudio: true });

  const result = await new Promise((resolve) => handlers.display({
    frame: mainWindow.webContents.mainFrame,
    securityOrigin: "file://",
    audioRequested: true
  }, resolve));

  assert.deepEqual(result, { video: { id: "screen-1", name: "Display 1" } });
});

test("rejects capture when the selected display is no longer available", async () => {
  const { webContents, mainWindow, pendingCaptures, handlers } = createHarness();
  pendingCaptures.set(webContents.id, { screenId: "disconnected-display" });

  const result = await new Promise((resolve) => handlers.display({
    frame: mainWindow.webContents.mainFrame,
    securityOrigin: "file://",
    audioRequested: false
  }, resolve));

  assert.equal(result, null);
});

test("rejects display capture without a pending selection or trusted origin", async () => {
  const { webContents, mainWindow, handlers } = createHarness();
  const request = {
    frame: mainWindow.webContents.mainFrame,
    securityOrigin: "https://example.com",
    audioRequested: false
  };

  const result = await new Promise((resolve) => handlers.display(request, resolve));
  assert.equal(result, null);
  assert.equal(handlers.check(webContents, "media", "file://", { mediaType: "video" }), true);
  assert.equal(handlers.check(webContents, "geolocation", "file://", {}), false);
});
