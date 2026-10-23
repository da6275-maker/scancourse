/* app.js — 스캔코스: 사진 → 주소 인식 → 지도 순서 → 내비 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const Core = window.Core;
  const $ = (id) => document.getElementById(id);

  // ---------- 저장소 ----------
  const LS = { state: 'sc.state.v1', settings: 'sc.settings.v1', dict: 'sc.dict.v1' };
  const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 동작은 함 */ } };

  // 포천시 기본 지명 (틀린 인식 보정용). 주소를 찾을 때마다 자동으로 늘어남.
  const SEED_DICT = [
    '포천동', '선단동', '소흘읍', '군내면', '내촌면', '가산면', '신북면', '창수면', '영중면', '일동면', '이동면', '영북면', '관인면', '화현면',
    '신읍동', '어룡동', '자작동', '설운동', '동교동',
    '송우리', '무봉리', '이동교리', '직동리', '초가팔리', '이가팔리', '고모리', '무림리', '이곡리',
    '구읍리', '용정리', '하성북리', '상성북리', '직두리', '명산리', '유교리', '좌의리',
    '마산리', '정교리', '감암리', '가산리', '우금리', '금현리', '방축리', '마전리',
    '내리', '진목리', '음현리', '신팔리', '소학리',
    '가채리', '기지리', '신평리', '계류리', '심곡리', '금동리', '만세교리', '삼성당리', '고일리', '덕둔리',
    '양문리', '영평리', '성동리', '거사리', '금주리', '영송리',
    '기산리', '길명리', '화대리', '수입리', '유동리', '사직리',
    '장암리', '노곡리', '연곡리', '도평리', '낙귀리',
    '운천리', '문암리', '야미리', '산정리', '자일리', '대회산리', '소회산리',
    '탄동리', '중리', '초과리', '냉정리', '삼율리', '사정리',
    '화현리', '지현리', '명덕리',
    '오가리', '추동리', '가양리', '주원리', '신흥리', '운산리',
    '호국로', '포천로', '솔모루로', '송우로', '왕방로', '영일로', '화동로', '청군로', '금강로', '가산로', '관인로', '창동로', '청신로', '죽엽산로', '중앙로', '내촌로',
  ];

  let settings = Object.assign({
    home: CFG.DEFAULT_HOME || '', homeLat: null, homeLng: null, homeFound: '',
    region: CFG.DEFAULT_REGION || '', nav: 'kakaonavi', road: CFG.ROAD_ORDER !== false, key: '',
  }, lsGet(LS.settings, {}));

  let state = Object.assign({ stops: [], excluded: [], order: [], start: { type: 'home' }, route: null, builtAt: null }, lsGet(LS.state, {}));
  let dict = new Set(lsGet(LS.dict, null) || SEED_DICT);

  const saveState = () => lsSet(LS.state, state);
  const saveSettings = () => lsSet(LS.settings, settings);
  const saveDict = () => lsSet(LS.dict, Array.from(dict));

  const uid = () => Math.random().toString(36).slice(2, 10);
  const kakaoKey = () => (settings.key || CFG.KAKAO_JS_KEY || '').trim();

  // ---------- 공용 UI ----------
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const VIEWS = ['scan', 'review', 'course', 'settings'];
  let currentView = 'scan';
  function showView(name) {
    currentView = name;
    for (const v of VIEWS) $('view-' + v).hidden = v !== name;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    window.scrollTo(0, 0);
    if (name === 'course') { renderCourse(); setTimeout(() => { if (map) map.relayout(); fitMap(); }, 50); }
    if (name === 'review') renderRows();
    if (name === 'scan') renderResume();
    if (name === 'settings') renderSettings();
  }

  // ---------- 설정 화면 ----------
  function renderSettings() {
    $('setHome').value = settings.home || '';
    $('homeFound').textContent = settings.homeFound ? '찾음: ' + settings.homeFound : (settings.home ? '아직 좌표를 못 찾았습니다. 찾기를 눌러 주세요.' : '');
    $('setRegion').value = settings.region || '';
    $('setNav').value = settings.nav || 'kakaonavi';
    $('setRoad').checked = !!settings.road;
    $('setKey').value = settings.key || '';
    $('originCode').textContent = location.origin;
    $('dictCount').textContent = dict.size;
    $('versionText').textContent = (CFG.APP_NAME || '스캔코스') + ' v' + (CFG.VERSION || '1');
    renderKeyStatus();
  }
  function renderKeyStatus() {
    const el = $('keyStatus');
    if (!kakaoKey()) el.textContent = '키 없음 — config.js의 KAKAO_JS_KEY를 채워 주세요';
    else if (kakaoState === 'ok') el.textContent = '정상';
    else if (kakaoState === 'error') el.textContent = '불러오기 실패 — 키가 틀렸거나 카카오 개발자 사이트에 이 도메인이 등록되지 않았습니다';
    else el.textContent = '불러오는 중';
  }
  async function saveSettingsFromForm() {
    const newHome = $('setHome').value.trim();
    if (newHome !== settings.home) { settings.home = newHome; settings.homeLat = null; settings.homeLng = null; settings.homeFound = ''; }
    settings.region = $('setRegion').value.trim();
    settings.nav = $('setNav').value;
    settings.road = $('setRoad').checked;
    const newKey = $('setKey').value.trim();
    const keyChanged = newKey !== (settings.key || '');
    settings.key = newKey;
    saveSettings();
    if (settings.home && !settings.homeLat) await findHome();
    if (keyChanged) { toast('키를 바꿨습니다. 페이지를 다시 불러옵니다.'); setTimeout(() => location.reload(), 800); return; }
    toast('저장했습니다');
    showView(state.stops.length ? 'review' : 'scan');
  }
  async function findHome() {
    const q = $('setHome').value.trim(); if (!q) { toast('출발지 주소를 입력하세요'); return; }
    settings.home = q;
    try {
      await ensureKakao();
      const r = await geocodeAddress(q);
      if (!r) { settings.homeLat = null; settings.homeLng = null; settings.homeFound = ''; saveSettings(); $('homeFound').textContent = '못 찾았습니다. 주소를 더 정확히 적어 주세요.'; return; }
      settings.homeLat = r.lat; settings.homeLng = r.lng; settings.homeFound = r.found; saveSettings();
      $('homeFound').textContent = '찾음: ' + r.found;
    } catch (e) { $('homeFound').textContent = '지도 키가 없어서 좌표를 못 찾습니다.'; }
  }

  // ---------- 카카오 지도 SDK ----------
  let kakaoState = 'idle'; let kakaoPromise = null; let geocoder = null; let places = null; let map = null;
  function ensureKakao() {
    if (kakaoPromise) return kakaoPromise;
    const key = kakaoKey();
    if (!key) { kakaoState = 'error'; renderKeyStatus(); return Promise.reject(new Error('no key')); }
    kakaoState = 'loading';
    kakaoPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&libraries=services&autoload=false';
      s.onload = () => {
        try {
          window.kakao.maps.load(() => {
            geocoder = new window.kakao.maps.services.Geocoder();
            places = new window.kakao.maps.services.Places();
            kakaoState = 'ok'; renderKeyStatus(); resolve();
          });
        } catch (e) { kakaoState = 'error'; renderKeyStatus(); reject(e); }
      };
      s.onerror = () => { kakaoState = 'error'; renderKeyStatus(); reject(new Error('kakao sdk load failed')); };
      document.head.appendChild(s);
    });
    // 카카오내비 호출용 JS SDK (실패해도 됨)
    const n = document.createElement('script');
    n.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
    n.onload = () => { try { if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init(key); } catch (e) { /* 무시 */ } };
    document.head.appendChild(n);
    return kakaoPromise;
  }

  function pickDoc(docs) {
    if (!docs || !docs.length) return null;
    const region = (settings.region || '').split(/\s+/).filter(Boolean);
    const sigung = region.find((t) => /(시|군)$/.test(t));
    if (sigung) { const hit = docs.find((d) => (d.address_name || '').includes(sigung)); if (hit) return hit; }
    return docs[0];
  }
  function geocodeAddress(q) {
    return new Promise((resolve) => {
      if (!geocoder) return resolve(null);
      geocoder.addressSearch(q, (result, status) => {
        if (status !== window.kakao.maps.services.Status.OK || !result.length) return resolve(null);
        const d = pickDoc(result);
        const found = (d.road_address && d.road_address.address_name) || d.address_name;
        resolve({ lat: parseFloat(d.y), lng: parseFloat(d.x), found, jibun: d.address && d.address.address_name, road: d.road_address && d.road_address.address_name });
      });
    });
  }
  function keywordSearch(q) {
    return new Promise((resolve) => {
      if (!places) return resolve(null);
      places.keywordSearch(q, (result, status) => {
        if (status !== window.kakao.maps.services.Status.OK || !result.length) return resolve(null);
        resolve(result.slice(0, 5).map((d) => ({ lat: parseFloat(d.y), lng: parseFloat(d.x), found: (d.road_address_name || d.address_name) + (d.place_name ? ' (' + d.place_name + ')' : ''), jibun: d.address_name, road: d.road_address_name, place: d.place_name })));
      });
    });
  }
  function learn(r) {
    for (const s of [r && r.jibun, r && r.road, r && r.found]) for (const t of Core.learnTokens(s)) dict.add(t);
    saveDict();
  }

  // 한 줄 → 좌표. 시도 순서: 원문 → 사전 보정본 → 키워드 검색
  async function geocodeStop(stop) {
    stop.status = 'searching'; stop.found = ''; renderRowStatus(stop);
    const base = Core.cleanLine(stop.addr);
    if (!base) { stop.status = 'fail'; renderRowStatus(stop); return false; }
    const tries = [];
    const q1 = Core.withRegion(base, settings.region);
    tries.push({ q: q1, kind: 'addr' });
    const corr = Core.correctWithDict(base, dict);
    if (corr.changed.length) tries.push({ q: Core.withRegion(corr.addr, settings.region), kind: 'addr', changed: corr.changed });
    if (!Core.hasRegion(base)) tries.push({ q: base, kind: 'addr' });
    tries.push({ q: q1, kind: 'kw' });
    if (corr.changed.length) tries.push({ q: Core.withRegion(corr.addr, settings.region), kind: 'kw', changed: corr.changed });
    for (const t of tries) {
      let r = null;
      if (t.kind === 'addr') r = await geocodeAddress(t.q);
      else {
        const list = await keywordSearch(t.q);
        if (list) {
          const num = (t.q.match(/\d+(?:-\d+)?(?=\D*$)/) || [''])[0];
          const toks = t.q.split(' ').filter((x) => /(읍|면|동|리|로|길|대로)$/.test(x));
          r = list.find((d) => { const a = (d.road || '') + ' ' + (d.jibun || ''); return (num && a.includes(num)) || toks.some((x) => a.includes(x)); }) || null;
        }
      }
      if (r) {
        stop.lat = r.lat; stop.lng = r.lng; stop.found = r.found; stop.status = 'ok';
        if (t.changed) { stop.addr = corr.addr; stop.fixed = t.changed.map((c) => c[0] + '→' + c[1]).join(', '); }
        learn(r); renderRowStatus(stop); return true;
      }
    }
    stop.status = 'fail'; renderRowStatus(stop); return false;
  }

  // ---------- OCR ----------
  let ocrWorker = null; let ocrCancel = false; let wakeLock = null;
  const phase = { base: 0, span: 0.4 };
  function onOcrLog(m) {
    if (m.status === 'recognizing text') setProgress('글자 읽는 중', (phase.base + phase.span * (m.progress || 0)) * 100);
    else if (m.status && /loading|initializ/.test(m.status)) setProgress('인식 엔진 준비 중 (처음 한 번만 오래 걸림)', (m.progress || 0) * 5);
  }
  async function getWorker() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract) throw new Error('OCR 엔진 파일(tess/)을 불러오지 못했습니다');
    const base = new URL('tess/', location.href).href;
    ocrWorker = await window.Tesseract.createWorker('kor', 1, {
      workerPath: base + 'worker.min.js', corePath: base, langPath: base, workerBlobURL: false, gzip: true,
      logger: onOcrLog,
    });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    return ocrWorker;
  }
  function setProgress(status, pct) {
    $('ocrStatus').textContent = status; $('ocrPct').textContent = Math.round(pct) + '%'; $('ocrBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => resolve({ img, url }); img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없습니다')); };
      img.src = url;
    });
  }
  // 흑백 + 명암 늘리기 (+ 선택: 3x3 중앙값 잡티 제거)
  function preprocess(img, maxSide, median) {
    const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)); const ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const id = ctx.getImageData(0, 0, cw, ch); const px = id.data; const n = cw * ch;
    let g = new Uint8ClampedArray(n); const hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000; g[i] = v; hist[v | 0]++; }
    let lo = 0, hi = 255, acc = 0; const p2 = n * 0.02, p98 = n * 0.98;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= p2) { lo = v; break; } }
    acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= p98) { hi = v; break; } }
    if (hi - lo < 10) hi = lo + 10;
    const k = 255 / (hi - lo);
    for (let i = 0; i < n; i++) g[i] = (g[i] - lo) * k;
    if (median) {
      const o = new Uint8ClampedArray(n); const win = new Uint8Array(9);
      for (let y = 1; y < ch - 1; y++) {
        for (let x = 1; x < cw - 1; x++) {
          let t = 0;
          for (let dy = -1; dy <= 1; dy++) { const r = (y + dy) * cw + x; win[t++] = g[r - 1]; win[t++] = g[r]; win[t++] = g[r + 1]; }
          // 9개 중 중앙값 (부분 정렬)
          for (let a = 0; a < 5; a++) { let m = a; for (let b = a + 1; b < 9; b++) if (win[b] < win[m]) m = b; const tmp = win[a]; win[a] = win[m]; win[m] = tmp; }
          o[y * cw + x] = win[4];
        }
      }
      for (let x = 0; x < cw; x++) { o[x] = g[x]; o[(ch - 1) * cw + x] = g[(ch - 1) * cw + x]; }
      for (let y = 0; y < ch; y++) { o[y * cw] = g[y * cw]; o[y * cw + cw - 1] = g[y * cw + cw - 1]; }
      g = o;
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) { px[j] = px[j + 1] = px[j + 2] = g[i]; px[j + 3] = 255; }
    ctx.putImageData(id, 0, 0);
    return { canvas: c, scale };
  }
  function linesOf(data, pass) {
    const h = pass.canvas.height; const out = [];
    for (const l of (data.lines || [])) {
      const text = (l.text || '').replace(/\n/g, ' ').trim(); if (!text) continue;
      const words = (l.words || []).map((w) => ({ text: (w.text || '').trim(), bbox: w.bbox })).filter((w) => w.text && w.bbox);
      out.push({ text, conf: l.confidence || 0, y0: l.bbox.y0 / h, y1: l.bbox.y1 / h, bbox: l.bbox, words, pass });
    }
    return out;
  }
  function mergeLines(A, B) {
    const used = new Set(); const out = [];
    for (const a of A) {
      let best = null; let bestOv = 0;
      B.forEach((b, i) => {
        if (used.has(i)) return;
        const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); const hmin = Math.min(a.y1 - a.y0, b.y1 - b.y0) || 1;
        if (ov / hmin > 0.5 && ov > bestOv) { bestOv = ov; best = i; }
      });
      if (best != null) {
        used.add(best); const b = B[best];
        out.push(b.conf > a.conf + 2 ? Object.assign({}, b, { bbox: a.bbox, words: a.words, pass: a.pass, alt: a.text }) : Object.assign({}, a, { alt: b.text }));
      } else out.push(a);
    }
    B.forEach((b, i) => { if (!used.has(i) && b.conf >= 60) out.push(b); });
    out.sort((x, y) => x.y0 - y.y0);
    return out;
  }
  // 주소에 해당하는 단어들만 잘라서 썸네일로 (못 고르면 줄 전체)
  function addrBox(line, addr) {
    if (!addr || !line.words || line.words.length < 2) return line.bbox;
    const norm = (s) => s.replace(/\s+/g, '');
    const target = norm(addr);
    const nums = addr.match(/\d+(?:-\d+)?/g) || [];
    const picked = line.words.filter((w) => {
      const c = norm(Core.cleanLine(w.text)); if (!c) return false;
      if (c.length >= 2 && target.includes(c)) return true;
      return nums.includes(c);
    });
    if (picked.length < 2) return line.bbox;
    picked.sort((p, q) => p.bbox.x0 - q.bbox.x0);
    const lh = Math.max(8, line.bbox.y1 - line.bbox.y0);
    // x축으로 붙어 있는 가장 큰 덩어리만 사용 (줄 번호 같은 떨어진 단어 제외)
    let best = [picked[0]]; let cur = [picked[0]];
    for (let i = 1; i < picked.length; i++) {
      if (picked[i].bbox.x0 - cur[cur.length - 1].bbox.x1 <= lh * 2.5) cur.push(picked[i]); else cur = [picked[i]];
      if (cur.length > best.length) best = cur;
    }
    return { x0: Math.min(...best.map((w) => w.bbox.x0)), x1: Math.max(...best.map((w) => w.bbox.x1)), y0: line.bbox.y0, y1: line.bbox.y1 };
  }
  function thumbOf(line, addr) {
    try {
      const { canvas } = line.pass; const b = addrBox(line, addr); const pad = 6; const vpad = 3;
      const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - vpad), x1 = Math.min(canvas.width, b.x1 + pad), y1 = Math.min(canvas.height, b.y1 + vpad);
      const w = x1 - x0, h = y1 - y0; if (w < 4 || h < 4) return '';
      const th = 44; const tw = Math.min(900, Math.round(w * th / h));
      const t = document.createElement('canvas'); t.width = tw; t.height = th;
      t.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, tw, th);
      return t.toDataURL('image/jpeg', 0.6);
    } catch (e) { return ''; }
  }

  async function scanFiles(files) {
    if (!files || !files.length) return;
    ocrCancel = false;
    $('ocrProgress').hidden = false; $('manualCard').hidden = true;
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* 선택 사항 */ }
    let added = 0; let excludedAdded = 0;
    try {
      phase.base = 0; phase.span = 0.4;
      const worker = await getWorker();
      for (let fi = 0; fi < files.length; fi++) {
        if (ocrCancel) break;
        const file = files[fi];
        setProgress((files.length > 1 ? (fi + 1) + '/' + files.length + ' ' : '') + '사진 준비 중', 5);
        const { img, url } = await loadImage(file);
        const passA = preprocess(img, 2000, true);
        const passB = preprocess(img, 1400, false);
        URL.revokeObjectURL(url);
        phase.base = 0.1; phase.span = 0.45;
        const ra = await worker.recognize(passA.canvas, {}, { text: true, blocks: true });
        if (ocrCancel) break;
        phase.base = 0.55; phase.span = 0.4;
        const rb = await worker.recognize(passB.canvas, {}, { text: true, blocks: true });
        if (ocrCancel) break;
        setProgress('주소 골라내는 중', 97);
        const lines = mergeLines(linesOf(ra.data, passA), linesOf(rb.data, passB));
        for (const ln of lines) {
          const r = Core.extractAddress(ln.text);
          if (!r) continue;
          const hasKo = /[가-힣]{2}/.test(r.text); const hasNum = /\d/.test(r.text);
          if (r.ok) {
            state.stops.push({ id: uid(), text: ln.text, addr: r.addr, name: r.name, note: r.note, conf: Math.round(ln.conf), status: 'pending', done: false, lat: null, lng: null, found: '', thumb: thumbOf(ln, r.addr) });
            added++;
          } else if (hasKo && hasNum && r.text.length >= 6) {
            state.excluded.push({ id: uid(), text: r.text, thumb: thumbOf(ln) });
            excludedAdded++;
          }
        }
      }
      saveState();
      setProgress('완료', 100);
      if (ocrCancel) toast('취소했습니다');
      else if (!added) toast('주소로 보이는 줄을 못 찾았습니다. 더 가까이, 선명하게 찍어 보세요.' + (excludedAdded ? ' (뺀 줄 ' + excludedAdded + '개는 목록 아래에서 볼 수 있습니다)' : ''), 4000);
      else toast('주소 ' + added + '줄을 읽었습니다. 틀린 글자가 있으면 고쳐 주세요.', 3500);
      if (added || excludedAdded) showView('review');
    } catch (e) {
      console.error(e);
      toast('인식 중 문제가 생겼습니다: ' + (e && e.message ? e.message : e), 5000);
    } finally {
      $('ocrProgress').hidden = true; $('fileCamera').value = ''; $('fileGallery').value = '';
      try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) { /* 무시 */ }
      updateCounts();
    }
  }

  // ---------- 목록(검토) 화면 ----------
  function updateCounts() {
    $('cntReview').textContent = state.stops.length ? state.stops.length : '';
    $('cntCourse').textContent = state.order.length ? state.order.length : '';
  }
  function statusChip(s) {
    if (s.status === 'ok') return '<span class="chip ok">찾음</span>';
    if (s.status === 'fail') return '<span class="chip bad">못 찾음</span>';
    if (s.status === 'searching') return '<span class="chip">찾는 중…</span>';
    return '<span class="chip">확인 전</span>';
  }
  function renderRows() {
    const ul = $('rows'); ul.innerHTML = '';
    const okN = state.stops.filter((s) => s.status === 'ok').length; const failN = state.stops.filter((s) => s.status === 'fail').length;
    $('reviewStat').textContent = state.stops.length ? state.stops.length + '줄 · 찾음 ' + okN + (failN ? ' · 못 찾음 ' + failN : '') : '';
    $('btnBuild').disabled = !state.stops.length;
    for (const s of state.stops) {
      const li = document.createElement('li'); li.className = 'row ' + (s.status === 'ok' ? 'ok' : s.status === 'fail' ? 'fail' : ''); li.dataset.id = s.id;
      li.innerHTML = (s.thumb ? '<div class="stripbox"><img class="strip" alt="원본 줄" src="' + s.thumb + '"></div>' : '') +
        '<input class="addr" type="text" value="' + esc(s.addr) + '" aria-label="주소">' +
        '<div class="meta">' + statusChip(s) + (s.name ? '<span class="chip">' + esc(s.name) + '</span>' : '') +
        '<span class="found">' + esc(s.found || (s.fixed ? '보정: ' + s.fixed : '') || s.note || '') + '</span>' +
        '<span class="actions"><button type="button" class="btn sm" data-act="find">찾기</button><button type="button" class="btn sm" data-act="del" aria-label="삭제">✕</button></span></div>';
      ul.appendChild(li);
    }
    const ex = $('excludedBox'); ex.hidden = !state.excluded.length; $('excludedCount').textContent = state.excluded.length;
    const exUl = $('excludedRows'); exUl.innerHTML = '';
    for (const e of state.excluded) {
      const li = document.createElement('li'); li.className = 'row'; li.dataset.id = e.id;
      li.innerHTML = (e.thumb ? '<div class="stripbox"><img class="strip" alt="원본 줄" src="' + e.thumb + '"></div>' : '') + '<div class="meta"><span class="found">' + esc(e.text) + '</span><span class="actions"><button type="button" class="btn sm" data-act="restore">주소로 쓰기</button><button type="button" class="btn sm" data-act="exdel" aria-label="삭제">✕</button></span></div>';
      exUl.appendChild(li);
    }
    renderStartSeg(); updateCounts();
  }
  function renderRowStatus(s) {
    const li = document.querySelector('#rows li[data-id="' + s.id + '"]'); if (!li) return;
    li.className = 'row ' + (s.status === 'ok' ? 'ok' : s.status === 'fail' ? 'fail' : '');
    const meta = li.querySelector('.meta'); if (!meta) return;
    meta.querySelector('.chip').outerHTML = statusChip(s);
    meta.querySelector('.found').textContent = s.found || (s.fixed ? '보정: ' + s.fixed : '') || s.note || '';
    const inp = li.querySelector('.addr'); if (inp && inp.value !== s.addr) inp.value = s.addr;
    const okN = state.stops.filter((x) => x.status === 'ok').length; const failN = state.stops.filter((x) => x.status === 'fail').length;
    $('reviewStat').textContent = state.stops.length + '줄 · 찾음 ' + okN + (failN ? ' · 못 찾음 ' + failN : '');
  }
  function renderStartSeg() {
    document.querySelectorAll('#startSeg button').forEach((b) => b.classList.toggle('active', b.dataset.start === state.start.type));
    const hint = $('startHint');
    if (state.start.type === 'home') hint.textContent = settings.homeFound ? '출발: ' + settings.homeFound : '설정에서 기본 출발지(회사 주소)를 먼저 넣어 주세요.';
    else if (state.start.type === 'gps') hint.textContent = '위치 권한을 물어보면 허용해 주세요. 못 잡으면 기본 출발지를 씁니다.';
    else hint.textContent = '목록의 첫 번째 주소에서 출발합니다.';
  }
  function onRowsClick(e) {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const li = btn.closest('li'); const id = li && li.dataset.id; if (!id) return;
    const act = btn.dataset.act;
    if (act === 'del') { state.stops = state.stops.filter((s) => s.id !== id); state.order = state.order.filter((x) => x !== id); saveState(); renderRows(); return; }
    if (act === 'exdel') { state.excluded = state.excluded.filter((s) => s.id !== id); saveState(); renderRows(); return; }
    if (act === 'restore') {
      const e2 = state.excluded.find((s) => s.id === id); if (!e2) return;
      state.excluded = state.excluded.filter((s) => s.id !== id);
      state.stops.push({ id: uid(), text: e2.text, addr: e2.text, name: '', note: '', status: 'pending', done: false, lat: null, lng: null, found: '', thumb: e2.thumb || '' });
      saveState(); renderRows(); return;
    }
    if (act === 'find') {
      const s = state.stops.find((x) => x.id === id); if (!s) return;
      const inp = li.querySelector('.addr'); if (inp) s.addr = inp.value.trim();
      ensureKakao().then(() => geocodeStop(s)).then(() => saveState()).catch(() => toast('지도 키가 없거나 불러오지 못했습니다. 설정에서 확인하세요.', 4000));
    }
  }
  function onRowsInput(e) {
    const inp = e.target.closest('input.addr'); if (!inp) return;
    const li = inp.closest('li'); const s = state.stops.find((x) => x.id === li.dataset.id); if (!s) return;
    if (s.addr !== inp.value.trim()) { s.addr = inp.value.trim(); s.status = 'pending'; s.found = ''; s.fixed = ''; s.lat = null; s.lng = null; renderRowStatus(s); saveState(); }
  }
  function addManual() {
    const lines = $('manualText').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!lines.length) { toast('주소를 한 줄에 하나씩 적어 주세요'); return; }
    let n = 0;
    for (const ln of lines) {
      const r = Core.extractAddress(ln); const addr = r && r.ok ? r.addr : Core.cleanLine(ln); if (!addr) continue;
      state.stops.push({ id: uid(), text: ln, addr, name: r && r.ok ? r.name : '', note: r && r.ok ? r.note : '', status: 'pending', done: false, lat: null, lng: null, found: '', thumb: '' }); n++;
    }
    $('manualText').value = ''; $('manualCard').hidden = true; saveState(); toast(n + '줄 추가'); showView('review');
  }

  // ---------- 코스 만들기 ----------
  function getGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }
  async function resolveStart() {
    const t = state.start.type;
    if (t === 'gps') {
      toast('현재 위치 잡는 중…'); const g = await getGps();
      if (g) return Object.assign({ type: 'gps', label: '현재 위치' }, g);
      toast('현재 위치를 못 잡았습니다. 기본 출발지를 씁니다.', 3500);
    }
    if (t !== 'first') {
      if (settings.home && !settings.homeLat) { const r = await geocodeAddress(settings.home); if (r) { settings.homeLat = r.lat; settings.homeLng = r.lng; settings.homeFound = r.found; saveSettings(); } }
      if (settings.homeLat) return { type: 'home', label: settings.homeFound || settings.home, lat: settings.homeLat, lng: settings.homeLng };
      if (t === 'home') toast('기본 출발지가 없어서 첫 번째 주소에서 출발합니다.', 3500);
    }
    const first = state.stops.find((s) => s.status === 'ok');
    return first ? { type: 'first', label: first.addr, lat: first.lat, lng: first.lng } : null;
  }
  async function osrmTrip(start, pts) {
    const coords = [start].concat(pts).map((p) => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
    const url = 'https://router.project-osrm.org/trip/v1/driving/' + coords + '?source=first&roundtrip=false&overview=full&geometries=geojson';
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal }); clearTimeout(timer);
      if (!res.ok) return null; const j = await res.json();
      if (j.code !== 'Ok' || !j.trips || !j.trips.length) return null;
      const order = j.waypoints.map((w, i) => ({ i, pos: w.waypoint_index })).filter((x) => x.i > 0).sort((a, b) => a.pos - b.pos).map((x) => x.i - 1);
      const legs = j.trips[0].legs.map((l) => l.distance);
      const geom = (j.trips[0].geometry.coordinates || []).map((c) => [c[1], c[0]]);
      return { order, legs, geom, total: j.trips[0].distance };
    } catch (e) { clearTimeout(timer); return null; }
  }
  async function buildCourse() {
    if (!state.stops.length) return;
    $('btnBuild').disabled = true; $('btnBuild').textContent = '주소 찾는 중…';
    try {
      try { await ensureKakao(); } catch (e) { toast('지도 키가 없어서 좌표를 찾을 수 없습니다. 설정 → 지도 키를 확인하세요.', 5000); showView('settings'); return; }
      for (const s of state.stops) { if (s.status !== 'ok') await geocodeStop(s); }
      saveState();
      const ok = state.stops.filter((s) => s.status === 'ok');
      if (!ok.length) { toast('좌표를 찾은 주소가 없습니다. 주소를 고친 뒤 다시 눌러 주세요.', 4000); return; }
      const failN = state.stops.length - ok.length;
      $('btnBuild').textContent = '순서 계산 중…';
      await computeOrder();
      if (failN) toast('못 찾은 ' + failN + '줄은 코스에서 뺐습니다. 목록에서 고치고 다시 만들면 들어갑니다.', 5000);
      showView('course');
    } finally { $('btnBuild').disabled = false; $('btnBuild').textContent = '지도에 올리고 순서 만들기'; }
  }
  async function computeOrder() {
    const ok = state.stops.filter((s) => s.status === 'ok');
    const start = await resolveStart(); if (!start) return;
    let pts = ok; let startPt = start;
    if (start.type === 'first') { pts = ok.slice(1); }
    let result = null;
    if (settings.road && pts.length) result = await osrmTrip(startPt, pts);
    let orderIdx; let legs; let geom; let total; let mode;
    if (result) { orderIdx = result.order; legs = result.legs; geom = result.geom; total = result.total; mode = 'road'; }
    else {
      orderIdx = Core.orderNearest(startPt, pts); mode = 'line';
      legs = []; let prev = startPt; total = 0; geom = [[startPt.lat, startPt.lng]];
      for (const i of orderIdx) { const d = Core.haversine(prev, pts[i]); legs.push(d); total += d; prev = pts[i]; geom.push([pts[i].lat, pts[i].lng]); }
    }
    const order = orderIdx.map((i) => pts[i].id);
    if (start.type === 'first') { order.unshift(ok[0].id); legs.unshift(0); }
    state.order = order; state.start = { type: start.type, label: start.label, lat: start.lat, lng: start.lng };
    state.route = { mode, legs, geom, total }; state.builtAt = Date.now();
    for (const s of state.stops) s.done = false;
    saveState(); updateCounts();
    if (!result && settings.road) toast('도로 경로 서버 응답이 없어 직선거리로 순서를 정했습니다.', 4000);
  }

  // ---------- 코스 화면 ----------
  let overlays = []; let polyline = null;
  function orderedStops() { return state.order.map((id) => state.stops.find((s) => s.id === id)).filter(Boolean); }
  function nextStop() { return orderedStops().find((s) => !s.done) || null; }
  function renderCourse() {
    const list = orderedStops(); const ul = $('stops'); ul.innerHTML = '';
    const nx = nextStop();
    $('nextCard').hidden = !nx; $('allDoneCard').hidden = !(list.length && !nx);
    if (nx) { const no = list.indexOf(nx) + 1; $('nextTitle').textContent = no + '번 ' + (nx.name || ''); $('nextAddr').textContent = nx.found || nx.addr; }
    const r = state.route;
    $('courseSummary').innerHTML = list.length ? '<span>총 <b>' + list.length + '</b>곳</span><span>완료 <b>' + list.filter((s) => s.done).length + '</b></span>' + (r ? '<span>거리 <b>' + Core.fmtDist(r.total) + '</b> ' + (r.mode === 'road' ? '(도로 기준)' : '(직선 기준)') + '</span>' : '') + (state.start && state.start.label ? '<span>출발: ' + esc(state.start.label) + '</span>' : '') : '<span>아직 코스가 없습니다. 스캔 → 목록 → 순서 만들기 순서로 진행하세요.</span>';
    list.forEach((s, i) => {
      const li = document.createElement('li'); li.className = 'stop' + (s.done ? ' done' : '') + (s === nx ? ' next' : ''); li.dataset.id = s.id;
      const leg = r && r.legs ? r.legs[i] : null;
      const same = (s.found || '').replace(/\s+/g, '') === (s.addr || '').replace(/\s+/g, '');
      const t2 = [same ? '' : (s.found || ''), leg ? '이전에서 ' + Core.fmtDist(leg) : '', s.note || ''].filter(Boolean).map(esc).join(' · ');
      li.innerHTML = '<div class="badge">' + (i + 1) + '</div>' +
        '<div class="txt"><div class="t1">' + esc(s.name ? s.name + ' · ' : '') + esc(s.addr) + '</div>' + (t2 ? '<div class="t2">' + t2 + '</div>' : '') + '</div>' +
        '<div class="ctl"><button type="button" class="btn primary" data-act="nav">내비 ▸</button><button type="button" class="btn" data-act="done">' + (s.done ? '되돌리기' : '완료') + '</button></div>';
      ul.appendChild(li);
    });
    renderMap();
  }
  async function renderMap() {
    const list = orderedStops(); const msg = $('mapMsg');
    if (!list.length) { msg.hidden = false; msg.textContent = '코스를 만들면 여기에 지도가 나옵니다.'; return; }
    try { await ensureKakao(); } catch (e) { msg.hidden = false; msg.textContent = '지도를 못 불러왔습니다. 설정 → 지도 키 상태를 확인하세요. (등록 도메인: ' + location.origin + ')'; return; }
    msg.hidden = true;
    const K = window.kakao.maps;
    if (!map) { map = new K.Map($('map'), { center: new K.LatLng(list[0].lat, list[0].lng), level: 6 }); }
    for (const o of overlays) o.setMap(null); overlays = [];
    if (polyline) { polyline.setMap(null); polyline = null; }
    const nx = nextStop();
    if (state.start && state.start.lat) {
      const so = new K.CustomOverlay({ position: new K.LatLng(state.start.lat, state.start.lng), content: '<div class="pin start"><b>출발</b></div>', yAnchor: 0.5 });
      so.setMap(map); overlays.push(so);
    }
    list.forEach((s, i) => {
      const el = document.createElement('div'); el.className = 'pin' + (s.done ? ' done' : '') + (s === nx ? ' next' : ''); el.innerHTML = '<b>' + (i + 1) + '</b>';
      el.addEventListener('click', () => openSheet(s)); el.addEventListener('touchend', (e) => { e.preventDefault(); openSheet(s); });
      const ov = new K.CustomOverlay({ position: new K.LatLng(s.lat, s.lng), content: el, yAnchor: 1 });
      ov.setMap(map); overlays.push(ov);
    });
    const path = (state.route && state.route.geom && state.route.geom.length > 1) ? state.route.geom.map((c) => new K.LatLng(c[0], c[1])) : list.map((s) => new K.LatLng(s.lat, s.lng));
    polyline = new K.Polyline({ path, strokeWeight: 5, strokeColor: '#0b6e5c', strokeOpacity: 0.8, strokeStyle: 'solid' });
    polyline.setMap(map);
    fitMap();
  }
  function fitMap() {
    if (!map || !window.kakao) return;
    const list = orderedStops(); if (!list.length) return;
    const K = window.kakao.maps; const b = new K.LatLngBounds();
    list.forEach((s) => b.extend(new K.LatLng(s.lat, s.lng)));
    if (state.start && state.start.lat) b.extend(new K.LatLng(state.start.lat, state.start.lng));
    map.setBounds(b, 30, 30, 30, 30);
  }
  function onStopsClick(e) {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const li = btn.closest('li'); const s = state.stops.find((x) => x.id === li.dataset.id); if (!s) return;
    if (btn.dataset.act === 'done') { s.done = !s.done; saveState(); renderCourse(); return; }
    if (btn.dataset.act === 'nav') openSheet(s);
  }

  // ---------- 내비 연결 ----------
  let sheetStop = null;
  function openSheet(s) {
    sheetStop = s; const list = orderedStops(); const no = list.indexOf(s) + 1;
    $('sheetNo').textContent = no || '·'; $('sheetTitle').textContent = (s.name ? s.name + ' · ' : '') + s.addr; $('sheetAddr').textContent = s.found || '';
    $('sheetDone').textContent = s.done ? '되돌리기' : '완료 표시';
    document.querySelectorAll('.navgrid button[data-nav]').forEach((b) => b.classList.toggle('primary', b.dataset.nav === (settings.nav || 'kakaonavi')));
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; sheetStop = null; }
  const ua = navigator.userAgent || '';
  const isAndroid = /android/i.test(ua); const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function openScheme(scheme, intentUrl, fallbackUrl, failMsg) {
    if (isAndroid && intentUrl) { location.href = intentUrl; return; }
    if (isIOS || isAndroid) {
      const t0 = Date.now(); location.href = scheme;
      setTimeout(() => { if (!document.hidden && Date.now() - t0 < 2500) { if (fallbackUrl) location.href = fallbackUrl; else if (failMsg) toast(failMsg, 4000); } }, 1500);
      return;
    }
    if (fallbackUrl) window.open(fallbackUrl, '_blank'); else toast('휴대폰에서 눌러야 앱이 열립니다');
  }
  function openNav(app, s) {
    const name = (s.name ? s.name + ' ' : '') + (s.found || s.addr); const addr = s.found || s.addr;
    const has = s.lat != null && s.lng != null;
    if (app === 'copy') { copyText(addr); return; }
    if (app === 'kakaonavi') {
      if (has && window.Kakao && window.Kakao.Navi && window.Kakao.isInitialized && window.Kakao.isInitialized()) {
        try { window.Kakao.Navi.start({ name: name.slice(0, 40), x: s.lng, y: s.lat, coordType: 'wgs84' }); return; } catch (e) { /* 아래로 */ }
      }
      app = 'kakaomap';
    }
    if (app === 'kakaomap') {
      if (has) {
        const web = 'https://map.kakao.com/link/to/' + encodeURIComponent(name.slice(0, 40)) + ',' + s.lat + ',' + s.lng;
        openScheme('kakaomap://route?ep=' + s.lat + ',' + s.lng + '&by=CAR', 'intent://route?ep=' + s.lat + ',' + s.lng + '&by=CAR#Intent;scheme=kakaomap;package=net.daum.android.map;S.browser_fallback_url=' + encodeURIComponent(web) + ';end', web);
      } else {
        const web = 'https://map.kakao.com/link/search/' + encodeURIComponent(addr);
        openScheme('kakaomap://search?q=' + encodeURIComponent(addr), 'intent://search?q=' + encodeURIComponent(addr) + '#Intent;scheme=kakaomap;package=net.daum.android.map;S.browser_fallback_url=' + encodeURIComponent(web) + ';end', web);
      }
      return;
    }
    if (app === 'tmap') {
      const q = has ? 'route?goalname=' + encodeURIComponent(name.slice(0, 40)) + '&goalx=' + s.lng + '&goaly=' + s.lat : 'search?name=' + encodeURIComponent(addr);
      openScheme('tmap://' + q, 'intent://' + q + '#Intent;scheme=tmap;package=com.skt.tmap.ku;end', null, '티맵이 설치되어 있지 않은 것 같습니다');
      return;
    }
    if (app === 'naver') {
      const appname = encodeURIComponent(location.origin);
      const q = has ? 'route/car?dlat=' + s.lat + '&dlng=' + s.lng + '&dname=' + encodeURIComponent(name.slice(0, 40)) + '&appname=' + appname : 'search?query=' + encodeURIComponent(addr) + '&appname=' + appname;
      openScheme('nmap://' + q, 'intent://' + q + '#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end', null, '네이버지도가 설치되어 있지 않은 것 같습니다');
    }
  }
  function copyText(t) {
    const done = () => toast('복사했습니다: ' + t);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
    else fallbackCopy(t, done);
  }
  function fallbackCopy(t, done) {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('복사가 막혀 있습니다. 길게 눌러 복사하세요.'); } finally { document.body.removeChild(ta); }
  }

  // ---------- 코스 링크 공유 ----------
  function b64url(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function shareLink() {
    const list = orderedStops(); if (!list.length) { toast('공유할 코스가 없습니다'); return; }
    const payload = { v: 1, s: list.map((s) => [s.addr, s.name || '', s.found || '', s.lat, s.lng]), st: state.start && state.start.lat ? [state.start.lat, state.start.lng, state.start.label || ''] : null };
    const url = location.origin + location.pathname + '#c=' + b64url(JSON.stringify(payload));
    copyText(url); toast('코스 링크를 복사했습니다. 동료에게 보내면 같은 코스가 열립니다.', 3500);
  }
  function importFromHash() {
    const m = location.hash.match(/^#c=(.+)$/); if (!m) return false;
    try {
      const p = JSON.parse(unb64url(m[1])); if (!p || !Array.isArray(p.s)) return false;
      if (state.order.length && !window.confirm('받은 코스로 바꿀까요? 지금 코스는 지워집니다.')) { history.replaceState(null, '', location.pathname); return false; }
      state.stops = p.s.map((a) => ({ id: uid(), text: a[0], addr: a[0], name: a[1] || '', note: '', status: 'ok', done: false, lat: a[3], lng: a[4], found: a[2] || '', thumb: '' }));
      state.excluded = []; state.order = state.stops.map((s) => s.id);
      state.start = p.st ? { type: 'shared', lat: p.st[0], lng: p.st[1], label: p.st[2] } : { type: 'first' };
      let total = 0; const legs = []; let prev = state.start.lat ? state.start : null; const geom = [];
      if (prev) geom.push([prev.lat, prev.lng]);
      for (const s of state.stops) { const d = prev ? Core.haversine(prev, s) : 0; legs.push(d); total += d; prev = s; geom.push([s.lat, s.lng]); }
      state.route = { mode: 'line', legs, geom, total }; state.builtAt = Date.now();
      saveState(); history.replaceState(null, '', location.pathname); toast('받은 코스를 열었습니다'); return true;
    } catch (e) { history.replaceState(null, '', location.pathname); return false; }
  }

  // ---------- 스캔 화면 ----------
  function renderResume() {
    const has = state.order.length || state.stops.length; $('resumeCard').hidden = !has; if (!has) return;
    const list = orderedStops(); const done = list.filter((s) => s.done).length;
    $('resumeText').textContent = list.length ? '코스 ' + list.length + '곳 중 ' + done + '곳 완료' : '주소 ' + state.stops.length + '줄 (아직 순서를 안 만들었습니다)';
    $('btnResume').hidden = !list.length;
  }

  // ---------- 이벤트 연결 ----------
  function bind() {
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('btnSettings').addEventListener('click', () => showView('settings'));
    $('btnCloseSettings').addEventListener('click', () => showView(state.order.length ? 'course' : state.stops.length ? 'review' : 'scan'));
    $('btnSaveSettings').addEventListener('click', saveSettingsFromForm);
    $('btnHomeFind').addEventListener('click', findHome);
    $('btnDictReset').addEventListener('click', () => { dict = new Set(SEED_DICT); saveDict(); $('dictCount').textContent = dict.size; toast('지명 사전을 기본값으로 되돌렸습니다'); });
    $('fileCamera').addEventListener('change', (e) => scanFiles(Array.from(e.target.files || [])));
    $('fileGallery').addEventListener('change', (e) => scanFiles(Array.from(e.target.files || [])));
    $('btnCancelOcr').addEventListener('click', () => { ocrCancel = true; toast('취소하는 중…'); });
    $('btnManual').addEventListener('click', () => { $('manualCard').hidden = false; $('manualText').focus(); });
    $('btnManualClose').addEventListener('click', () => { $('manualCard').hidden = true; });
    $('btnManualAdd').addEventListener('click', addManual);
    $('btnResume').addEventListener('click', () => showView('course'));
    $('btnResumeList').addEventListener('click', () => showView('review'));
    $('rows').addEventListener('click', onRowsClick); $('rows').addEventListener('change', onRowsInput);
    $('excludedRows').addEventListener('click', onRowsClick);
    $('btnAddRow').addEventListener('click', () => { state.stops.push({ id: uid(), text: '', addr: '', name: '', note: '', status: 'pending', done: false, lat: null, lng: null, found: '', thumb: '' }); saveState(); renderRows(); const last = $('rows').lastElementChild; if (last) last.querySelector('.addr').focus(); });
    $('btnScanMore').addEventListener('click', () => showView('scan'));
    $('btnClearRows').addEventListener('click', () => { if (!state.stops.length || window.confirm('주소 목록을 전부 지울까요?')) { state.stops = []; state.excluded = []; state.order = []; state.route = null; saveState(); renderRows(); } });
    document.querySelectorAll('#startSeg button').forEach((b) => b.addEventListener('click', () => { state.start = { type: b.dataset.start }; saveState(); renderStartSeg(); }));
    $('btnBuild').addEventListener('click', buildCourse);
    $('stops').addEventListener('click', onStopsClick);
    $('btnNextNav').addEventListener('click', () => { const nx = nextStop(); if (nx) openNav(settings.nav || 'kakaonavi', nx); });
    $('btnReorder').addEventListener('click', async () => { if (!state.stops.some((s) => s.status === 'ok')) { toast('먼저 목록에서 순서를 만들어 주세요'); return; } toast('순서 다시 계산 중…'); try { await ensureKakao(); } catch (e) { /* 출발지 좌표가 이미 있으면 진행 */ } await computeOrder(); renderCourse(); });
    $('btnShare').addEventListener('click', shareLink);
    $('btnNewCourse').addEventListener('click', () => { if (window.confirm('새 코스를 시작할까요? 지금 코스와 목록이 지워집니다.')) { state.stops = []; state.excluded = []; state.order = []; state.route = null; saveState(); updateCounts(); showView('scan'); } });
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
    $('sheetDone').addEventListener('click', () => { if (!sheetStop) return; sheetStop.done = !sheetStop.done; saveState(); closeSheet(); renderCourse(); });
    document.querySelectorAll('.navgrid button[data-nav]').forEach((b) => b.addEventListener('click', () => { if (sheetStop) openNav(b.dataset.nav, sheetStop); }));
    window.addEventListener('hashchange', () => { if (importFromHash()) showView('course'); });
  }

  function init() {
    $('brand').textContent = CFG.APP_NAME || '스캔코스'; document.title = CFG.APP_NAME || '스캔코스';
    bind();
    const imported = importFromHash();
    updateCounts();
    if (kakaoKey()) ensureKakao().catch(() => { /* 상태 표시로 알림 */ });
    if (imported || state.order.length) showView('course');
    else if (state.stops.length) showView('review');
    else showView('scan');
  }
  init();
})();
