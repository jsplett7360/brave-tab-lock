// Tab Lock — service worker entry. Wires chrome.* events to the controller.
// Listeners are registered synchronously at top level (MV3 requirement) so events that
// wake the worker are delivered.

import { createController } from './controller.js';

const c = createController(chrome);
const ready = c.init().catch((e) => console.error('Tab Lock init failed', e));
const after = (fn) => (...args) => { ready.then(() => fn(...args)).catch((e) => console.error('Tab Lock', e)); };

chrome.runtime.onStartup.addListener(after(c.onStartup));
chrome.runtime.onInstalled.addListener(after(c.onInstalled));
chrome.runtime.onUpdateAvailable.addListener(after(c.onUpdateAvailable)); // installs once unlocked
chrome.tabs.onCreated.addListener(after(c.onTabCreated));
chrome.tabs.onUpdated.addListener(after(c.onTabUpdated));
chrome.tabs.onRemoved.addListener(after(c.onTabRemoved));
chrome.windows.onFocusChanged.addListener(after(c.onFocusChanged));
chrome.idle.onStateChanged.addListener(after(c.onIdleState));
chrome.alarms.onAlarm.addListener(after(c.onAlarm));
chrome.action.onClicked.addListener(after(c.onActionClicked));
chrome.commands.onCommand.addListener(after(c.onCommand));
chrome.storage.onChanged.addListener(after(c.onStorageChanged)); // master PIN policy arriving
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ready
    .then(() => c.onMessage(msg, sender))
    .then(sendResponse, (e) => sendResponse({ ok: false, error: 'internal', message: String(e?.message || e) }));
  return true; // async response
});
