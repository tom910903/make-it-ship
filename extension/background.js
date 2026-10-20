// Make It Ship side panel: the toolbar icon opens it. Messages go to chrome.storage.local "inbox"; `mis browse inbox`
// reads them over the DevTools pipe. Nothing is sent to any server.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'pick') return;
  addToInbox({ type: 'pick', selector: String(msg.selector).slice(0, 500), text: String(msg.text ?? '').slice(0, 200), url: sender.tab?.url ?? msg.url });
});

async function addToInbox(m) {
  const { inbox = [] } = await chrome.storage.local.get('inbox');
  inbox.push({ ...m, at: new Date().toISOString() });
  await chrome.storage.local.set({ inbox: inbox.slice(-200) });
}
