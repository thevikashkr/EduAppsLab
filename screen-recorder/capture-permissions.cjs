function registerCapturePermissions({
  session,
  getMainWindow,
  getScreenSources,
  pendingCaptures,
  platform,
  logger = console
}) {
  const isAppMainFrame = (webContents, requestingOrigin) => {
    const mainWindow = getMainWindow();
    if (
      !webContents ||
      webContents !== mainWindow?.webContents ||
      webContents.isDestroyed() ||
      !webContents.mainFrame?.url.startsWith("file://")
    ) {
      return false;
    }

    return !requestingOrigin || requestingOrigin.startsWith("file://");
  };

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!isAppMainFrame(webContents, requestingOrigin)) return false;
    if (permission === "display-capture") return pendingCaptures.has(webContents.id);
    return permission === "media" &&
      (details?.mediaType === "audio" || details?.mediaType === "video");
  });

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isAppMainFrame(webContents, details?.securityOrigin)) {
      callback(false);
      return;
    }

    if (permission === "display-capture") {
      const requestedTypes = details?.mediaTypes;
      callback(
        pendingCaptures.has(webContents.id) &&
          (!Array.isArray(requestedTypes) || requestedTypes.includes("video"))
      );
      return;
    }

    const requestedTypes = details?.mediaTypes;
    callback(
      permission === "media" &&
        Array.isArray(requestedTypes) &&
        requestedTypes.length > 0 &&
        requestedTypes.every((type) => type === "audio" || type === "video")
    );
  });

  session.setDisplayMediaRequestHandler(async (request, callback) => {
    const mainWindow = getMainWindow();
    const capture = pendingCaptures.get(mainWindow?.webContents.id);
    if (
      !capture ||
      request.frame !== mainWindow?.webContents.mainFrame ||
      !request.securityOrigin?.startsWith("file://")
    ) {
      callback(null);
      return;
    }

    try {
      const source = (await getScreenSources()).find(({ id }) => id === capture.screenId);
      if (!source) {
        callback(null);
        return;
      }

      callback({
        video: source,
        ...(capture.includeSystemAudio &&
        request.audioRequested &&
        platform === "win32"
          ? { audio: "loopback" }
          : {})
      });
    } catch (error) {
      logger.error("Could not provide the selected screen for capture:", error);
      callback(null);
    }
  }, { useSystemPicker: false });
}

module.exports = { registerCapturePermissions };
