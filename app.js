// Telefondaki pano: kartları doğrudan deponun GitHub issue'larından okur ve yazar. Kart ↔ issue
// eşlemesi masaüstü sunucusuyla aynı modüldür (issues.js, retro-kanban'daki src/issues.js'in kopyası), böylece iki taraf
// aynı biçimde yazar; masaüstü pano telefondaki değişikliği en geç 5 dakikada görür.
import { client } from './github.js';
import { DOING_LABEL, cardFromIssue, isBoardIssue, issueFromCard, nextAp, splitTitle } from './issues.js';

const COLS = [['yapilacak', 'Yapılacak'], ['yapiliyor', 'Sürüyor'], ['bitti', 'Bitti']];
const DONE_DAYS = 30;
const SUB_LABEL = 'bildirim-abonelik';
const DAY = 86_400_000;
const $ = (s) => document.querySelector(s);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* özel mod */ } },
};

let cfg = { repo: store.get('rk-repo') ?? '', token: store.get('rk-token') ?? '' };
let gh = cfg.token ? client(cfg) : null;
let issues = [];
try { issues = JSON.parse(store.get('rk-issues') ?? '[]'); } catch { /* bozuk önbellek */ }
let tab = store.get('rk-tab') ?? 'yapilacak';
let lastSync = store.get('rk-synced');
let loading = false;
let labelReady = false;

// ---- kartlar

function cards() {
  const now = Date.now();
  return issues.filter(isBoardIssue).flatMap((issue) => {
    const card = cardFromIssue(issue);
    if (!card) return [];
    if (card.column === 'bitti' && now - Date.parse(issue.closed_at) > DONE_DAYS * DAY) return [];
    return [card];
  });
}

const assignedOf = (c) => c.assignedAt ?? c.source?.at ?? c.createdAt;
const dueEnd = (due) => { const [y, m, d] = due.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59); };
const dayIndex = (d) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY);
const fmtDate = (d) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

// Çubuk: ödevin verildiği andan teslim gününün sonuna kadar geçen sürenin oranı.
function progress(card) {
  if (card.column === 'bitti') return { pct: 100, label: '✓ bitti', late: false };
  if (!card.due) return { pct: 0, label: 'tarih yok', late: false };
  const start = new Date(assignedOf(card)).getTime();
  const end = dueEnd(card.due).getTime();
  const pct = end > start ? Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100)) : 100;
  const days = dayIndex(dueEnd(card.due)) - dayIndex(new Date());
  if (days < 0) return { pct: 100, label: `${-days} gün geçti`, late: true };
  if (days === 0) return { pct, label: 'bugün', late: true };
  if (days === 1) return { pct, label: 'yarın', late: false };
  return { pct, label: `${days} gün kaldı`, late: false };
}

// ---- çizim

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== ''));
  return e;
}
function icon(id, size = 24) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function renderCard(card) {
  const p = progress(card);
  return el('div', { class: 'card', role: 'button', tabindex: '0', onclick: () => openCard(card.issue) },
    el('div', { class: 'head' }, icon(card.kind === 'görev' ? 'i-task' : 'i-doc'),
      el('div', { class: 'title' },
        card.kind === 'görev' ? el('span', { class: 'rozet' }, 'GÖREV') : null,
        card.subject ? el('span', { class: 'subject' }, card.subject) : null,
        card.title)),
    el('div', { class: 'dates' },
      `Verildi ${fmtDateTime(assignedOf(card))} · Teslim ${card.due ? fmtDate(dueEnd(card.due)) : '—'}`,
      card.attachment ? ` · 📎 ${card.attachment}` : ''),
    el('div', { class: 'barrow' },
      el('div', {
        class: `bar sunken${p.late ? ' late' : ''}`, role: 'progressbar', 'aria-label': 'Teslime kalan süre',
        'aria-valuenow': Math.round(p.pct), 'aria-valuemin': 0, 'aria-valuemax': 100,
      }, el('i', { style: `width:${p.pct}%` })),
      el('span', { class: `barlabel${p.late ? ' late' : ''}` }, p.label)));
}

const sortKey = (c) => (c.column === 'bitti' ? (c.movedAt ?? '') : (c.due ?? '9999'));

function render() {
  const all = cards();
  $('#tabs').replaceChildren(...COLS.map(([key, label]) => el('button', {
    class: 'tab', role: 'tab', 'aria-selected': String(key === tab),
    onclick: () => { tab = key; store.set('rk-tab', key); render(); $('#list').scrollTop = 0; },
  }, `${label} (${all.filter((c) => c.column === key).length})`)));

  let list = all.filter((c) => c.column === tab).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (tab === 'bitti') list = list.reverse();
  $('#cards').replaceChildren(...(list.length ? list.map(renderCard)
    : [el('div', { class: 'empty' }, gh ? '(boş)' : 'Başlamak için ⚙ Ayarlar\'dan depo ve token girin.')]));

  const late = all.filter((c) => c.column !== 'bitti' && c.due && dueEnd(c.due) < new Date()).length;
  $('#st-late').textContent = late ? `Gecikmiş: ${late}` : 'Gecikme yok';
  $('#st-late').style.color = late ? 'var(--late)' : '';
  if (!loading && !$('#st-msg').dataset.error) {
    $('#st-msg').textContent = lastSync ? `Güncellendi ${fmtTime(lastSync)}` : 'Hazır';
  }
  $('[data-act="new"]').disabled = !gh;
}

function status(text, isError = false) {
  const s = $('#st-msg');
  s.textContent = text;
  s.style.color = isError ? 'var(--late)' : '';
  if (isError) s.dataset.error = '1'; else delete s.dataset.error;
}

// ---- GitHub

function remember() {
  // Önbellek yalnız panoya giren ve son 30 günde kapanan issue'ları taşır: açılışta hızlı çizim, çevrimdışı görünüm.
  const keep = issues.filter((i) => isBoardIssue(i) && (i.state === 'open' || Date.now() - Date.parse(i.closed_at) <= DONE_DAYS * DAY));
  store.set('rk-issues', JSON.stringify(keep));
}

async function load() {
  if (!gh || loading) return;
  loading = true;
  status('Yükleniyor…');
  try {
    issues = await gh.listIssues();
    lastSync = new Date().toISOString();
    store.set('rk-synced', lastSync);
    remember();
    status(`Güncellendi ${fmtTime(lastSync)}`);
  } catch (err) {
    status(navigator.onLine ? err.message : 'Çevrimdışı: son alınan liste gösteriliyor', true);
  } finally {
    loading = false;
    render();
  }
}

function replaceIssue(updated) {
  const i = issues.findIndex((x) => x.number === updated.number);
  if (i >= 0) issues[i] = updated; else issues.push(updated);
  remember();
}

/**
 * Issue'nun güncel hâlini alır, `change` ile kartı değiştirip geri yazar. Güncel hâlden
 * başlamak, masaüstünde ya da GitHub'da bu arada yapılan değişikliğin üstüne yazmayı önler.
 */
async function updateCard(number, change, only) {
  const fresh = await gh.getIssue(number);
  const card = cardFromIssue(fresh);
  if (!card) throw new Error('kart başka yerde silinmiş');
  change(card);
  if (card.column === 'yapiliyor' && !labelReady) {
    await gh.ensureLabel(DOING_LABEL, 'fbca04', 'Panoda "Yapılıyor" sütununda');
    labelReady = true;
  }
  const ap = splitTitle(fresh.title).ap ?? nextAp(card.kind, issues.map((i) => i.title));
  const fields = issueFromCard(card, ap);
  const body = only ? Object.fromEntries(only.map((k) => [k, fields[k]])) : fields;
  if (fields.state === 'closed') body.state_reason = 'completed';
  replaceIssue(await gh.updateIssue(number, body));
}

async function move(number, column) {
  // Hemen çiz, sonra yaz: yazılamazsa liste GitHub'dan yeniden alınır.
  const issue = issues.find((i) => i.number === number);
  const names = issue.labels.map((l) => l.name ?? l).filter((n) => n !== DOING_LABEL);
  replaceIssue({
    ...issue,
    state: column === 'bitti' ? 'closed' : 'open',
    closed_at: column === 'bitti' ? new Date().toISOString() : null,
    labels: column === 'yapiliyor' ? [...names, DOING_LABEL] : names,
  });
  render();
  status('Kaydediliyor…');
  try {
    await updateCard(number, (c) => { c.column = column; }, ['labels', 'state']);
    status('Kaydedildi');
  } catch (err) {
    status(err.message, true);
    await load();
  }
  render();
}

async function createCard(fields) {
  const now = new Date().toISOString();
  const card = {
    id: crypto.randomUUID(), column: 'yapilacak', createdAt: now, updatedAt: now, assignedAt: now,
    kind: fields.kind, title: fields.title, subject: fields.subject, due: fields.due,
    body: '', attachment: null, source: null, labels: [],
  };
  const all = await gh.listIssues(); // AP numarası için en güncel başlıklar
  const { state, ...create } = issueFromCard(card, nextAp(card.kind, all.map((i) => i.title)));
  issues = all;
  replaceIssue(await gh.createIssue(create));
}

// ---- iletişim kutuları

function openCard(number) {
  const issue = number ? issues.find((i) => i.number === number) : null;
  const card = issue ? cardFromIssue(issue) : null;
  if (number && !card) return;
  const dlg = $('#dlg-card');
  const f = $('#card-form');
  let column = card?.column ?? 'yapilacak';
  const drawMoves = () => $('#card-moves').replaceChildren(...COLS.map(([key, label]) => el('button', {
    type: 'button', class: 'raised btn', 'aria-pressed': String(key === column),
    onclick: () => { column = key; drawMoves(); },
  }, label)));
  $('#card-moves').hidden = !card;
  if (card) drawMoves();
  const { ap } = issue ? splitTitle(issue.title) : { ap: null };
  $('#card-dlg-title').textContent = card ? (ap ?? `#${issue.number}`) : 'Yeni ödev';
  f.title.value = card?.title ?? '';
  f.subject.value = card?.subject ?? '';
  f.due.value = card?.due ?? '';
  f.kind.value = card?.kind ?? 'ödev';
  $('#card-assigned').replaceChildren(...(card ? [
    `Verildi ${fmtDateTime(assignedOf(card))}${card.source ? ` · WhatsApp${card.source.chat ? ` (${card.source.chat})` : ''}` : ' · elle eklendi'} · `,
    el('a', { href: issue.html_url, target: '_blank', rel: 'noopener' }, `GitHub #${issue.number}`),
  ] : []));
  $('#card-body-wrap').hidden = !card?.body;
  $('#card-body').textContent = card?.body ?? '';
  $('#card-del').hidden = !card;
  $('#card-err').hidden = true;
  dlg.returnValue = '';
  dlg.onclose = async () => {
    const action = dlg.returnValue;
    if (action === 'delete') return askDelete(card, issue.number);
    if (action !== 'ok') return;
    const fields = {
      title: f.title.value.trim(), subject: f.subject.value.trim() || null, due: f.due.value || null, kind: f.kind.value,
    };
    try {
      if (!card) {
        status('Ekleniyor…');
        await createCard(fields);
        tab = 'yapilacak';
      } else {
        const edited = fields.title !== card.title || fields.subject !== card.subject || fields.due !== card.due || fields.kind !== card.kind;
        if (edited) {
          status('Kaydediliyor…');
          await updateCard(issue.number, (c) => Object.assign(c, fields, { column }));
        } else if (column !== card.column) {
          return move(issue.number, column);
        } else return;
      }
      status('Kaydedildi');
    } catch (err) { status(err.message, true); }
    render();
  };
  dlg.showModal();
  if (!card) f.title.focus();
}

function askDelete(card, number) {
  const dlg = $('#dlg-confirm');
  $('#confirm-text').textContent = `"${card.title}" kartını silmek istediğinize emin misiniz?`;
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    // Silme = "not planned" kapatma: masaüstü pano kartı mezar taşına alır, WhatsApp'tan geri gelmez.
    const before = issues;
    issues = issues.filter((i) => i.number !== number);
    render();
    try {
      replaceIssue(await gh.updateIssue(number, { state: 'closed', state_reason: 'not_planned' }));
      status('Silindi');
    } catch (err) { issues = before; status(err.message, true); }
    render();
  };
  dlg.showModal();
}

// ---- ayarlar ve bildirimler

const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function pushStateText() {
  if (!pushSupported()) return standalone() ? '(bu cihazda desteklenmiyor, iOS 16.4+ gerekli)' : '(önce ana ekrana ekleyin)';
  if (Notification.permission === 'denied') return '(reddedildi: Ayarlar → Bildirimler → Ödevler)';
  return store.get('rk-push') ? '— açık' : '— kapalı';
}

function openSettings(first = false) {
  const dlg = $('#dlg-settings');
  const f = $('#settings-form');
  f.repo.value = cfg.repo;
  f.token.value = cfg.token;
  $('#install-note').hidden = standalone();
  $('#push-state').textContent = pushStateText();
  $('#push-btn').disabled = !pushSupported() || !gh;
  $('#push-btn').textContent = store.get('rk-push') ? 'Aboneliği yenile' : 'Bildirimleri aç';
  $('#settings-err').hidden = true;
  $('#settings-cancel').hidden = first;
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const repo = f.repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '');
    const token = f.token.value.trim();
    if (repo !== cfg.repo) { issues = []; store.set('rk-issues', null); store.set('rk-push', null); }
    cfg = { repo, token };
    store.set('rk-repo', repo);
    store.set('rk-token', token);
    gh = client(cfg);
    await load();
  };
  dlg.showModal();
}

const b64uBytes = (s) => {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function enablePush() {
  const err = $('#settings-err');
  err.hidden = true;
  try {
    // İzin isteği dokunuşun hemen ardından gelmeli (iOS başka türlü göstermez).
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Bildirim izni verilmedi.');
    $('#push-state').textContent = '— bağlanıyor…';
    const holder = (await gh.call('GET', `issues?labels=${encodeURIComponent(SUB_LABEL)}&state=all&per_page=5`))[0];
    const key = holder && /<!-- retro-kanban-push (\{.*?\}) -->/s.exec(holder.body ?? '');
    if (!key) throw new Error('Bilgisayarda bildirim kurulmamış: depoda `npm run notify -- setup` çalıştırın.');
    const vapid = JSON.parse(key[1]).vapid;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const sameKey = sub?.options?.applicationServerKey
      && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === vapid;
    if (sub && !sameKey) { await sub.unsubscribe(); sub = null; }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(vapid) });

    const json = sub.toJSON();
    const comments = await gh.listComments(holder.number);
    if (!comments.some((c) => (c.body ?? '').includes(json.endpoint))) {
      const device = /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Tarayıcı';
      const meta = { device, at: new Date().toISOString(), subscription: { endpoint: json.endpoint, keys: json.keys } };
      await gh.addComment(holder.number, `📱 ${device} · ${new Date().toLocaleString('tr-TR')}\n\n<!-- retro-kanban-push-sub ${JSON.stringify(meta)} -->`);
    }
    store.set('rk-push', '1');
    $('#push-state').textContent = pushStateText();
    $('#push-btn').textContent = 'Aboneliği yenile';
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    $('#push-state').textContent = pushStateText();
  }
}

// ---- başlangıç

const ACTIONS = { new: () => openCard(null), refresh: load, settings: () => openSettings() };
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) ACTIONS[b.dataset.act]?.();
});
$('#push-btn').addEventListener('click', enablePush);

// Aşağı çekip bırakınca yenile.
{
  const list = $('#list');
  let startY = null;
  list.addEventListener('touchstart', (e) => { startY = list.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (startY !== null) $('#pull').classList.toggle('show', e.touches[0].clientY - startY > 70);
  }, { passive: true });
  list.addEventListener('touchend', () => {
    if ($('#pull').classList.contains('show')) load();
    $('#pull').classList.remove('show');
    startY = null;
  });
}

const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); };
tick();
setInterval(tick, 15_000);

// Uygulamaya geri dönülünce (arka plandan, bildirimden) liste tazelenir.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

// Bildirime dokunulunca o kart açılır.
function openFromUrl() {
  const n = Number(new URLSearchParams(location.search).get('issue'));
  if (!n) return;
  history.replaceState(null, '', location.pathname);
  const issue = issues.find((i) => i.number === n);
  if (issue) {
    const card = cardFromIssue(issue);
    if (card) { tab = card.column; render(); openCard(n); }
  }
}
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.issue) { history.replaceState(null, '', `?issue=${e.data.issue}`); load().then(openFromUrl); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
if (gh) load().then(openFromUrl);
else openSettings(true);
