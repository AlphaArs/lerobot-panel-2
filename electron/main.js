const { app, BrowserWindow, dialog } = require("electron");

const START_URL = process.env.ELECTRON_START_URL || "http://localhost:3000";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win
    .loadURL(START_URL)
    .catch((err) => {
      dialog.showErrorBox("Failed to load UI", String(err));
    });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
