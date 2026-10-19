export const format = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
if (typeof document !== 'undefined') {
  let left = 25 * 60;
  let timer = null;
  document.getElementById('start').addEventListener('click', () => {
    if (timer) return;
    timer = setInterval(() => { left = Math.max(0, left - 1); document.getElementById('time').textContent = format(left); }, 1000);
  });
}
