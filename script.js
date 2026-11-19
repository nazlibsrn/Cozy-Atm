const $ = s => document.querySelector(s);
const stage = $('#stage'), card = $('#card'), tray = $('#tray'), content = $('#content'), led = $('#led');

// ---------- ayarlar ----------
const PIN = '1234';
let balance = 1000;          // hesaptaki para
let walletBills = [100, 50]; // cüzdandaki banknotlar
let wallet = 150;            // cüzdandaki para (gerçek değer)
let state = 'idle';          // idle | pin | menu | balance | amount | busy | ejected
let input = '';

// kart ölçüleri / konumları
const CW = 84, CH = 54;
const SX = 803;              // kart girişinde kartın sol x'i
const SLINE = 455;           // giriş çizgisi (kartın bu çizginin altı görünmez)
const HOME = { x: 793, y: 80 };

// ---------- ekrana sığdır ----------
function fit() {
  const s = Math.min(innerWidth / 960, innerHeight / 840)*1.2;
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit); fit();

// ---------- animasyon yardımcıları ----------
const easeIO = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
function tween(ms, fn, ease = easeIO) {
  return new Promise(res => {
    const s = performance.now();
    (function f(now) {
      const t = Math.min(1, (now - s) / ms);
      fn(ease(t));
      t < 1 ? requestAnimationFrame(f) : res();
    })(s);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- sesler (küçük, WebAudio ile) ----------
let actx;
function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, d, type = 'sine', v = .08, when = 0, fEnd) {
  try {
    const a = audio(), o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + when;
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t0 + d);
    g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + d);
  } catch (e) {}
}
function noise(d, v = .15) {
  try {
    const a = audio(), n = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, n, a.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = a.createGain(); g.gain.value = v;
    s.connect(f).connect(g).connect(a.destination); s.start();
  } catch (e) {}
}
const sfx = {
  key:   () => tone(880, .06, 'triangle', .05),
  ok:    () => { tone(660, .12, 'sine', .07); tone(990, .18, 'sine', .07, .1); },
  bad:   () => tone(200, .25, 'square', .04, 0, 120),
  motor: () => tone(110, .7, 'sawtooth', .025, 0, 170),
  bill:  () => noise(.14, .18),
};

// ---------- tuş takımı ----------
const keys = $('#keys');
function addKey(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'key ' + cls; b.textContent = label; b.onclick = fn;
  keys.appendChild(b);
}
const num = n => () => press(n);
[['1',num('1')],['2',num('2')],['3',num('3')]].forEach(([l,f]) => addKey(l,'',f));
addKey('Giriş', 'pink small', () => press('OK'));
[['4',num('4')],['5',num('5')],['6',num('6')]].forEach(([l,f]) => addKey(l,'',f));
addKey('Temizle', 'purple small', () => press('C'));
[['7',num('7')],['8',num('8')],['9',num('9')]].forEach(([l,f]) => addKey(l,'',f));
addKey('İptal', 'green small', cancel);
addKey('←', '', () => press('⌫'));
addKey('0', '', num('0'));
addKey('→', '', () => press('OK'));

addEventListener('keydown', e => {
  if (/^[0-9]$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') press('⌫');
  else if (e.key === 'Enter') press('OK');
});

function press(k) {
  sfx.key();
  if (state !== 'pin' && state !== 'amount') return;
  if (k === '⌫') input = input.slice(0, -1);
  else if (k === 'C') input = '';
  else if (k === 'OK') return confirmInput();
  else if (input.length < 4) input += k;
  render();
}

function cancel() {
  sfx.key();
  if (['pin', 'menu', 'balance', 'amount', 'deposit'].includes(state)) ejectCard();
}

function confirmInput() {
  if (state === 'pin') {
    if (input === PIN) { sfx.ok(); state = 'menu'; input = ''; render(); }
    else { input = ''; flash('Şifre yanlış 🌷', 'Tekrar dene', 'pin'); }
  } else if (state === 'amount') {
    const a = parseInt(input || '0', 10);
    if (!a) return flash('Bir miktar yaz 🌼', '', 'amount');
    if (a > balance) { input = ''; return flash('Hesapta o kadar yok 🥺', '', 'amount'); }
    sfx.ok(); dispense(a);
  }
}

function flash(title, sub, backTo) {
  state = 'busy'; sfx.bad();
  content.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
  const b = $('#bunny'); b.classList.remove('wobble'); void b.offsetWidth; b.classList.add('wobble');
  setTimeout(() => { state = backTo; render(); }, 1400);
}

// ---------- ekran ----------
function render() {
  const dots = [0,1,2,3].map(i => `<span class="dot ${i < input.length ? '' : 'off'}"></span>`).join('');
  if (state === 'idle') {
    content.innerHTML = `<h2>Hoş Geldiniz!</h2><p></p>`;
  } else if (state === 'pin') {
    content.innerHTML = `<h2>Hoş Geldiniz!</h2><p>Lütfen şifrenizi girin ♡</p>
      <div class="pill"><div class="dots">${dots}</div></div><p style="font-size:13px;opacity:.85">(ipucu: 1234)</p>`;
  } else if (state === 'menu') {
    content.innerHTML = `<h2>Ne yapalım?</h2><div class="col">
      <button class="sbtn" onclick="go('amount')">💸 Para çek</button>
      <button class="sbtn" onclick="go('deposit')"> 💰 Para yatır</button>
      <button class="sbtn" onclick="go('balance')">🧸 Bakiye</button>
      <button class="sbtn" onclick="cancel()">💳 Kart iade </button></div>`;
  } else if (state === 'deposit') {
    content.innerHTML = `<h2>Para yatırmak için cüzdanını aç</h2><p>💖</p>
    <div class="pill"><div class="amount">${balance} ₺</div></div>
    <button class="sbtn" onclick="go('menu')">Geri</button>`;
  } else if (state === 'balance') {
    content.innerHTML = `<h2>Bakiyen</h2><div class="pill"><div class="amount">${balance} ₺</div></div>
      <button class="sbtn" onclick="go('menu')">Geri</button>`;
  } else if (state === 'amount') {
    content.innerHTML = `<h2>Ne kadar çekelim?</h2><div class="pill"><div class="amount">${input || '0'} ₺</div></div>
      <div class="row"><button class="sbtn" onclick="quick(50)">50</button><button class="sbtn" onclick="quick(100)">100</button><button class="sbtn" onclick="quick(200)">200</button></div>
      <p style="font-size:14px">sonra “Giriş”e bas</p><button class="sbtn" onclick="go('menu')">Geri</button>`;
  } else if (state === 'ejected') {
    content.innerHTML = `<h2>Görüşürüz! ♡</h2><p>Kartını almayı unutma</p>`;
  }
  led.className = 'abs ' + (state === 'idle' ? 'idle' : state === 'ejected' ? 'ejected' : 'off');
}
function go(s) { sfx.key(); state = s; input = ''; render(); }
function quick(a) {
    sfx.key();
    const mevcut = parseInt(input || '0', 10);
    input = String(Math.min(9999, mevcut + a )); render();
}

function drawWalletStack() {
  const box = $('#walletInfo');
  box.innerHTML = '';
  walletBills.forEach((v, i) => {
    const b = document.createElement('div');
    b.className = 'bill';
    b.style.bottom = (Math.min(i, 10) * 3) + 'px';
    b.style.transform = `scale(0.82) rotate(${((i % 3) - 1) * 4}deg)`;
    b.style.zIndex = i;
    b.innerHTML = `<span>${v} ₺</span>`;
    box.appendChild(b);
    b.onclick = () => depositBill(i);
  });
}

// ---------- kart animasyonları ----------
function placeCard(x, y, cut = 0) {
  card.style.left = x + 'px'; card.style.top = y + 'px';
  card.style.clipPath = cut > 0 ? `inset(0 0 ${cut}px 0)` : 'none';
}
// kart girişte: çizginin altı kalan kısım görünmez (içeri girmiş gibi)
function placeSlot(top) { placeCard(SX, top, Math.min(CH, Math.max(0, top + CH - SLINE))); }
placeCard(HOME.x, HOME.y);

async function goHome() {
  const x0 = card.offsetLeft, y0 = card.offsetTop;
  await tween(320, t => placeCard(x0 + (HOME.x - x0) * t, y0 + (HOME.y - y0) * t));
}

async function insertCard() {
  state = 'busy';
  content.innerHTML = `<h2>Kart okunuyor…</h2><p>♡</p>`;
  card.classList.remove('dragging');
  const x0 = card.offsetLeft, y0 = card.offsetTop, topY = SLINE - CH - 20;
  await tween(250, t => placeCard(x0 + (SX - x0) * t, y0 + (topY - y0) * t));  // girişin üstüne hizalan
  sfx.motor();
  await tween(700, t => placeSlot(topY + (SLINE - topY) * t));                 // yavaşça içeri kay
  card.style.display = 'none';
  await wait(250);
  state = 'pin'; input = ''; render();
}

async function ejectCard() {
  state = 'busy'; input = '';
  content.innerHTML = `<h2>Hoşça kal! ♡</h2><p>Kartın geliyor…</p>`;
  card.style.display = ''; placeSlot(SLINE); sfx.motor();
  await tween(850, t => placeSlot(SLINE - CH * 0.55 * t));                     // yarıya kadar çıkar, bekler
  state = 'ejected'; render();
}

// sürükle-bırak
let drag = null;
card.addEventListener('pointerdown', e => {
  if (state !== 'idle' && state !== 'ejected') return;
  if (state === 'ejected') { state = 'idle'; render(); }   // kartı tuttu
  card.style.clipPath = 'none';
  const r = stage.getBoundingClientRect(), s = r.width / 960;
  drag = { dx: (e.clientX - r.left) / s - card.offsetLeft, dy: (e.clientY - r.top) / s - card.offsetTop };
  card.setPointerCapture(e.pointerId); card.classList.add('dragging');
});
card.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = stage.getBoundingClientRect(), s = r.width / 960;
  placeCard((e.clientX - r.left) / s - drag.dx, (e.clientY - r.top) / s - drag.dy);
});
card.addEventListener('pointerup', () => {
  if (!drag) return; drag = null; card.classList.remove('dragging');
  const c = card.getBoundingClientRect(), h = $('#housing').getBoundingClientRect();
  const hit = !(c.right < h.left - 20 || c.left > h.right + 20 || c.bottom < h.top - 20 || c.top > h.bottom + 20);
  if (hit && state === 'idle') insertCard(); else goHome();
});

// ---------- para çıkışı ----------
async function dispense(amount) {
  state = 'busy';
  balance -= amount;
  content.innerHTML = `<h2>Paran geliyor… 💕</h2><p>Aşağıdan alabilirsin</p>`;
  await wait(500);
  let left = amount, i = 0;
  while (left > 0) {
    const v = left >= 100 ? 100 : left; left -= v;
    const b = document.createElement('div');
    b.className = 'bill';
    b.style.setProperty('--r', (Math.random() * 6 - 3).toFixed(1) + 'deg');
    b.style.left = (16 + (i % 3) * 132 + Math.random() * 8 - 4) + 'px';
    b.style.top = (8 + Math.floor(i / 3) * 9 + Math.random() * 4 - 2) + 'px';
    b.style.zIndex = 5 + i;
    b.innerHTML = `<span>${v} ₺</span>`;
    b.onclick = () => takeBill(b, v);
    tray.appendChild(b); sfx.bill(); i++;
    await wait(380);
  }
  await wait(300);
  state = 'menu'; render();
}

async function takeBill(b, v) {
  if (b.dataset.taken) return; b.dataset.taken = 1;
  sfx.bill();
  const x = 240 + b.offsetLeft + 3, y = 725 + b.offsetTop + 3;   // tepsinin içindeki yer → sahne koordinatı
  const clone = b.cloneNode(true);
  clone.style.animation = 'none'; clone.style.left = x + 'px'; clone.style.top = y + 'px'; clone.style.zIndex = 40;
  stage.appendChild(clone); b.remove();
  const tx = 835 - 65 - x, ty = 235 - 28 - y;
  await tween(650, t => {
    const lift = Math.sin(t * Math.PI) * -40;
    clone.style.transform = `translate(${tx * t}px, ${ty * t + lift}px) scale(${1 - .45 * t}) rotate(${t * 14}deg)`;
    clone.style.opacity = 1 - Math.max(0, t - .8) * 5;
  });
  clone.remove();
  wallet += v;
  walletBills.push(v);
  drawWalletStack();
}

async function depositBill(index) {
  if (state !== 'deposit') return;
  const v = walletBills.splice(index, 1)[0];
  wallet -= v;
  drawWalletStack();
  sfx.bill();

  const clone = document.createElement('div');
  clone.className = 'bill';
  clone.style.animation = 'none';
  clone.style.zIndex = 40;
  clone.innerHTML = `<span>${v} ₺</span>`;
  stage.appendChild(clone);

  const x0 = 770, y0 = 215;
  const tx = 385, ty = 735;
  const TLINE = 728;

  await tween(500, t => {
    const lift = Math.sin(t * Math.PI) * -40;
    clone.style.left = (x0 + (tx - x0) * t) + 'px';
    clone.style.top = (y0 + (ty - y0) * t + lift) + 'px';
    clone.style.transform = `scale(${0.82 + 0.18 * t}) rotate(${(1 - t) * -10}deg)`;
  });

  sfx.motor();
  await tween(550, t => {
    const y = ty - 60 * t;
    const cut = Math.max(0, TLINE - y);
    clone.style.top = y + 'px';
    clone.style.clipPath = `inset(${cut}px 0 0 0)`;
  });

  clone.remove();
  balance += v;
  sfx.ok();
  render();
}

render();
drawWalletStack();