import { dictationLanguage, saveDictationLanguage } from './language.js';

const select = document.getElementById('dictation-language');
const status = document.getElementById('dictation-status');

try {
  let saved = await dictationLanguage();
  select.value = saved;
  select.disabled = false;
  select.onchange = async () => {
    select.disabled = true;
    try {
      await saveDictationLanguage(select.value);
      saved = select.value;
      status.textContent = 'Dictation language saved.';
    } catch (error) {
      select.value = saved;
      status.textContent = error.message;
    } finally {
      select.disabled = false;
    }
  };
} catch (error) {
  status.textContent = error.message;
}
