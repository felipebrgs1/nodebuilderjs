// Electron baseline: same window size and scene as examples/bench.tsx.
const { app, BrowserWindow, Menu } = require("electron");
const path = require("node:path");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // no menu bar: same content area as nodebuilder
  const win = new BrowserWindow({ width: 1000, height: 720, title: "Bench (Electron)", backgroundColor: "#fafafa" });
  win.webContents.on("console-message", (event) => {
    if (event.message.startsWith("fps")) console.log(event.message);
  });
  win.loadFile(path.join(__dirname, "index.html"), {
    query: { N: process.env.N ?? "1000", MODE: process.env.MODE ?? "one", MAX_FPS: process.env.NB_MAX_FPS ?? "120" },
  });
});
app.on("window-all-closed", () => app.quit());
