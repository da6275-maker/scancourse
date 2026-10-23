/* core.js — 순수 로직 (브라우저/Node 공용): 텍스트 정리, 주소 추출, 지명 사전 보정, 순서 계산 */
(function (root) {
  'use strict';

  // ---------- 한글 자모 분해 ----------
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';

  function toJamo(str) {
    let out = '';
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const idx = code - 0xac00;
        const cho = Math.floor(idx / 588);
        const jung = Math.floor((idx % 588) / 28);
        const jong = idx % 28;
        out += CHO[cho] + JUNG[jung] + (jong ? JONG[jong] : '');
      } else {
        out += ch;
      }
    }
    return out;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length; const n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // ---------- 텍스트 정리 ----------
  const PROVINCES = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|경상북|경상남|경북|경남|제주';
  const SUFFIX = '특별자치시|특별자치도|특별시|광역시|시|군|구|읍|면|동|리|가|대로|로|길';

  function cleanLine(s) {
    if (!s) return '';
    s = String(s).normalize('NFC');
    // 전각 숫자/영문 → 반각
    s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    s = s.replace(/[—–ー―ㅡ_~]/g, '-');
    s = s.replace(/[ \t　]+/g, ' ').trim();
    // 숫자 덩어리 안의 O/o→0, l/I/|→1
    s = s.replace(/(?<=[\d-])[oO]|[oO](?=[\d-])/g, '0');
    s = s.replace(/(?<=[\d-])[lI|]|[lI|](?=[\d-])/g, '1');
    // 전화번호 제거 (앞뒤가 숫자/하이픈이 아닌 자리에서만)
    s = s.replace(/(?<![\d-])0\d{1,2}[-. ]{0,2}\d{3,4}[-. ]{0,2}\d{4}(?!\d)/g, ' ');
    // 쓸데없는 기호 제거
    s = s.replace(/[^\p{Script=Hangul}\p{L}\d\s\-(),.·]/gu, ' ');
    // 로/길/읍/면/동/리 뒤에 바로 숫자가 붙으면 띄움
    s = s.replace(/(읍|면|동|리|가|로|길)(\d)/g, '$1 $2');
    s = s.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
    return s;
  }

  const ADDR_RE = new RegExp(
    '(?:(?:' + PROVINCES + ')[가-힣]{0,6}\\s*)?' +
    '(?:[가-힣A-Za-z0-9]{1,14}(?:' + SUFFIX + ')\\s*)+' +
    '\\d{1,5}(?:-\\d{1,4})?(?:번지)?',
    'g'
  );

  // 한 줄에서 주소 부분, 이름(앞), 비고(뒤)를 분리
  function extractAddress(line) {
    const text = cleanLine(line);
    if (!text) return null;
    let best = null;
    for (const m of text.matchAll(ADDR_RE)) {
      if (!/[가-힣]/.test(m[0])) continue;
      if (!best || m[0].length > best[0].length) best = m;
    }
    if (!best) return { ok: false, text, addr: '', name: '', note: '' };
    const addr = best[0].replace(/\s+/g, ' ').trim();
    let before = text.slice(0, best.index).trim();
    let after = text.slice(best.index + best[0].length).trim();
    before = before.replace(/^[\d\s.)(·-]+/, '').trim();
    after = after.replace(/^[\s.,)(·-]+/, '').replace(/[\s.,)(·-]+$/, '').trim();
    let name = '';
    const nm = before.match(/([가-힣]{2,6})\s*$/);
    if (nm) name = nm[1];
    return { ok: true, text, addr, name, note: after.slice(0, 30) };
  }

  function hasRegion(addr) {
    return new RegExp('^(?:' + PROVINCES + ')|(?:^|\\s)[가-힣]{1,6}(?:시|군)(?:\\s|$)').test(addr);
  }

  function withRegion(addr, region) {
    if (!region) return addr;
    if (hasRegion(addr)) return addr;
    return (region + ' ' + addr).replace(/\s+/g, ' ').trim();
  }

  // ---------- 지명 사전 보정 ----------
  function tokenSuffix(tok) {
    const m = tok.match(/(대로|로|길|읍|면|동|리)$/);
    return m ? m[1] : '';
  }

  // dict: Set<string>
  function correctWithDict(addr, dict, maxDist) {
    maxDist = maxDist || 2;
    if (!dict || !dict.size) return { addr, changed: [] };
    const toks = addr.split(' ');
    const changed = [];
    const out = toks.map((tok) => {
      const suf = tokenSuffix(tok);
      if (!suf || dict.has(tok) || /\d/.test(tok)) return tok;
      const tj = toJamo(tok);
      let best = null; let bestD = Infinity; let tie = false;
      for (const w of dict) {
        if (!w.endsWith(suf) || Math.abs(w.length - tok.length) > 1) continue;
        const d = levenshtein(tj, toJamo(w));
        if (d < bestD) { bestD = d; best = w; tie = false; } else if (d === bestD) { tie = true; }
      }
      if (best && bestD <= maxDist && !tie) { changed.push([tok, best]); return best; }
      return tok;
    });
    return { addr: out.join(' '), changed };
  }

  // 카카오가 돌려준 주소에서 사전에 넣을 토큰 뽑기
  function learnTokens(addressName) {
    const out = [];
    for (const t of (addressName || '').split(/\s+/)) {
      if (tokenSuffix(t) && /^[가-힣0-9]+$/.test(t) && !/^\d/.test(t) && t.length >= 2) out.push(t);
    }
    return out;
  }

  // ---------- 거리/순서 ----------
  function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // start: {lat,lng}, pts: [{lat,lng}] → 방문 순서(인덱스 배열). 출발점 고정, 끝은 자유.
  function orderNearest(start, pts) {
    const n = pts.length;
    if (n <= 1) return pts.map((_, i) => i);
    const all = [start].concat(pts);
    const D = [];
    for (let i = 0; i <= n; i++) {
      D.push(new Array(n + 1));
      for (let j = 0; j <= n; j++) D[i][j] = i === j ? 0 : haversine(all[i], all[j]);
    }
    // 최근접 이웃
    const used = new Array(n + 1).fill(false); used[0] = true;
    let route = [0]; let cur = 0;
    for (let k = 0; k < n; k++) {
      let bi = -1; let bd = Infinity;
      for (let j = 1; j <= n; j++) if (!used[j] && D[cur][j] < bd) { bd = D[cur][j]; bi = j; }
      used[bi] = true; route.push(bi); cur = bi;
    }
    // 2-opt (출발점 고정, 열린 경로)
    let improved = true; let guard = 0;
    while (improved && guard++ < 300) {
      improved = false;
      for (let i = 1; i < route.length - 1; i++) {
        for (let k = i + 1; k < route.length; k++) {
          const a = route[i - 1], b = route[i], c = route[k], d = route[k + 1];
          const before = D[a][b] + (d !== undefined ? D[c][d] : 0);
          const after = D[a][c] + (d !== undefined ? D[b][d] : 0);
          if (after + 1e-6 < before) {
            route = route.slice(0, i).concat(route.slice(i, k + 1).reverse(), route.slice(k + 1));
            improved = true;
          }
        }
      }
    }
    return route.slice(1).map((i) => i - 1);
  }

  function fmtDist(m) {
    if (m == null || isNaN(m)) return '';
    if (m < 950) return Math.round(m / 10) * 10 + 'm';
    return (m / 1000).toFixed(1) + 'km';
  }

  const Core = { toJamo, levenshtein, cleanLine, extractAddress, hasRegion, withRegion, correctWithDict, learnTokens, haversine, orderNearest, fmtDist, ADDR_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
