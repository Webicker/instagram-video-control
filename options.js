const provider = document.getElementById('provider');
const key = document.getElementById('key');
const model = document.getElementById('model');
const language = document.getElementById('language');
const status = document.getElementById('status');

for (const [id, p] of Object.entries(PROVIDERS)) {
  provider.append(new Option(p.label, id));
}

const hint = () => (model.placeholder = PROVIDERS[provider.value].model);
provider.addEventListener('change', hint);

browser.storage.local.get(['provider', 'key', 'model', 'language']).then(c => {
  provider.value = PROVIDERS[c.provider] ? c.provider : 'groq';
  key.value = c.key || '';
  model.value = c.model || '';
  language.value = c.language === undefined ? 'pt' : c.language;
  hint();
});

document.getElementById('save').addEventListener('click', async () => {
  await browser.storage.local.set({
    provider: provider.value,
    key: key.value.trim(),
    model: model.value.trim(),
    language: language.value.trim()
  });
  status.textContent = 'Salvo.';
  setTimeout(() => (status.textContent = ''), 2000);
});
