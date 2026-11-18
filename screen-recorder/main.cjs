const { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session } = require("electron");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const { registerCapturePermissions } = require("./capture-permissions.cjs");

let mainWindow;
const pendingCaptures = new Map();

async function getScreenSources() {
  return desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    backgroundColor: "#f5f6f7",
    title: "EduRecScreen",
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  registerCapturePermissions({
    session: session.defaultSession,
    getMainWindow: () => mainWindow,
    getScreenSources,
    pendingCaptures,
    platform: process.platform
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => pendingCaptures.delete(mainWindow?.webContents.id));

  const menu = Menu.buildFromTemplate([
    {
      label: "EduRecScreen",
      submenu: [
        {
          label: "About Me",
          click: () => mainWindow.webContents.send("navigate", "about")
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "windowMenu" }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  const homeDirectory = app.getPath("home");
  const configuredDownloadsDirectory = app.getPath("downloads");
  const downloadsDirectory = path.resolve(configuredDownloadsDirectory) === path.resolve(homeDirectory)
    ? path.join(homeDirectory, "Downloads")
    : configuredDownloadsDirectory;
  await mkdir(downloadsDirectory, { recursive: true });

  session.defaultSession.on("will-download", (event, item, webContents) => {
    const filename = item.getFilename();
    const isAppRecording =
      webContents === mainWindow?.webContents &&
      item.getURL().startsWith("blob:") &&
      path.basename(filename) === filename &&
      filename.startsWith("EduRecScreen-") &&
      /\.(?:webm|mp4)$/i.test(filename);

    if (!isAppRecording) {
      event.preventDefault();
      if (webContents === mainWindow?.webContents) {
        webContents.send("recording-download-complete", {
          filename,
          success: false,
          error: "The recording download could not be verified."
        });
      }
      return;
    }

    item.setSavePath(path.join(downloadsDirectory, filename));
    item.once("done", (_downloadEvent, status) => {
      if (!mainWindow?.webContents.isDestroyed()) {
        mainWindow.webContents.send("recording-download-complete", {
          filename,
          success: status === "completed",
          error: status === "completed" ? undefined : "The download was interrupted."
        });
      }
    });
  });

  ipcMain.handle("list-screens", async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Screen access is limited to the EduRecScreen window.");
    const sources = await getScreenSources();
    return sources.map(({ id, name, display_id }) => ({ id, name, displayId: display_id }));
  });

  ipcMain.handle("prepare-screen-capture", async (event, screenId, includeSystemAudio) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Screen access is limited to the EduRecScreen window.");
    if (typeof screenId !== "string" || !(await getScreenSources()).some(({ id }) => id === screenId)) {
      throw new Error("The selected screen is no longer available. Please choose it again.");
    }
    pendingCaptures.set(event.sender.id, {
      screenId,
      includeSystemAudio: includeSystemAudio === true
    });
  });

  ipcMain.handle("cancel-screen-capture", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Screen access is limited to the EduRecScreen window.");
    pendingCaptures.delete(event.sender.id);
  });

  ipcMain.handle("complete-screen-capture", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Screen access is limited to the EduRecScreen window.");
    pendingCaptures.delete(event.sender.id);
  });

  ipcMain.on("set-recording-state", (event, isRecording) => {
    if (event.sender !== mainWindow?.webContents || typeof isRecording !== "boolean") return;
    mainWindow.setTitle(isRecording ? "EduRecScreen — RECORDING" : "EduRecScreen");
    mainWindow.flashFrame(isRecording);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error("Could not initialize EduRecScreen:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
