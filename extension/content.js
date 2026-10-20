// Element picker: after "Pick element" in the side panel, the next click on the page is captured (not passed to the
// page) and its CSS selector goes to the inbox.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'start-pick') return;
  const onClick = (e) => {
    e.preventDefault(); e.stopPropagation();
    document.removeEventListener('click', onClick, true);
    chrome.runtime.sendMessage({ type: 'pick', selector: selectorOf(e.target), text: (e.target.innerText || '').trim(), url: location.href });
  };
  document.addEventListener('click', onClick, true);
});

function selectorOf(el) {
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && parts.length < 5; e = e.parentElement) {
    if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
    const same = [...(e.parentElement?.children ?? [])].filter((x) => x.tagName === e.tagName);
    parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''));
  }
  return parts.join(' > ');
}
