// Runs the production main process with isolated credentials and exposes its real tray to tests.
const electron = require("electron");
electron.app.setPath("userData", process.env.RPA_UI_USER_DATA);
const setContextMenu = electron.Tray.prototype.setContextMenu;
electron.Tray.prototype.setContextMenu = function (menu) {
  globalThis.testTray = this;
  globalThis.testTrayMenu = menu;
  return setContextMenu.call(this, menu);
};
require("../../../out/main/main.js");
