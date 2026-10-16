// Kart ↔ GitHub issue eşlemesi. Kayıt yeri issue'dur; pano onun yerel görünümüdür.
//
//   sütun     issue
//   yapilacak açık, `yapılıyor` etiketi yok
//   yapiliyor açık, `yapılıyor` etiketi var
//   bitti     kapalı (completed)
//   silindi   kapalı (not planned)
//
// Tür `ödev`/`görev` etiketiyle, ders ve teslim tarihi gövdenin başındaki satırlarla taşınır;
// kartın kimliği ve kaynak mesajı gövdenin sonundaki gizli yorumda durur. Gövde GitHub'da elle
// düzenlenebilir: başlık satırları ve metin geri okunur, gizli yorum kaybolursa kart issue
// numarasından kimlik alır.

export const KIND_LABELS = { 'ödev': 'ödev', 'görev': 'görev' };
export const DOING_LABEL = 'yapılıyor';
const MANAGED = new Set([...Object.values(KIND_LABELS), DOING_LABEL]);
const PREFIX = { 'ödev': 'OD', 'görev': 'GR' };
const META = /\n*<!-- retro-kanban (\{.*?\}) -->\s*$/s;
const HEADER = /^\*\*(Ders|Teslim|Verildi):\*\*\s*(.*)$/;
const AP_TITLE = /^AP-([A-Z]{2})-(\d+)\s*·\s*/;
const NONE = '—';

// Şifre içeren satır (ör. öğretmenin paylaştığı EBA şifresi) issue'ya hiçbir zaman yazılmaz.
const SECRET = /şifre|sifre|parola|password|\bpin\b/i;
export const REDACTED = '[gizlendi: şifre içeren satır]';
export const redact = (text) => (text ?? '').split('\n').map((l) => (SECRET.test(l) ? REDACTED : l)).join('\n');

const trDate = (iso) => (iso ? iso.split('-').reverse().join('.') : NONE);
function isoFromTr(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const trDateTime = (iso) => new Date(iso).toLocaleString('tr-TR', {
  timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Başlıktaki `AP-OD-08 · ` önekini ayırır. */
export function splitTitle(title) {
  const m = AP_TITLE.exec(title);
  return m ? { ap: `AP-${m[1]}-${m[2]}`, title: title.slice(m[0].length) } : { ap: null, title };
}

/** Bu türdeki bir sonraki AP kimliği (ör. AP-OD-09); var olan issue başlıklarına bakar. */
export function nextAp(kind, titles) {
  const prefix = PREFIX[kind] ?? PREFIX['ödev'];
  let max = 0;
  for (const t of titles) {
    const m = AP_TITLE.exec(t);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `AP-${prefix}-${String(max + 1).padStart(2, '0')}`;
}

export function renderBody(card) {
  const meta = {
    id: card.id,
    src: card.source?.msgId ? `${card.source.msgId}|${card.title}` : null,
    createdAt: card.createdAt,
    assignedAt: card.assignedAt,
    attachment: card.attachment ?? null,
    source: card.source ?? null,
  };
  const given = card.assignedAt
    ? `${trDateTime(card.assignedAt)}${card.source?.chat ? ` · ${card.source.chat}` : ''}`
    : NONE;
  return [
    `**Ders:** ${card.subject ?? NONE}`,
    `**Teslim:** ${trDate(card.due)}`,
    `**Verildi:** ${given}`,
    '',
    redact(card.body ?? '').trim(),
    '',
    `<!-- retro-kanban ${JSON.stringify(meta)} -->`,
  ].join('\n');
}

/** Kartın issue'daki karşılığı: başlık, gövde, etiketler ve durum. */
export function issueFromCard(card, ap) {
  const labels = [...(card.labels ?? []).filter((l) => !MANAGED.has(l)), KIND_LABELS[card.kind] ?? KIND_LABELS['ödev']];
  if (card.column === 'yapiliyor') labels.push(DOING_LABEL);
  return {
    title: `${ap} · ${redact(card.title)}`,
    body: renderBody(card),
    labels,
    state: card.column === 'bitti' ? 'closed' : 'open',
    ...(card.column === 'bitti' ? { state_reason: 'completed' } : {}),
  };
}

/** Panoya giren issue: `ödev` ya da `görev` etiketli, pull request olmayan. */
export const isBoardIssue = (issue) => !issue.pull_request
  && issue.labels.some((l) => Object.values(KIND_LABELS).includes(l.name ?? l));

export function parseBody(raw) {
  const text = (raw ?? '').replace(/\r\n/g, '\n');
  const metaMatch = META.exec(text);
  let meta = {};
  if (metaMatch) try { meta = JSON.parse(metaMatch[1]); } catch { /* elle bozulmuş: yok say */ }
  const lines = (metaMatch ? text.slice(0, metaMatch.index) : text).split('\n');
  const head = {};
  while (lines.length && (HEADER.test(lines[0]) || (Object.keys(head).length && !lines[0].trim()))) {
    const m = HEADER.exec(lines.shift());
    if (m) head[m[1]] = m[2].trim();
    else break; // başlık bloğundan sonraki ilk boş satır
  }
  const value = (v) => (v && v !== NONE ? v : null);
  return {
    meta,
    subject: value(head.Ders),
    due: value(head.Teslim) ? isoFromTr(head.Teslim) : null,
    body: lines.join('\n').trim(),
  };
}

/**
 * Issue'yu karta çevirir. `local` panodaki önceki hâlidir: gövdedeki gizlenmiş satırlar
 * issue'ya hiç yazılmadığından, metin değişmemişse yereldeki asıl metin korunur.
 * Kapalı (not planned) issue için `null` döner: kart silinmiştir.
 */
export function cardFromIssue(issue, local = null) {
  if (issue.state === 'closed' && issue.state_reason === 'not_planned') return null;
  const labels = issue.labels.map((l) => l.name ?? l);
  const { meta, subject, due, body } = parseBody(issue.body);
  const { title } = splitTitle(issue.title);
  const column = issue.state === 'closed' ? 'bitti' : labels.includes(DOING_LABEL) ? 'yapiliyor' : 'yapilacak';
  const keepLocalBody = local && redact(local.body).trim() === body;
  const keepLocalTitle = local && redact(local.title) === title;
  return {
    id: meta.id ?? local?.id ?? `gh-${issue.number}`,
    column,
    createdAt: meta.createdAt ?? issue.created_at,
    updatedAt: issue.updated_at,
    movedAt: column === local?.column ? (local?.movedAt ?? null) : (issue.closed_at ?? issue.updated_at),
    assignedAt: meta.assignedAt ?? issue.created_at,
    kind: labels.includes(KIND_LABELS['görev']) ? 'görev' : 'ödev',
    title: keepLocalTitle ? local.title : title,
    subject,
    due,
    body: keepLocalBody ? local.body : body,
    attachment: meta.attachment ?? null,
    source: meta.source ?? null,
    labels: labels.filter((l) => !MANAGED.has(l)),
    issue: issue.number,
    issueUpdatedAt: issue.updated_at,
    dirty: false,
  };
}

/** Issue'nun kaynak anahtarı (`msgId|başlık`): ingest aynı mesajdan ikinci kart açmasın. */
export const issueSrc = (issue) => parseBody(issue.body).meta.src ?? null;
