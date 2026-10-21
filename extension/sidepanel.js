const $ = (id) => document.getElementById(id);

async function render() {
  const { inbox = [] } = await chrome.storage.local.get('inbox');
  $('list').replaceChildren(...inbox.map((m) => {
    const li = document.createElement('li');
    li.textContent = m.type === 'pick' ? `picked ${m.selector}` : m.text;
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${m.url ?? ''} ${m.at}`;
    li.append(meta);
    return li;
  }));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

$('send').addEventListener('click', async () => {
  const text = $('note').value.trim();
  if (!text) return;
  const tab = await activeTab();
  const { inbox = [] } = await chrome.storage.local.get('inbox');
  inbox.push({ type: 'note', text: text.slice(0, 4000), url: tab?.url ?? null, at: new Date().toISOString() });
  await chrome.storage.local.set({ inbox: inbox.slice(-200) });
  $('note').value = '';
  $('status').textContent = 'Sent.';
});

$('pick').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'start-pick' }).then(() => { $('status').textContent = 'Click an element on the page.'; },
    () => { $('status').textContent = 'This page cannot be picked from (reload it, or open an http(s) page).'; });
});

chrome.storage.onChanged.addListener(render);
render();
