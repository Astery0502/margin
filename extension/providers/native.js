export const nativeHost = 'dev.margin.connect';

export const outdatedHost = error => error.message === 'Unsupported Margin Connect operation.';

export function nativeCommand(op, fields) {
  return { ...fields, op: op === 'capabilities' ? op : 'v2-' + op };
}

export async function nativeRequest(op, fields) {
  const reply = await chrome.runtime.sendNativeMessage(nativeHost, nativeCommand(op, fields));
  if (reply.error) throw new Error(reply.error);
  return reply;
}

export function hostMissing(error) {
  return /native messaging host not found/i.test(error.message);
}
