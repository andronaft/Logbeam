import { openFile, openViewer } from '../content/logViewer';
import { loadSettings } from '../shared/settings';
import { applyTheme } from '../shared/theme';
import { readViewerText } from '../shared/viewerTabs';

/**
 * viewer.html: the log viewer for text that isn't on a web page. With ?id= it shows text pasted
 * into the popup; without, it asks for a file (plain or .gz) or pasted text.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function start(): Promise<void> {
  applyTheme((await loadSettings()).theme);
  const id = new URLSearchParams(location.search).get('id');
  const stored = id ? await readViewerText(id) : null;
  if (stored) {
    await openViewer(stored.text, stored.name);
    return;
  }

  $('start').hidden = false;
  const drop = $('drop');
  const file = $<HTMLInputElement>('file');
  const paste = $<HTMLTextAreaElement>('paste');
  const open = $<HTMLButtonElement>('open');
  const openChosen = (chosen: File | undefined) => {
    if (chosen) void openFile(chosen).catch((error) => alert(`Couldn’t open ${chosen.name}: ${(error as Error).message}`));
  };

  file.addEventListener('change', () => openChosen(file.files?.[0]));
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  // a file dropped next to the drop area must not make the browser navigate to it
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    openChosen(event.dataTransfer?.files[0]);
  });
  paste.addEventListener('input', () => (open.disabled = !paste.value.trim()));
  open.addEventListener('click', () => void openViewer(paste.value, 'Pasted log'));
  paste.focus();
}

void start();
