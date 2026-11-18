const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clearframe", {
  getScreens: () => ipcRenderer.invoke("list-screens"),
  prepareScreenCapture: (screenId, includeSystemAudio) =>
    ipcRenderer.invoke("prepare-screen-capture", screenId, includeSystemAudio),
  cancelScreenCapture: () => ipcRenderer.invoke("cancel-screen-capture"),
  completeScreenCapture: () => ipcRenderer.invoke("complete-screen-capture"),
  setRecordingState: (isRecording) => ipcRenderer.send("set-recording-state", isRecording),
  onRecordingDownload: (callback) => {
    ipcRenderer.on("recording-download-complete", (_event, result) => callback(result));
  },
  onNavigate: (callback) => {
    ipcRenderer.on("navigate", (_event, page) => callback(page));
  }
});
