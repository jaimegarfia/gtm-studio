// Pure calendar logic: date math, slot validation, calendar.json building and
// calendar.md rendering. No file system access here; see ../calendar.mjs.

export class CalendarError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalendarError';
  }
}

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const STATUSES = ['pending', 'created'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ---------- dates (all in UTC, formatted as YYYY-MM-DD) ---------- */

export function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) throw new CalendarError(`Invalid date "${iso}". Use YYYY-MM-DD.`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || formatDate(d) !== `${m[1]}-${m[2]}-${m[3]}`) {
    throw new CalendarError(`Invalid date "${iso}".`);
  }
  return d;
}

export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** The Monday strictly after the given date. */
export function nextMonday(iso) {
  const d = parseDate(iso);
  const day = d.getUTCDay();
  const delta = day === 0 ? 1 : 8 - day;
  return addDays(iso, delta);
}

/** The same date if it is a Monday, otherwise the next Monday. */
export function snapToMonday(iso) {
  const d = parseDate(iso);
  return d.getUTCDay() === 1 ? formatDate(d) : nextMonday(iso);
}

export function todayIso() {
  const now = new Date();
  return formatDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/* ---------- slots ---------- */

/**
 * Checks the slots Claude produced against the network spec.
 * @param {object} network
 * @param {Array<{week:number,slot:number,format:string,goal:string,topic:string,angle:string,slug:string}>} slots
 */
export function validateSlots(network, slots) {
  const { weeks, postsPerWeek } = network.cadence;
  const expected = weeks * postsPerWeek;
  if (!Array.isArray(slots)) throw new CalendarError('Slots must be a JSON array.');
  if (slots.length !== expected) {
    throw new CalendarError(`Expected ${expected} slots (${weeks} weeks x ${postsPerWeek} posts), got ${slots.length}.`);
  }
  const formats = Object.keys(network.formats);
  const goals = network.goals;
  const seen = new Set();
  const slugs = new Set();
  slots.forEach((s, i) => {
    const where = `slots[${i}]`;
    if (!Number.isInteger(s.week) || s.week < 1 || s.week > weeks) throw new CalendarError(`${where}: week must be 1..${weeks}.`);
    if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= postsPerWeek) throw new CalendarError(`${where}: slot must be 0..${postsPerWeek - 1}.`);
    const key = `${s.week}/${s.slot}`;
    if (seen.has(key)) throw new CalendarError(`${where}: duplicate position (week ${s.week}, slot ${s.slot}).`);
    seen.add(key);
    if (!formats.includes(s.format)) throw new CalendarError(`${where}: unknown format "${s.format}". Use one of: ${formats.join(', ')}.`);
    if (!goals.includes(s.goal)) throw new CalendarError(`${where}: unknown goal "${s.goal}". Use one of: ${goals.join(', ')}.`);
    if (!s.topic || typeof s.topic !== 'string') throw new CalendarError(`${where}: topic is required.`);
    if (!s.angle || typeof s.angle !== 'string') throw new CalendarError(`${where}: angle is required.`);
    if (!s.slug || !SLUG_RE.test(s.slug)) throw new CalendarError(`${where}: slug "${s.slug}" must be kebab-case (a-z, 0-9, hyphens).`);
    if (slugs.has(s.slug)) throw new CalendarError(`${where}: duplicate slug "${s.slug}".`);
    slugs.add(s.slug);
  });
  for (const f of formats) {
    if (!slots.some((s) => s.format === f)) throw new CalendarError(`No slot uses format "${f}". The calendar must mix every format.`);
  }
  for (const g of goals) {
    if (!slots.some((s) => s.goal === g)) throw new CalendarError(`No slot uses goal "${g}". The calendar must mix every goal.`);
  }
}

/* ---------- calendar.json ---------- */

/**
 * Builds the calendar object. `startDate` must be a Monday.
 */
export function buildCalendar({ network, slots, startDate, now = new Date().toISOString() }) {
  validateSlots(network, slots);
  const { days, time } = network.cadence;
  const monday = parseDate(startDate);
  if (monday.getUTCDay() !== 1) throw new CalendarError(`startDate ${startDate} is not a Monday.`);
  const ordered = [...slots].sort((a, b) => a.week - b.week || a.slot - b.slot);
  const posts = ordered.map((s) => {
    const dayName = days[s.slot] || days[days.length - 1];
    const offset = (DAY_INDEX[dayName] + 6) % 7; // days after Monday
    const date = addDays(startDate, (s.week - 1) * 7 + offset);
    const id = `${date}-${s.slug}`;
    return {
      id,
      date,
      time,
      week: s.week,
      format: s.format,
      goal: s.goal,
      topic: s.topic,
      angle: s.angle,
      slug: s.slug,
      status: 'pending',
      dir: `posts/${id}`,
    };
  });
  return { version: 1, network: network.id, generatedAt: now, startDate, posts };
}

export function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new CalendarError(`Unknown status "${status}". Use ${STATUSES.join(' or ')}.`);
}

/* ---------- calendar.md ---------- */

const LABELS = {
  en: {
    title: '{network} content calendar',
    intro: 'Four weeks starting on {start}. Times are local. Generated by GTM Studio; edit topics in calendar.json and run `/gtm-studio:create` to write the pending posts.',
    cols: ['Week', 'Date', 'Time', 'Format', 'Goal', 'Topic', 'Status'],
    formats: { carousel: 'Carousel', text: 'Text post', screenshot: 'Screenshot post' },
    goals: { problem: 'Problem awareness', product: 'Show the product', story: 'Build story', cta: 'Call to action' },
    status: { pending: 'Pending', created: 'Created' },
  },
  es: {
    title: 'Calendario de contenido para {network}',
    intro: 'Cuatro semanas a partir del {start}. Horas locales. Generado por GTM Studio; edita los temas en calendar.json y ejecuta `/gtm-studio:create` para crear las publicaciones pendientes.',
    cols: ['Semana', 'Fecha', 'Hora', 'Formato', 'Objetivo', 'Tema', 'Estado'],
    formats: { carousel: 'Carrusel', text: 'Solo texto', screenshot: 'Captura del producto' },
    goals: { problem: 'Dar a conocer el problema', product: 'Enseñar el producto', story: 'Historia de cómo se construyó', cta: 'Llamada a la acción' },
    status: { pending: 'Pendiente', created: 'Creado' },
  },
  pt: {
    title: 'Calendário de conteúdo para {network}',
    intro: 'Quatro semanas a partir de {start}. Horário local. Gerado pelo GTM Studio; edite os temas em calendar.json e execute `/gtm-studio:create` para criar as publicações pendentes.',
    cols: ['Semana', 'Data', 'Hora', 'Formato', 'Objetivo', 'Tema', 'Estado'],
    formats: { carousel: 'Carrossel', text: 'Só texto', screenshot: 'Captura do produto' },
    goals: { problem: 'Mostrar o problema', product: 'Mostrar o produto', story: 'História de como foi construído', cta: 'Chamada para ação' },
    status: { pending: 'Pendente', created: 'Criado' },
  },
  fr: {
    title: 'Calendrier de contenu {network}',
    intro: 'Quatre semaines à partir du {start}. Heures locales. Généré par GTM Studio ; modifiez les sujets dans calendar.json et lancez `/gtm-studio:create` pour créer les publications en attente.',
    cols: ['Semaine', 'Date', 'Heure', 'Format', 'Objectif', 'Sujet', 'Statut'],
    formats: { carousel: 'Carrousel', text: 'Texte seul', screenshot: "Capture d'écran" },
    goals: { problem: 'Faire connaître le problème', product: 'Montrer le produit', story: 'Histoire de la construction', cta: "Appel à l'action" },
    status: { pending: 'En attente', created: 'Créé' },
  },
  de: {
    title: '{network} Content-Kalender',
    intro: 'Vier Wochen ab dem {start}. Ortszeit. Erstellt von GTM Studio; Themen in calendar.json anpassen und `/gtm-studio:create` ausführen, um offene Beiträge zu erstellen.',
    cols: ['Woche', 'Datum', 'Uhrzeit', 'Format', 'Ziel', 'Thema', 'Status'],
    formats: { carousel: 'Karussell', text: 'Nur Text', screenshot: 'Produkt-Screenshot' },
    goals: { problem: 'Problem sichtbar machen', product: 'Produkt zeigen', story: 'Entstehungsgeschichte', cta: 'Handlungsaufforderung' },
    status: { pending: 'Offen', created: 'Erstellt' },
  },
  it: {
    title: 'Calendario dei contenuti per {network}',
    intro: 'Quattro settimane a partire dal {start}. Ora locale. Generato da GTM Studio; modifica i temi in calendar.json ed esegui `/gtm-studio:create` per creare i post in sospeso.',
    cols: ['Settimana', 'Data', 'Ora', 'Formato', 'Obiettivo', 'Tema', 'Stato'],
    formats: { carousel: 'Carosello', text: 'Solo testo', screenshot: 'Screenshot del prodotto' },
    goals: { problem: 'Far conoscere il problema', product: 'Mostrare il prodotto', story: 'Storia di come è nato', cta: 'Invito all’azione' },
    status: { pending: 'In sospeso', created: 'Creato' },
  },
};

const PAGE_LABELS = {
  en: { subtitle: 'Nothing here is published automatically. Open a post, copy its text and follow the checklist.', created: 'created', pending: 'pending', post: 'Post', images: 'Images', checklist: 'Checklist', copy: 'Copy text', copied: 'Copied', pendingText: 'This post has not been written yet. Run /gtm-studio:create in Claude Code.', openPdf: 'Open carousel.pdf', openImage: 'Open full size', folder: 'Folder', noImages: 'This post has no images.', week: 'Week', close: 'Close', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  es: { subtitle: 'Nada se publica automáticamente. Abre una publicación, copia el texto y sigue el checklist.', created: 'creadas', pending: 'pendientes', post: 'Texto', images: 'Imágenes', checklist: 'Checklist', copy: 'Copiar texto', copied: 'Copiado', pendingText: 'Esta publicación aún no se ha creado. Ejecuta /gtm-studio:create en Claude Code.', openPdf: 'Abrir carousel.pdf', openImage: 'Ver a tamaño completo', folder: 'Carpeta', noImages: 'Esta publicación no lleva imágenes.', week: 'Semana', close: 'Cerrar', days: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] },
  pt: { subtitle: 'Nada é publicado automaticamente. Abra uma publicação, copie o texto e siga o checklist.', created: 'criadas', pending: 'pendentes', post: 'Texto', images: 'Imagens', checklist: 'Checklist', copy: 'Copiar texto', copied: 'Copiado', pendingText: 'Esta publicação ainda não foi criada. Execute /gtm-studio:create no Claude Code.', openPdf: 'Abrir carousel.pdf', openImage: 'Ver em tamanho real', folder: 'Pasta', noImages: 'Esta publicação não tem imagens.', week: 'Semana', close: 'Fechar', days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] },
  fr: { subtitle: "Rien n'est publié automatiquement. Ouvrez une publication, copiez le texte et suivez la checklist.", created: 'créées', pending: 'en attente', post: 'Texte', images: 'Images', checklist: 'Checklist', copy: 'Copier le texte', copied: 'Copié', pendingText: "Cette publication n'a pas encore été créée. Lancez /gtm-studio:create dans Claude Code.", openPdf: 'Ouvrir carousel.pdf', openImage: 'Voir en taille réelle', folder: 'Dossier', noImages: "Cette publication n'a pas d'images.", week: 'Semaine', close: 'Fermer', days: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] },
  de: { subtitle: 'Nichts wird automatisch veröffentlicht. Beitrag öffnen, Text kopieren, Checkliste abarbeiten.', created: 'erstellt', pending: 'offen', post: 'Text', images: 'Bilder', checklist: 'Checkliste', copy: 'Text kopieren', copied: 'Kopiert', pendingText: 'Dieser Beitrag wurde noch nicht erstellt. Führe /gtm-studio:create in Claude Code aus.', openPdf: 'carousel.pdf öffnen', openImage: 'In voller Größe öffnen', folder: 'Ordner', noImages: 'Dieser Beitrag hat keine Bilder.', week: 'Woche', close: 'Schließen', days: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] },
  it: { subtitle: 'Niente viene pubblicato automaticamente. Apri un post, copia il testo e segui la checklist.', created: 'creati', pending: 'in sospeso', post: 'Testo', images: 'Immagini', checklist: 'Checklist', copy: 'Copia testo', copied: 'Copiato', pendingText: 'Questo post non è ancora stato creato. Esegui /gtm-studio:create in Claude Code.', openPdf: 'Apri carousel.pdf', openImage: 'Apri a grandezza naturale', folder: 'Cartella', noImages: 'Questo post non ha immagini.', week: 'Settimana', close: 'Chiudi', days: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] },
};

export function labelsFor(language) {
  const key = String(language || 'en').slice(0, 2).toLowerCase();
  const base = LABELS[key] || LABELS.en;
  return { ...base, page: PAGE_LABELS[key] || PAGE_LABELS.en };
}

function weekdayShort(iso, language) {
  try {
    return new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(parseDate(iso));
  } catch {
    return new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(parseDate(iso));
  }
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Renders calendar.md as a readable table in the brand's language.
 */
export function renderCalendarMarkdown(calendar, network, { language, product }) {
  const L = labelsFor(language);
  const lines = [];
  lines.push(`# ${L.title.replace('{network}', network.name)} — ${product}`);
  lines.push('');
  lines.push(L.intro.replace('{start}', calendar.startDate));
  lines.push('');
  lines.push(`| ${L.cols.join(' | ')} |`);
  lines.push(`| ${L.cols.map(() => '---').join(' | ')} |`);
  for (const p of calendar.posts) {
    lines.push(
      `| ${p.week} | ${p.date} (${weekdayShort(p.date, language)}) | ${p.time} | ${L.formats[p.format] || p.format} | ${L.goals[p.goal] || p.goal} | ${escapeCell(p.topic)} | ${L.status[p.status] || p.status} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
