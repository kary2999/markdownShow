"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFilemanager(overrides) {
  const alerts = [];
  const toggleButton = { addEventListener: function () {} };
  const window = Object.assign(
    {
      MDVFileTreeCore: {},
      alert: function (message) {
        alerts.push(message);
      },
    },
    overrides
  );
  const document = {
    readyState: "complete",
    getElementById: function () {
      return toggleButton;
    },
  };
  const filename = path.join(__dirname, "..", "filemanager.js");
  let source = fs.readFileSync(filename, "utf8");
  source = source.replace(
    /\}\)\(\);\s*$/,
    "window.__filemanagerTest = { existsEntry: existsEntry, openWorkspace: openWorkspace };\n})();"
  );
  vm.runInNewContext(source, { window: window, document: document, indexedDB: window.indexedDB });
  return { api: window.__filemanagerTest, alerts: alerts };
}

function namedError(name, message) {
  const error = new Error(message || name);
  error.name = name;
  return error;
}

test("existsEntry treats a TypeMismatchError as an existing directory", async () => {
  let directoryLookups = 0;
  const { api } = loadFilemanager();
  const dirHandle = {
    getFileHandle: function () {
      return Promise.reject(namedError("TypeMismatchError"));
    },
    getDirectoryHandle: function () {
      directoryLookups++;
      return Promise.resolve({});
    },
  };

  assert.equal(await api.existsEntry(dirHandle, "docs"), true);
  assert.equal(directoryLookups, 0);
});

test("existsEntry propagates lookup errors that are not NotFoundError", async () => {
  let directoryLookups = 0;
  const denied = namedError("NotAllowedError", "permission denied");
  const { api } = loadFilemanager();
  const dirHandle = {
    getFileHandle: function () {
      return Promise.reject(denied);
    },
    getDirectoryHandle: function () {
      directoryLookups++;
      return Promise.resolve({});
    },
  };

  await assert.rejects(api.existsEntry(dirHandle, "notes.md"), denied);
  assert.equal(directoryLookups, 0);
});

test("openWorkspace ignores AbortError but reports other picker errors", async () => {
  let pickerError = namedError("AbortError");
  const loaded = loadFilemanager({
    showDirectoryPicker: function () {
      return Promise.reject(pickerError);
    },
  });

  await loaded.api.openWorkspace();
  assert.deepEqual(loaded.alerts, []);

  pickerError = namedError("NotAllowedError", "permission denied");
  await loaded.api.openWorkspace();
  assert.deepEqual(loaded.alerts, [
    "打开文件夹失败（NotAllowedError）：permission denied。若系统未弹出选择框，请改用独立浏览器窗口打开本应用。",
  ]);
});

test("openWorkspace surfaces a synchronous picker exception with guidance", async () => {
  const loaded = loadFilemanager({
    showDirectoryPicker: function () {
      throw namedError("SecurityError", "must be handling a user gesture");
    },
  });
  await loaded.api.openWorkspace();
  assert.equal(loaded.alerts.length, 1);
  assert.match(loaded.alerts[0], /SecurityError/);
  assert.match(loaded.alerts[0], /独立浏览器窗口/);
});