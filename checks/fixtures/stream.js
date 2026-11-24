import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

export function streamReply(model, context, options) {
  const messages = context.messages;
  const last = messages.at(-1);
  const input = JSON.stringify(last.content);
  const slow = input.includes('long response');
  const brief = input.includes('brief pause');
  const core = createFauxCore({ tokensPerSecond: slow ? 10 : brief ? 100 : 1000 });
  let response;
  if (last.content?.some(block => block.type === 'image')) {
    response = fauxAssistantMessage('The screenshot illustrates **this equation**: $x^2$.');
  } else if (input.includes('ask for clarification') && last.role === 'user') {
    response = fauxAssistantMessage(fauxToolCall('ask_reader', { question: 'Which paragraph?' }), { stopReason: 'toolUse' });
  } else if (input.includes('Delegate a reading task') && last.role === 'user') {
    response = fauxAssistantMessage(fauxToolCall('delegate', { task: 'Read the passage independently' }), { stopReason: 'toolUse' });
  } else if (input.includes('save a note') && last.role === 'user') {
    response = fauxAssistantMessage(fauxToolCall('write_page_note', { name: 'outline', text: 'Notes about this passage.' }), { stopReason: 'toolUse' });
  } else {
    const snapshotCount = messages.filter(message => message.content?.[0]?.text?.startsWith('{"sourceDocument":')).length;
    response = fauxAssistantMessage(slow ? 'Streaming passage discussion. '.repeat(200) : brief ? 'Reading paragraph. '.repeat(25) : 'Answer with ' + snapshotCount + ' document snapshot(s).');
  }
  core.setResponses([response]);
  return core.streamSimple(core.getModel(), context, options);
}
