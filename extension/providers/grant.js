import { nativeRequest, hostMissing } from './native.js';

export async function account() {
  try {
    const result = await nativeRequest('models');
    return result.connected ? result : null;
  } catch (error) {
    if (hostMissing(error)) return null;
    throw error;
  }
}

export async function accountGeneration() {
  const status = await nativeRequest('status');
  if (!status.connected) throw new Error('Reconnect your ChatGPT account before sending.');
  return status.generation;
}
