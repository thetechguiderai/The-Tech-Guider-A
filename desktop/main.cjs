const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

let server;

function waitForServer(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const tryConnect = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error("The local server did not start."));
        else setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

async function createWindow() {
  const port = 3199;
  const serverFile = path.join(app.getAppPath(), "Server", "server.js");
  server = spawn(process.execPath, [serverFile], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      NODE_ENV: "production",
      DATABASE_PATH: path.join(app.getPath("userData"), "tech-guider.db")
    },
    stdio: "ignore",
    windowsHide: true
  });
  try {
    await waitForServer(port);
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 980,
      minHeight: 640,
      title: "The Tech Guider AI",
      icon: path.join(app.getAppPath(), "Public", "logo.png"),
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    await window.loadURL(`http://127.0.0.1:${port}`);
  } catch (error) {
    dialog.showErrorBox("Unable to start The Tech Guider AI", error.message);
    app.quit();
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (server) server.kill(); });
