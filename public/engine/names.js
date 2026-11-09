// Pure helpers that infer human-readable names from identifiers, icons, URLs and file names.

const ICONS = [
  [/\b(search|magnif\w*|loupe)\b/, 'Search'],
  [/\b(close|times|x|x-?mark|x-lg|dismiss|cancel)\b/, 'Close'],
  [/\b(menu|bars|hamburger|burger|navicon|list|grid-menu)\b/, 'Menu'],
  [/\b(exchange|exchange-alt|swap|arrows-alt-h|switch)\b/, 'Swap'],
  [/\b(home|house)\b/, 'Home'],
  [/\b(cart|basket|bag|shopping)\b/, 'Shopping cart'],
  [/\b(user|account|profile|avatar|person)\b/, 'Account'],
  [/\b(heart|fav\w*|like|wishlist)\b/, 'Add to favorites'],
  [/\b(share|share-alt)\b/, 'Share'],
  [/\b(x-twitter|twitter)\b/, 'Twitter'],
  [/\bfacebook\w*\b/, 'Facebook'],
  [/\binstagram\b/, 'Instagram'],
  [/\blinkedin\w*\b/, 'LinkedIn'],
  [/\byoutube\b/, 'YouTube'],
  [/\bgithub\b/, 'GitHub'],
  [/\btiktok\b/, 'TikTok'],
  [/\bwhatsapp\b/, 'WhatsApp'],
  [/\b(envelope|email|mail|inbox)\b/, 'Email'],
  [/\b(phone|call|telephone)\b/, 'Call'],
  [/\bprint\w*\b/, 'Print'],
  [/\bdownload\b/, 'Download'],
  [/\bupload\b/, 'Upload'],
  [/\b(edit|pencil|pen)\b/, 'Edit'],
  [/\b(trash|delete|bin|remove)\b/, 'Delete'],
  [/\b(gear|cog|settings|preferences)\b/, 'Settings'],
  [/\b(bell|notification\w*|alert\w*)\b/, 'Notifications'],
  [/\bplay\b/, 'Play'],
  [/\bpause\b/, 'Pause'],
  [/\b(next|forward|chevron-right|arrow-right|angle-right|caret-right)\b/, 'Next'],
  [/\b(prev|previous|back|chevron-left|arrow-left|angle-left|caret-left)\b/, 'Previous'],
  [/\b(chevron-down|arrow-down|angle-down|caret-down|carrot-down|expand)\b/, 'Expand'],
  [/\b(chevron-up|arrow-up|angle-up|caret-up|collapse)\b/, 'Collapse'],
  [/\b(plus|add)\b/, 'Add'],
  [/\bminus\b/, 'Decrease'],
  [/\b(info|information)\b/, 'More information'],
  [/\b(help|question)\b/, 'Help'],
  [/\b(calendar|date)\b/, 'Choose date'],
  [/\b(map-marker|location|pin|map)\b/, 'Location'],
  [/\b(filter|funnel)\b/, 'Filter'],
  [/\bsort\b/, 'Sort'],
  [/\b(refresh|reload|sync|redo)\b/, 'Refresh'],
  [/\b(ellipsis|more|dots|kebab)\b/, 'More options'],
  [/\b(sign-?out|log-?out|logout)\b/, 'Sign out'],
  [/\b(sign-?in|log-?in|login)\b/, 'Sign in'],
  [/\b(camera|photo)\b/, 'Take photo'],
  [/\b(microphone|mic)\b/, 'Voice input'],
  [/\b(volume-mute|mute)\b/, 'Mute'],
  [/\b(volume|sound|speaker)\b/, 'Volume'],
  [/\b(fullscreen|maximize)\b/, 'Full screen'],
  [/\b(copy|clipboard)\b/, 'Copy'],
  [/\b(globe|language|translate)\b/, 'Change language'],
  [/\b(send|paper-plane)\b/, 'Send'],
  [/\b(attach|paperclip)\b/, 'Attach file'],
  [/\bbookmark\b/, 'Bookmark'],
  [/\bstar\b/, 'Rate'],
  [/\b(check|tick)\b/, 'Confirm'],
  [/\b(chat|comment\w*|message\w*)\b/, 'Chat'],
];

/** Guess an action label from icon-ish tokens (class names, ids, sprite refs, file names). */
export function iconLabel(tokens) {
  const hay = ' ' + (Array.isArray(tokens) ? tokens.join(' ') : String(tokens || ''))
    .toLowerCase().replace(/[_.#/]+/g, ' ').replace(/\b(fa|fas|far|fab|bi|icon|icons|ico|glyphicon|material-icons|mdi|ti|ri|svg|btn|button)-/g, ' ') + ' ';
  for (const [re, label] of ICONS) if (re.test(hay)) return label;
  return null;
}

const STOP = new Set(['input', 'field', 'txt', 'text', 'fld', 'frm', 'form', 'id', 'ctl', 'ctl00', 'val', 'value', 'box', 'el', 'elem', 'inp']);
const ABBR = { dob: 'Date of birth', ssn: 'Social Security number', zip: 'ZIP code', tel: 'Phone', addr: 'Address', fname: 'First name', lname: 'Last name', qty: 'Quantity', pwd: 'Password', pw: 'Password', pass: 'Password', msg: 'Message', num: 'Number', dept: 'Department', apt: 'Apartment' };

/** "first_name" / "firstName" / "txtFirstName" -> "First name". Returns null for meaningless ids. */
export function humanizeIdentifier(id) {
  if (!id) return null;
  let s = String(id).replace(/\[\]$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.:\[\]]+/g, ' ').toLowerCase().trim();
  if (ABBR[s.replace(/\s/g, '')]) return ABBR[s.replace(/\s/g, '')];
  const words = s.split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w)).map(w => (ABBR[w] ? ABBR[w].toLowerCase() : w));
  if (!words.length) return null;
  // Reject hash-like or auto-generated identifiers (e.g. "a8f3k2", "react-select-3-input").
  const SHORT_WORDS = new Set(['to', 'from', 'at', 'by', 'on', 'in', 'of', 'up', 'age']);
  if (words.every(w => w.length <= 2 && !SHORT_WORDS.has(w)) || words.some(w => /\d/.test(w) && /[a-z]/.test(w) && w.length > 4)) return null;
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const SITES = { 'twitter.com': 'Twitter', 'x.com': 'X (Twitter)', 'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'linkedin.com': 'LinkedIn', 'youtube.com': 'YouTube', 'github.com': 'GitHub', 'tiktok.com': 'TikTok', 'wa.me': 'WhatsApp', 'pinterest.com': 'Pinterest', 'reddit.com': 'Reddit' };

/** Derive a link purpose from its href. */
export function labelFromHref(href) {
  if (!href) return null;
  const h = String(href).trim();
  if (/^mailto:/i.test(h)) return 'Email ' + decodeURIComponent(h.slice(7).split('?')[0]);
  if (/^tel:/i.test(h)) return 'Call ' + h.slice(4);
  if (/^(#|javascript:)/i.test(h)) {
    const frag = h.startsWith('#') ? humanizeIdentifier(h.slice(1)) : null;
    return frag;
  }
  try {
    const u = new URL(h, 'https://relative.invalid/');
    const host = u.hostname.replace(/^www\./, '');
    if (u.hostname !== 'relative.invalid') {
      for (const k in SITES) if (host === k || host.endsWith('.' + k)) return SITES[k];
    }
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) {
      const name = humanizeIdentifier(seg.replace(/\.(html?|php|aspx?|jsp|pdf|docx?|xlsx?|pptx?)$/i, ''));
      if (name) return name;
    }
    if (u.hostname !== 'relative.invalid') return host;
    if (u.pathname === '/') return 'Home';
  } catch { /* ignore */ }
  return null;
}

const GENERIC_FILE = /^(img|image|images|photo|pic|picture|dsc|dscn|screenshot|untitled|banner|hero|thumb|thumbnail|file|download|asset|unnamed|teaser|header|nav|navigation|btn|button|menu|link|icon|ico|graphic|gfx|\d+)$/;
const POSITION = /^((left|right|top|bottom|middle|mid|center|centre|start|end|begin|inner|outer)\d*|[a-z]|\d+[a-z]?|[a-z]\d+)$/;
const LAYOUT = /^(border|borders|corner|corners|edge|bg|background|back|shadow|spacer|space|line|lines|rule|hr|bullet|bullets|marker\d*|mark|divider|separator|sep|gradient|grad|frame|slice|filler|fill|pixel|px|blank|shim|transparent|trans|clear|dot|dots|ornament|decor|decoration|decorative|curve|cap|round|rounded|stripe|pattern|texture|tile|box)$/;

/** Words of an image file name ("/img/border_left-top@2x.gif" -> ["border", "left", "top"]). */
export function fileWords(src) {
  if (!src || /^data:/i.test(src)) return [];
  let name;
  try { name = new URL(src, 'https://relative.invalid/').pathname.split('/').pop(); } catch { return []; }
  name = decodeURIComponent(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/@\dx$/i, '');
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-+.]+/).filter(Boolean).map(w => w.toLowerCase());
}

/** True when an image's file name / class says it is page furniture (borders, slices, bullets, spacers). */
export function looksDecorative(src, cls = '') {
  const words = [...fileWords(src), ...String(cls || '').toLowerCase().split(/[\s_\-]+/).filter(Boolean)];
  if (!words.length || !words.some(w => LAYOUT.test(w))) return false;
  return words.every(w => LAYOUT.test(w) || POSITION.test(w) || GENERIC_FILE.test(w));
}

/** "/img/team-photo_2024@2x.jpg" -> "Team photo 2024". Null when the name carries no meaning. */
export function altFromFilename(src) {
  if (!src || /^data:/i.test(src)) return null;
  let name;
  try { name = new URL(src, 'https://relative.invalid/').pathname.split('/').pop(); } catch { return null; }
  name = decodeURIComponent(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/@\dx$/i, '');
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-+.]+/).filter(Boolean);
  const noise = w => GENERIC_FILE.test(w.toLowerCase()) || POSITION.test(w.toLowerCase()) || LAYOUT.test(w.toLowerCase()) || /^[0-9a-f]{8,}$/i.test(w) || /^(\d+x\d+|v\d+|final|copy|edit|min|small|large|lg|sm|md|new|old|on|off|over|hover|active|normal)$/i.test(w);
  const meaningful = words.filter(w => !noise(w) && /[a-z]{3,}/i.test(w));
  if (!meaningful.length) return null;
  const out = meaningful.join(' ').toLowerCase();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const VAGUE = /^(click here|click|here|read more|learn more|more|more info|more information|details|link|this|go|continue|view|see more|find out more|this link)$/i;
export function isVagueLinkText(text) {
  return VAGUE.test(String(text || '').replace(/[\s»›→.…>]+$/g, '').replace(/\s+/g, ' ').trim());
}

/** Map a field's identifiers/label to an HTML autocomplete token (WCAG 1.3.5). */
export function autocompleteToken(hay, type) {
  const s = ' ' + String(hay || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') + ' ';
  if (type === 'email' || /\be ?mail\b/.test(s)) return 'email';
  if (type === 'tel' || /\b(phone|tel|mobile|cell)\b/.test(s)) return 'tel';
  if (type === 'password') return /\b(new|confirm|repeat)\b/.test(s) ? 'new-password' : 'current-password';
  if (/\b(first ?name|given ?name|fname|forename)\b/.test(s)) return 'given-name';
  if (/\b(last ?name|family ?name|surname|lname)\b/.test(s)) return 'family-name';
  if (/\b(full ?name|your name)\b/.test(s) || /^\s*name\s*\*?\s*$/.test(s)) return 'name';
  if (/\b(user ?name|login|user ?id)\b/.test(s)) return 'username';
  if (/\b(zip|postal|post ?code|postcode)\b/.test(s)) return 'postal-code';
  if (/\b(street|address ?line ?1|address 1|address)\b/.test(s) && !/\b(email|ip|web)\b/.test(s)) return /\b(line ?2|address 2|apt|apartment|suite)\b/.test(s) ? 'address-line2' : 'street-address';
  if (/\b(city|town)\b/.test(s)) return 'address-level2';
  if (/\b(state|province|region)\b/.test(s)) return 'address-level1';
  if (/\bcountry\b/.test(s)) return 'country-name';
  if (/\b(birth|dob|birthday)\b/.test(s)) return 'bday';
  if (/\b(organi[sz]ation|company|employer)\b/.test(s)) return 'organization';
  return null;
}
