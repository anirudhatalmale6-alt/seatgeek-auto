// SeatGeek Auto Select - Background Service Worker

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "auto-select" && tab && tab.id) {
    console.log('[SeatGeek] Alt+S pressed, triggering auto-select');
    chrome.tabs.sendMessage(tab.id, { action: 'autoSelect' });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'autoSelect' });
  }
});

console.log('[SeatGeek] Background service worker loaded');
