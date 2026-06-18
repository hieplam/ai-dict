/**
 * Builds the consent-prompt footer appended to the error card when buffered
 * errors cross a threshold. Returns a light-DOM element (projected through the
 * card slot) styled by class names the card's ::slotted() rules cover.
 * `onChoice` reports the user's decision; the caller relays it to the SW.
 */
export function buildConsentFooter(opts: {
  count: number;
  onChoice: (choice: 'granted' | 'declined') => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'errlog-consent';

  const text = document.createElement('p');
  text.className = 'errlog-consent-text';
  text.textContent = `Seen ${opts.count} errors recently. Send anonymous error reports to help fix them? No page content or keys are sent.`;
  wrap.appendChild(text);

  const row = document.createElement('div');
  row.className = 'errlog-consent-actions';

  const send = document.createElement('button');
  send.type = 'button';
  // Reuse the card's accent-button slotted styling for the primary action.
  send.className = 'setup-cta errlog-consent-send';
  send.textContent = 'Send reports';
  send.addEventListener('click', () => opts.onChoice('granted'));

  const not = document.createElement('button');
  not.type = 'button';
  not.className = 'errlog-consent-dismiss';
  not.textContent = 'Not now';
  not.addEventListener('click', () => opts.onChoice('declined'));

  row.append(send, not);
  wrap.appendChild(row);
  return wrap;
}
