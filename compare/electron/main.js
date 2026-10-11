// Electron baseline: same window size and scene as examples/bench.tsx (SCENE=dashboard: examples/dashboard.tsx).
const { app, BrowserWindow, Menu } = require("electron");
const path = require("node:path");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // no menu bar: same content area as nodebuilder
  const dashboard = process.env.SCENE === "dashboard";
  const win = new BrowserWindow({
    width: dashboard ? 1200 : 1000, height: dashboard ? 800 : 720, title: "Bench (Electron)", backgroundColor: "#fafafa",
  });
  win.webContents.on("console-message", (event) => {
    if (event.message.startsWith("fps")) console.log(event.message);
  });
  const env = process.env;
  win.loadFile(path.join(__dirname, dashboard ? "dashboard.html" : "index.html"), {
    query: {
      N: env.N ?? "1000", MODE: env.MODE ?? "one", MAX_FPS: env.NB_MAX_FPS ?? "120",
      TAB: env.TAB ?? "overview", ROWS: env.ROWS ?? "500", LIVE: env.LIVE ?? "1", CYCLE: env.CYCLE ?? "0",
    },
  });
});
app.on("window-all-closed", () => app.quit());
