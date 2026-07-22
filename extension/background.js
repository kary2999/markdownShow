/* Toolbar icon opens the viewer page (path input / drag & drop). */
chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});
