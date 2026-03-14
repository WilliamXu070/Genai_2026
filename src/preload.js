const { contextBridge, ipcRenderer } = require("electron");
const path = require("node:path");
const packageJson = require(path.join(__dirname, "..", "package.json"));

contextBridge.exposeInMainWorld("appInfo", {
  name: "Jungle",
  version: packageJson.version
});

contextBridge.exposeInMainWorld("terminalApi", {
  createSession: () => ipcRenderer.invoke("terminal:create"),
  onData: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("terminal:data", listener);

    return () => {
      ipcRenderer.removeListener("terminal:data", listener);
    };
  },
  onExit: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);

    return () => {
      ipcRenderer.removeListener("terminal:exit", listener);
    };
  },
  sendInput: (sessionId, data) => {
    ipcRenderer.send("terminal:input", { data, sessionId });
  }
});

contextBridge.exposeInMainWorld("jungleApi", {
  getTodoBlueprint: () => ipcRenderer.invoke("jungle:get-todo-blueprint"),
  listRuns: () => ipcRenderer.invoke("jungle:list-runs"),
  onRunEvent: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("jungle:run-event", listener);

    return () => {
      ipcRenderer.removeListener("jungle:run-event", listener);
    };
  },
  startRun: (payload) => ipcRenderer.invoke("jungle:start-run", payload),
  runOperationalExample: () => ipcRenderer.invoke("jungle:run-operational-example")
});
