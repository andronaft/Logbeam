import { maskSecrets, setCustomSecretPatterns } from '../lib/secrets';
import { TRANSFORMS } from '../lib/transforms';
import { openShortcutSettings } from '../shared/browser';
import { CustomSecret, Settings, loadSettings, saveSettings } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gap = $<HTMLInputElement>('gap');
const patternsEl = $('patterns');
const problems = $('problems');
const test = $<HTMLInputElement>('test');
const testResult = $('test-result');
const saved = $('saved');

let settings: Settings;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings(settings);
    saved.textContent = 'Saved ✓';
    setTimeout(() => (saved.textContent = ''), 1500);
  }, 300);
}

function checkPatterns(): void {
  problems.textContent = setCustomSecretPatterns(settings.customSecrets).join('\n');
  testResult.textContent = test.value ? maskSecrets(test.value) : '';
}

function renderPatterns(): void {
  patternsEl.replaceChildren(
    ...settings.customSecrets.map((custom: CustomSecret, i) => {
      const name = el('input', { type: 'text', value: custom.name, placeholder: 'Name, e.g. Acme token' });
      const pattern = el('input', { type: 'text', value: custom.pattern, placeholder: 'Regular expression', spellcheck: false });
      const remove = el('button', { title: 'Remove' }, '×');
      name.addEventListener('input', () => {
        custom.name = name.value;
        checkPatterns();
        save();
      });
      pattern.addEventListener('input', () => {
        custom.pattern = pattern.value;
        checkPatterns();
        save();
      });
      remove.addEventListener('click', () => {
        settings.customSecrets.splice(i, 1);
        renderPatterns();
        checkPatterns();
        save();
      });
      return el('div', { className: 'pattern' }, name, pattern, remove);
    }),
  );
}

function renderTools(): void {
  $('tools').replaceChildren(
    ...TRANSFORMS.map((transform) => {
      const box = el('input', { type: 'checkbox', checked: !settings.hiddenTools.includes(transform.id) });
      box.addEventListener('change', () => {
        settings.hiddenTools = box.checked
          ? settings.hiddenTools.filter((id) => id !== transform.id)
          : [...settings.hiddenTools, transform.id];
        save();
      });
      return el('label', {}, box, transform.title);
    }),
  );
}

async function start(): Promise<void> {
  settings = await loadSettings();
  gap.value = String(settings.gapThresholdMs / 1000);
  gap.addEventListener('input', () => {
    const seconds = Number(gap.value);
    if (!(seconds > 0)) return;
    settings.gapThresholdMs = Math.round(seconds * 1000);
    save();
  });
  $('add-pattern').addEventListener('click', () => {
    settings.customSecrets.push({ name: '', pattern: '' });
    renderPatterns();
    (patternsEl.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
  });
  test.addEventListener('input', checkPatterns);
  $('shortcuts').addEventListener('click', (event) => {
    event.preventDefault();
    void openShortcutSettings();
  });
  renderPatterns();
  renderTools();
  checkPatterns();
}

void start();
