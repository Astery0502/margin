const allow = document.querySelector('#allow');
const status = document.querySelector('#status');
const sessionId = new URL(location.href).searchParams.get('sessionId');
let ended = false;
if (!sessionId) allow.textContent = 'Allow microphone';
window.addEventListener('pagehide', () => { ended = true; });
allow.addEventListener('click', async () => {
  allow.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    if (ended) return;
    if (sessionId) {
      const response = await chrome.runtime.sendMessage({ type: 'pi-dictation', action: 'start', sessionId });
      if (response.error) throw new Error(response.error);
      if (response.result.error) throw new Error(response.result.error);
    }
    window.close();
  } catch (error) {
    status.textContent = `Microphone: ${error.message}`;
    allow.disabled = false;
  }
});
document.querySelector('#cancel').addEventListener('click', async () => {
  ended = true;
  if (sessionId) await chrome.runtime.sendMessage({ type: 'pi-dictation', action: 'cancel', sessionId });
  window.close();
});
