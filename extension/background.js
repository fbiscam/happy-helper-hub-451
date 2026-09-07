chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "jenvu-toggle-float" });
  } catch {
    // Content script can't run here (chrome:// pages, web store) — fall back to the side panel.
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {}
  }
});
