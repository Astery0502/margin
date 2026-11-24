export const nativeHost = 'dev.margin.connect';

export async function nativeRequest(op) {
  const reply = await chrome.runtime.sendNativeMessage(nativeHost, { op });
  if (reply.error) throw new Error(reply.error);
  return reply;
}

export function hostMissing(error) {
  return /native messaging host not found/i.test(error.message);
}
