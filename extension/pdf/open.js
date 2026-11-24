import { documentUrlForReader } from './urls.js';

const documentUrl = documentUrlForReader(location.href);
if (!documentUrl) {
  document.body.replaceChildren(document.createTextNode('Open a PDF from a website or local file to start reading.'));
} else {
  await import('./reader.js');
}
