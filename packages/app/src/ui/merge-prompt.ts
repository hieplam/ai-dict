/**
 * B14: the "add as a new sense?" merge prompt, appended on demand to the card/panel when a
 * saved.save reply comes back `type: 'saved.conflict'` (the headword is already saved under a
 * DIFFERENT sentence/url than the one just submitted — see the design spec §2.1/§2.4). Mirrors
 * error-consent.ts's buildConsentFooter: a light-DOM node appended via
 * InlineBottomSheetRenderer.appendToCard / SidePanelView.appendToFocus, never baked into
 * CardState/renderCardState, so the pure card-state renderer stays untouched.
 */
export function buildMergePrompt(opts: {
  word: string;
  senseCount: number;
  onChoice: (add: boolean) => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'merge-prompt';

  const text = document.createElement('p');
  text.className = 'merge-prompt-text';
  text.textContent =
    opts.senseCount === 1
      ? `You already saved "${opts.word}" from a different sentence. Add this as a new sense?`
      : `"${opts.word}" already has ${opts.senseCount} saved senses. Add this one too?`;
  wrap.appendChild(text);

  const row = document.createElement('div');
  row.className = 'merge-prompt-actions';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'merge-prompt-add';
  add.textContent = 'Add as new sense';
  add.addEventListener('click', () => opts.onChoice(true));

  const not = document.createElement('button');
  not.type = 'button';
  not.className = 'merge-prompt-dismiss';
  not.textContent = 'Not now';
  not.addEventListener('click', () => opts.onChoice(false));

  row.append(add, not);
  wrap.appendChild(row);
  return wrap;
}
