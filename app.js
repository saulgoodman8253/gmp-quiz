/* GMP 복습 문제집 — 빌드 도구 없이 동작하는 정적 웹 앱 */
(() => {
  'use strict';

  const MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const COUNT_OPTIONS = [5, 10, 20, 30, 0]; // 0 = 전체
  const KEYS = {
    wrong: 'gmpq.wrong',
    seen: 'gmpq.seen',
    history: 'gmpq.history',
    weekStats: 'gmpq.weekStats',
    prefs: 'gmpq.prefs',
    theme: 'gmpq.theme',
  };

  const app = document.getElementById('app');

  /* ---------- 저장소 (localStorage, 실패해도 앱은 동작) ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
    },
  };

  /* ---------- 상태 ---------- */
  let bank = [];      // 전체 문항 (week, weekTitle 포함)
  let weeks = [];     // [{ week, title, count }]
  let session = null; // 현재 풀고 있는 회차

  /* ---------- 유틸 ---------- */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pct(c, t) { return t ? Math.round((c / t) * 100) : 0; }

  function render(...nodes) {
    app.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  function weekTitle(week) {
    const w = weeks.find((x) => x.week === week);
    return w ? `${w.week} ${w.title}` : week;
  }

  /* ---------- 테마 ---------- */
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  document.getElementById('themeBtn').addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const cur = store.get(KEYS.theme, 'auto');
    const next = order[(order.indexOf(cur) + 1) % order.length];
    store.set(KEYS.theme, next);
    applyTheme(next);
    toast(next === 'auto' ? '테마: 시스템 설정 따름' : next === 'dark' ? '테마: 다크' : '테마: 라이트');
  });
  applyTheme(store.get(KEYS.theme, 'auto'));

  document.getElementById('homeBtn').addEventListener('click', () => {
    if (session && !session.finished && session.answers.some((a) => a != null)) {
      if (!confirm('풀던 문제를 그만두고 처음으로 갈까요?')) return;
    }
    showHome();
  });

  function toast(msg) {
    const t = el('div', { class: 'card', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:50;padding:10px 16px;' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 1600);
  }

  /* ---------- 문제 불러오기 ---------- */
  async function fetchJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path} 를 불러오지 못했습니다 (HTTP ${res.status})`);
    return res.json();
  }

  function validateQuestion(q, file) {
    const where = `${file} / ${q && q.id ? q.id : '(id 없음)'}`;
    if (!q || typeof q !== 'object') return `${where}: 문항 형식 오류`;
    if (!q.id) return `${where}: id 가 없습니다`;
    if (!q.question) return `${where}: question 이 없습니다`;
    if (!Array.isArray(q.choices) || q.choices.length < 2) return `${where}: choices 가 2개 이상이어야 합니다`;
    if (!Number.isInteger(q.answer) || q.answer < 1 || q.answer > q.choices.length) {
      return `${where}: answer 는 1~${q.choices.length} 사이 정수여야 합니다`;
    }
    return null;
  }

  async function loadBank() {
    const index = await fetchJSON('questions/index.json');
    const files = Array.isArray(index) ? index : index.files;
    if (!Array.isArray(files)) throw new Error('questions/index.json 에 "files" 배열이 필요합니다');

    const results = await Promise.allSettled(files.map((f) => fetchJSON(`questions/${f}`)));
    const problems = [];
    const ids = new Set();
    bank = [];
    weeks = [];

    results.forEach((r, i) => {
      const file = files[i];
      if (r.status === 'rejected') { problems.push(`${file}: ${r.reason.message}`); return; }
      const data = r.value;
      const week = data.week || file.replace(/\.json$/i, '').toUpperCase();
      const list = Array.isArray(data.questions) ? data.questions : [];
      let count = 0;
      for (const q of list) {
        const err = validateQuestion(q, file);
        if (err) { problems.push(err); continue; }
        if (ids.has(q.id)) { problems.push(`${file}: 중복 id ${q.id} (건너뜀)`); continue; }
        ids.add(q.id);
        bank.push({ ...q, week, weekTitle: data.title || '' });
        count++;
      }
      const existing = weeks.find((w) => w.week === week);
      if (existing) existing.count += count;
      else weeks.push({ week, title: data.title || '', count });
    });

    weeks.sort((a, b) => a.week.localeCompare(b.week, 'ko', { numeric: true }));
    if (problems.length) console.warn('[문제 파일 경고]\n' + problems.join('\n'));
    return problems;
  }

  /* ---------- 오답 노트 / 기록 ---------- */
  const wrongNote = {
    all() { return new Set(store.get(KEYS.wrong, [])); },
    add(id) { const s = this.all(); s.add(id); store.set(KEYS.wrong, [...s]); },
    remove(id) { const s = this.all(); s.delete(id); store.set(KEYS.wrong, [...s]); },
  };

  function markSeen(ids) {
    const seen = new Set(store.get(KEYS.seen, []));
    ids.forEach((id) => seen.add(id));
    store.set(KEYS.seen, [...seen]);
  }

  function recordAnswer(q, correct) {
    if (correct) wrongNote.remove(q.id);
    else wrongNote.add(q.id);
    const stats = store.get(KEYS.weekStats, {});
    const s = stats[q.week] || { correct: 0, total: 0 };
    s.total += 1;
    if (correct) s.correct += 1;
    stats[q.week] = s;
    store.set(KEYS.weekStats, stats);
  }

  /* ---------- 문항 뽑기 ---------- */
  // 미출제(한 번도 안 나온) 문항을 우선 뽑아 매 회차마다 새 문항이 섞이도록 한다.
  function pickQuestions(pool, n) {
    const seen = new Set(store.get(KEYS.seen, []));
    const unseen = shuffle(pool.filter((q) => !seen.has(q.id)));
    const old = shuffle(pool.filter((q) => seen.has(q.id)));
    const total = n > 0 ? Math.min(n, pool.length) : pool.length;
    // 미출제 문항이 있으면 최소 1개, 최대 절반 이상을 미출제 문항으로 채움
    const wantNew = Math.min(unseen.length, Math.max(1, Math.ceil(total / 2)), total);
    let picked = unseen.slice(0, wantNew);
    picked = picked.concat(old.slice(0, total - picked.length));
    if (picked.length < total) picked = picked.concat(unseen.slice(wantNew, wantNew + total - picked.length));
    const newIds = new Set(unseen.map((q) => q.id));
    return shuffle(picked).map((q) => prepareQuestion(q, newIds.has(q.id)));
  }

  // 보기 순서를 섞고, 섞인 위치 기준으로 정답 인덱스를 다시 계산한다.
  function prepareQuestion(q, isNew) {
    const order = shuffle(q.choices.map((_, i) => i));
    return {
      q,
      isNew,
      choices: order.map((i) => q.choices[i]),
      correctIndex: order.indexOf(q.answer - 1),
    };
  }

  /* ---------- 시작 화면 ---------- */
  function showHome() {
    session = null;
    const prefs = store.get(KEYS.prefs, { weeks: [], count: 10, mode: 'study' });
    const wrongSet = wrongNote.all();
    const wrongCount = bank.filter((q) => wrongSet.has(q.id)).length;
    const weekStats = store.get(KEYS.weekStats, {});
    const seen = new Set(store.get(KEYS.seen, []));

    const weekInputs = [];
    const weekChips = weeks.map((w) => {
      const input = el('input', { type: 'checkbox', value: w.week });
      input.checked = prefs.weeks.length ? prefs.weeks.includes(w.week) : true;
      weekInputs.push(input);
      const st = weekStats[w.week];
      const unseenN = bank.filter((q) => q.week === w.week && !seen.has(q.id)).length;
      const meta = [`${w.count}문항`];
      if (unseenN) meta.push(`미출제 ${unseenN}`);
      if (st && st.total) meta.push(`정답률 ${pct(st.correct, st.total)}%`);
      return el('label', { class: 'chip week-chip' }, input,
        el('strong', null, w.week), el('small', null, w.title), el('small', null, meta.join(' · ')));
    });

    const allToggle = el('button', {
      class: 'btn secondary small', type: 'button',
      onclick: () => {
        const allOn = weekInputs.every((i) => i.checked);
        weekInputs.forEach((i) => { i.checked = !allOn; });
        update();
      },
    }, '전체 선택/해제');

    const countInputs = COUNT_OPTIONS.map((n) => {
      const input = el('input', { type: 'radio', name: 'count', value: String(n) });
      input.checked = prefs.count === n;
      return input;
    });
    if (!countInputs.some((i) => i.checked)) countInputs[1].checked = true;

    const modeDefs = [
      { v: 'study', t: '📖 단원별 학습', d: '한 문제씩 풀고 바로 정답·해설 확인' },
      { v: 'exam', t: '📝 단원 시험', d: '시험지 형식으로 끝까지 푼 뒤 한꺼번에 채점' },
    ];
    const modeInputs = modeDefs.map((m) => {
      const input = el('input', { type: 'radio', name: 'mode', value: m.v });
      input.checked = prefs.mode === m.v;
      return input;
    });
    if (!modeInputs.some((i) => i.checked)) modeInputs[0].checked = true;

    const info = el('p', { class: 'muted', style: 'margin:10px 0 0' });
    const startBtn = el('button', { class: 'btn block', type: 'button', onclick: start }, '시작하기');

    function selectedWeeks() { return weekInputs.filter((i) => i.checked).map((i) => i.value); }
    function selectedCount() { return Number(countInputs.find((i) => i.checked).value); }
    function selectedMode() { return modeInputs.find((i) => i.checked).value; }

    function update() {
      const ws = selectedWeeks();
      const pool = bank.filter((q) => ws.includes(q.week));
      const n = selectedCount();
      const actual = n > 0 ? Math.min(n, pool.length) : pool.length;
      info.textContent = ws.length ? `선택 범위 ${pool.length}문항 중 ${actual}문항 출제` : '주차를 하나 이상 선택하세요.';
      startBtn.disabled = actual === 0;
    }

    function savePrefs() {
      store.set(KEYS.prefs, { weeks: selectedWeeks(), count: selectedCount(), mode: selectedMode() });
    }

    function start() {
      savePrefs();
      const ws = selectedWeeks();
      const pool = bank.filter((q) => ws.includes(q.week));
      const label = ws.length === weeks.length ? '전체 주차' : ws.join(', ');
      startSession(selectedMode(), pickQuestions(pool, selectedCount()), selectedMode() === 'exam' ? `단원 시험 (${label})` : `단원별 학습 (${label})`);
    }

    function startMock() {
      savePrefs();
      startSession('exam', pickQuestions(bank, selectedCount()), '전범위 모의고사');
    }

    function startWrong() {
      savePrefs();
      const ws = wrongNote.all();
      startSession(selectedMode(), pickQuestions(bank.filter((q) => ws.has(q.id)), 0), '오답 다시 풀기');
    }

    [...weekInputs, ...countInputs, ...modeInputs].forEach((i) => i.addEventListener('change', update));

    render(
      el('section', { class: 'card' },
        el('div', { class: 'row between', style: 'margin-bottom:10px' }, el('h2', { style: 'margin:0' }, '① 주차 범위'), allToggle),
        weeks.length ? el('div', { class: 'chips' }, weekChips) : el('p', { class: 'muted' }, '등록된 문제 파일이 없습니다. questions/index.json 을 확인하세요.')),
      el('section', { class: 'card' },
        el('h2', null, '② 문제 수'),
        el('div', { class: 'chips' }, countInputs.map((input, i) =>
          el('label', { class: 'chip' }, input, el('strong', null, COUNT_OPTIONS[i] ? `${COUNT_OPTIONS[i]}문항` : '전체'))))),
      el('section', { class: 'card' },
        el('h2', null, '③ 모드'),
        el('div', { class: 'chips' }, modeInputs.map((input, i) =>
          el('label', { class: 'chip wide-chip' }, input, el('strong', null, modeDefs[i].t), el('small', null, modeDefs[i].d)))),
        info,
        el('div', { style: 'margin-top:12px' }, startBtn)),
      el('section', { class: 'card stack' },
        el('h2', { style: 'margin:0' }, '바로 가기'),
        el('button', { class: 'btn block', type: 'button', onclick: startMock, disabled: bank.length === 0 },
          `🎯 전범위 모의고사 (${bank.length}문항 중 선택한 문제 수만큼)`),
        el('button', { class: 'btn secondary block', type: 'button', onclick: startWrong, disabled: wrongCount === 0 },
          `❗ 오답만 다시 풀기 (${wrongCount}문항)`),
        el('button', { class: 'btn secondary block', type: 'button', onclick: () => showRecords() }, '📊 학습 기록 보기'),
        el('button', { class: 'btn secondary block', type: 'button', onclick: () => {
          savePrefs();
          showPrintSetup(selectedWeeks(), selectedCount());
        } }, '🖨️ 문제지 PDF로 저장·공유 (선택한 주차 범위)')),
    );
    update();
  }

  /* ---------- PDF 저장·공유 (브라우저 인쇄 → PDF로 저장) ---------- */
  function showPrintSetup(ws, count) {
    const pool = bank.filter((q) => ws.includes(q.week));
    if (!pool.length) { toast('주차를 하나 이상 선택하세요'); return; }

    const kinds = [
      { v: 'paper', t: '📝 문제지만', d: '정답 없이 문제만' },
      { v: 'key', t: '📝 문제지 + 정답표', d: '마지막 쪽에 정답표' },
      { v: 'study', t: '📖 정답·해설 포함', d: '문항마다 정답·해설·출처 (요약 노트용)' },
    ];
    const orders = [
      { v: 'shuffle', t: '🔀 섞기', d: '문항·보기 순서 무작위' },
      { v: 'seq', t: '🔢 순서대로', d: '주차·번호 순서 그대로' },
    ];
    const kindInputs = kinds.map((k, i) => {
      const input = el('input', { type: 'radio', name: 'pkind', value: k.v });
      input.checked = i === 1;
      return input;
    });
    const orderInputs = orders.map((o, i) => {
      const input = el('input', { type: 'radio', name: 'porder', value: o.v });
      input.checked = i === 0;
      return input;
    });
    const total = count > 0 ? Math.min(count, pool.length) : pool.length;
    const label = ws.length === weeks.length ? '전체 주차' : ws.join(', ');

    function make() {
      const kind = kindInputs.find((i) => i.checked).value;
      const order = orderInputs.find((i) => i.checked).value;
      let qs;
      if (order === 'seq') {
        const chosen = new Set(shuffle(pool).slice(0, total).map((q) => q.id));
        qs = pool.filter((q) => chosen.has(q.id)).map((q) => ({
          q, choices: q.choices.slice(), correctIndex: q.answer - 1,
        }));
      } else {
        qs = shuffle(pool).slice(0, total).map((q) => prepareQuestion(q, false));
      }
      showPrintDoc(qs, kind, label, () => showPrintSetup(ws, count));
    }

    render(
      el('section', { class: 'card' },
        el('h2', null, '🖨️ 문제지 PDF로 저장·공유'),
        el('p', { class: 'muted', style: 'margin:0' }, `범위: ${label} · ${pool.length}문항 중 ${total}문항 (처음 화면에서 고른 주차·문제 수)`)),
      el('section', { class: 'card' },
        el('h2', null, '형식'),
        el('div', { class: 'chips' }, kindInputs.map((input, i) =>
          el('label', { class: 'chip wide-chip' }, input, el('strong', null, kinds[i].t), el('small', null, kinds[i].d))))),
      el('section', { class: 'card' },
        el('h2', null, '순서'),
        el('div', { class: 'chips' }, orderInputs.map((input, i) =>
          el('label', { class: 'chip wide-chip' }, input, el('strong', null, orders[i].t), el('small', null, orders[i].d))))),
      el('section', { class: 'card stack' },
        el('button', { class: 'btn block', type: 'button', onclick: make }, '미리보기 만들기'),
        el('button', { class: 'btn secondary block', type: 'button', onclick: showHome }, '처음으로')),
    );
  }

  function showPrintDoc(items, kind, label, back) {
    const now = new Date();
    const date = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}.`;
    const kindName = { paper: '문제지', key: '문제지 + 정답표', study: '정답·해설 포함' }[kind];

    const toolbar = el('section', { class: 'card stack no-print' },
      el('button', { class: 'btn block', type: 'button', onclick: () => window.print() }, '🖨️ PDF로 저장 / 인쇄'),
      el('p', { class: 'muted', style: 'margin:0;font-size:14px' },
        '인쇄 창에서 대상(프린터)을 「PDF로 저장」으로 고르면 PDF 파일이 됩니다. ',
        '휴대폰: 아이폰은 인쇄 미리보기에서 공유 버튼 → 파일에 저장/카카오톡 등으로 보내기, ',
        '안드로이드는 프린터 선택에서 「PDF로 저장」 후 파일을 공유하세요.'),
      el('div', { class: 'row', style: 'gap:10px' },
        el('button', { class: 'btn secondary', type: 'button', style: 'flex:1', onclick: back }, '← 설정 바꾸기'),
        el('button', { class: 'btn secondary', type: 'button', style: 'flex:1', onclick: showHome }, '처음으로')));

    const head = el('header', { class: 'paper-head print-head' },
      el('h2', null, 'GMP 복습 문제지'),
      el('div', { class: 'sub' }, kindName),
      el('div', { class: 'paper-grid' },
        el('div', null, el('b', null, '범위'), label),
        el('div', null, el('b', null, '문항 수'), `${items.length}문항`),
        el('div', null, el('b', null, '일자'), date),
        el('div', null, el('b', null, '이름'), '')));

    const body = items.map((it, i) => el('article', { class: 'print-q' },
      el('p', { class: 'q-text' }, el('span', { class: 'q-num' }, `${i + 1}.`), it.q.question,
        el('span', { class: 'print-tag' }, ` [${it.q.week}${it.q.type ? ' · ' + it.q.type : ''}]`)),
      el('ol', { class: 'print-choices' }, it.choices.map((c, ci) =>
        el('li', { class: kind === 'study' && ci === it.correctIndex ? 'ans' : null },
          el('span', { class: 'mark' }, MARKS[ci]), ' ', c))),
      kind === 'study' ? el('div', { class: 'print-explain' },
        el('div', null, el('b', null, `정답 ${MARKS[it.correctIndex]}`)),
        it.q.explanation ? el('div', null, it.q.explanation) : null,
        it.q.source ? el('div', { class: 'print-src' }, `출처: ${it.q.source}`) : null) : null));

    const key = kind === 'key' ? el('section', { class: 'print-key' },
      el('h3', null, '정답표'),
      el('div', { class: 'key-grid' }, items.map((it, i) =>
        el('div', null, el('b', null, `${i + 1}`), ` ${MARKS[it.correctIndex]}`)))) : null;

    render(toolbar, el('section', { class: 'card print-doc' }, head, body, key));
    window.scrollTo(0, 0);
  }

  /* ---------- 회차 시작 ---------- */
  function startSession(mode, items, label) {
    if (!items.length) { toast('출제할 문항이 없습니다'); return; }
    markSeen(items.map((it) => it.q.id));
    session = {
      mode,
      label,
      items,
      answers: new Array(items.length).fill(null),
      index: 0,
      finished: false,
      startedAt: Date.now(),
    };
    if (mode === 'study') showStudyQuestion();
    else showPaper();
  }

  function progressBar(current, total, labelLeft) {
    return el('div', { class: 'progress-wrap' },
      el('div', { class: 'progress-label' },
        el('span', null, labelLeft),
        el('span', null, el('strong', null, String(current)), ` / ${total}`)),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(current) },
        el('div', { style: `width:${pct(current, total)}%` })));
  }

  function metaTags(it) {
    return el('div', { class: 'q-meta' },
      el('span', { class: 'tag' }, weekTitle(it.q.week)),
      it.q.type ? el('span', { class: 'tag' }, it.q.type) : null,
      it.isNew ? el('span', { class: 'tag new' }, '미출제') : null);
  }

  function feedbackBox(it, chosen) {
    const ok = chosen === it.correctIndex;
    return el('div', { class: 'feedback' },
      el('div', { class: `verdict ${ok ? 'ok' : 'bad'}` }, ok ? '⭕ 정답입니다' : `❌ 오답입니다 — 정답 ${MARKS[it.correctIndex]}`),
      it.q.explanation ? el('div', { class: 'explain' }, it.q.explanation) : null,
      it.q.source ? el('div', { class: 'source' }, it.q.source) : null);
  }

  /* ---------- 학습 모드 (한 문제씩) ---------- */
  function showStudyQuestion() {
    const s = session;
    const it = s.items[s.index];
    const answered = s.answers[s.index] != null;
    const total = s.items.length;

    const buttons = it.choices.map((c, i) => el('button', {
      class: 'choice', type: 'button',
      onclick: () => choose(i),
    }, el('span', { class: 'mark' }, MARKS[i]), el('span', { class: 'ctext' }, c)));

    const fbSlot = el('div');
    const nextBtn = el('button', { class: 'btn', type: 'button', disabled: !answered, onclick: next },
      s.index === total - 1 ? '결과 보기' : '다음 문제 →');

    function paint() {
      const chosen = s.answers[s.index];
      buttons.forEach((b, i) => {
        b.disabled = chosen != null;
        b.classList.toggle('correct', chosen != null && i === it.correctIndex);
        b.classList.toggle('wrong', chosen != null && i === chosen && chosen !== it.correctIndex);
      });
      if (chosen != null) {
        fbSlot.replaceChildren(feedbackBox(it, chosen));
        nextBtn.disabled = false;
      }
    }

    function choose(i) {
      if (s.answers[s.index] != null) return;
      s.answers[s.index] = i;
      recordAnswer(it.q, i === it.correctIndex);
      paint();
      fbSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function next() {
      if (s.index < total - 1) { s.index++; showStudyQuestion(); } else finish();
    }

    render(
      progressBar(s.index + 1, total, s.label),
      el('article', { class: 'card' },
        metaTags(it),
        el('p', { class: 'q-text' }, el('span', { class: 'q-num' }, `${s.index + 1}.`), it.q.question),
        el('div', { class: 'choices' }, buttons),
        fbSlot),
      el('div', { class: 'bottom-bar' }, el('div', { class: 'inner' },
        el('button', { class: 'btn secondary', type: 'button', disabled: s.index === 0, onclick: () => { s.index--; showStudyQuestion(); } }, '← 이전'),
        nextBtn)),
    );
    paint();
  }

  /* ---------- 시험 모드 (시험지 형식) ---------- */
  function showPaper() {
    const s = session;
    const total = s.items.length;
    const newCount = s.items.filter((it) => it.isNew).length;
    const weekSet = [...new Set(s.items.map((it) => it.q.week))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    const now = new Date();

    const progressHost = el('div');
    const omrLinks = [];

    function paintProgress() {
      const done = s.answers.filter((a) => a != null).length;
      progressHost.replaceChildren(progressBar(done, total, '답안 작성'));
      omrLinks.forEach((a, i) => a.classList.toggle('done', s.answers[i] != null));
    }

    const questionsEls = s.items.map((it, qi) => {
      const buttons = it.choices.map((c, ci) => el('button', {
        class: 'choice', type: 'button', 'aria-pressed': 'false',
        onclick: () => {
          s.answers[qi] = ci;
          buttons.forEach((b, k) => {
            b.classList.toggle('selected', k === ci);
            b.setAttribute('aria-pressed', String(k === ci));
          });
          paintProgress();
        },
      }, el('span', { class: 'mark' }, MARKS[ci]), el('span', { class: 'ctext' }, c)));
      return el('section', { class: 'paper-q', id: `pq-${qi + 1}` },
        metaTags(it),
        el('p', { class: 'q-text' }, el('span', { class: 'q-num' }, `${qi + 1}.`), it.q.question),
        el('div', { class: 'choices' }, buttons));
    });

    s.items.forEach((_, i) => {
      omrLinks.push(el('a', { href: `#pq-${i + 1}`, onclick: (e) => {
        e.preventDefault();
        document.getElementById(`pq-${i + 1}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }, String(i + 1)));
    });

    function submit() {
      const left = s.answers.filter((a) => a == null).length;
      if (left && !confirm(`아직 ${left}문항을 풀지 않았습니다. 그래도 제출할까요?\n(안 푼 문항은 오답 처리됩니다)`)) return;
      s.items.forEach((it, i) => recordAnswer(it.q, s.answers[i] === it.correctIndex));
      finish();
    }

    render(
      el('div', { class: 'paper-head' },
        el('h2', null, '바이오플랜트 GMP 운영'),
        el('div', { class: 'sub' }, s.label),
        el('div', { class: 'paper-grid' },
          el('div', null, el('b', null, '범위'), weekSet.join(', ')),
          el('div', null, el('b', null, '문항 수'), `${total}문항 · 객관식`),
          el('div', null, el('b', null, '일자'), now.toLocaleDateString('ko-KR')),
          el('div', null, el('b', null, '미출제'), `${newCount}문항 포함`)),
        el('div', { class: 'paper-note' }, '※ 각 문항에서 가장 적절한 답 하나를 고르시오. 모든 문항을 푼 뒤 아래 [답안 제출]을 누르면 한꺼번에 채점됩니다.')),
      progressHost,
      el('article', { class: 'card' }, questionsEls),
      el('section', { class: 'card' }, el('h3', null, '답안지 (번호를 누르면 이동)'), el('div', { class: 'omr' }, omrLinks)),
      el('div', { class: 'bottom-bar' }, el('div', { class: 'inner' },
        el('button', { class: 'btn', type: 'button', onclick: submit }, '답안 제출'))),
    );
    paintProgress();
  }

  /* ---------- 결과 ---------- */
  function finish() {
    const s = session;
    s.finished = true;
    const correct = s.items.filter((it, i) => s.answers[i] === it.correctIndex).length;
    const total = s.items.length;

    const history = store.get(KEYS.history, []);
    history.push({ at: Date.now(), label: s.label, mode: s.mode, correct, total });
    store.set(KEYS.history, history.slice(-100));

    // 이번 회차 주차별 성적
    const per = {};
    s.items.forEach((it, i) => {
      const p = per[it.q.week] || (per[it.q.week] = { correct: 0, total: 0 });
      p.total++;
      if (s.answers[i] === it.correctIndex) p.correct++;
    });

    const wrongNow = s.items.filter((it, i) => s.answers[i] !== it.correctIndex).length;

    const resultCard = el('section', { class: 'card' },
      el('div', { class: 'score-sub' }, s.label),
      el('div', { class: 'score-big' }, `${pct(correct, total)}점`),
      el('div', { class: 'score-sub' }, `${total}문항 중 ${correct}문항 정답 · 오답 ${wrongNow}문항은 오답 노트에 저장됨`),
      el('table', { class: 'stats', style: 'margin-top:12px' },
        el('thead', null, el('tr', null, el('th', null, '이번 회차 주차별'), el('th', { class: 'num' }, '정답'), el('th', { class: 'num' }, '정답률'))),
        el('tbody', null, Object.keys(per).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).map((w) =>
          el('tr', null, el('td', null, weekTitle(w)), el('td', { class: 'num' }, `${per[w].correct}/${per[w].total}`), el('td', { class: 'num' }, `${pct(per[w].correct, per[w].total)}%`))))));

    const actions = el('section', { class: 'card stack' },
      wrongNote.all().size
        ? el('button', { class: 'btn block', type: 'button', onclick: () => {
          const ws = wrongNote.all();
          startSession(s.mode, pickQuestions(bank.filter((q) => ws.has(q.id)), 0), '오답 다시 풀기');
        } }, `❗ 오답만 다시 풀기 (${bank.filter((q) => wrongNote.all().has(q.id)).length}문항)`)
        : null,
      el('button', { class: 'btn secondary block', type: 'button', onclick: () => window.print() }, '🖨️ 결과·해설 PDF로 저장 / 인쇄'),
      el('button', { class: 'btn secondary block', type: 'button', onclick: showHome }, '처음으로'));
    actions.classList.add('no-print');

    const review = el('section', null,
      el('h2', { style: 'margin:18px 0 10px' }, '문항별 정답과 해설'),
      s.items.map((it, i) => {
        const a = s.answers[i];
        const ok = a === it.correctIndex;
        return el('article', { class: `card review-item ${ok ? 'ok' : 'bad'}` },
          metaTags(it),
          el('p', { class: 'q-text' }, el('span', { class: 'q-num' }, `${i + 1}.`), it.q.question),
          el('div', { class: 'choices' }, it.choices.map((c, ci) => el('div', {
            class: `choice${ci === it.correctIndex ? ' correct' : ''}${ci === a && !ok ? ' wrong' : ''}`,
          }, el('span', { class: 'mark' }, MARKS[ci]), el('span', { class: 'ctext' }, c)))),
          el('div', { class: 'review-ans' },
            '내 답: ', el('span', { class: ok ? 'ok' : 'bad' }, a == null ? '미응답' : MARKS[a]),
            '  ·  정답: ', el('span', { class: 'ok' }, MARKS[it.correctIndex])),
          el('div', { class: 'feedback' },
            it.q.explanation ? el('div', { class: 'explain' }, it.q.explanation) : null,
            it.q.source ? el('div', { class: 'source' }, it.q.source) : null));
      }));

    render(resultCard, actions, recordsSection(), review);
  }

  /* ---------- 기록 ---------- */
  function recordsSection() {
    const stats = store.get(KEYS.weekStats, {});
    const history = store.get(KEYS.history, []).slice(-10).reverse();
    const weekRows = weeks.filter((w) => stats[w.week] && stats[w.week].total);

    return el('section', { class: 'card' },
      el('h2', null, '누적 주차별 정답률'),
      weekRows.length
        ? el('table', { class: 'stats' }, el('tbody', null, weekRows.map((w) => {
          const st = stats[w.week];
          const p = pct(st.correct, st.total);
          return el('tr', null,
            el('td', null, `${w.week} ${w.title}`, el('div', { class: 'bar' }, el('div', { style: `width:${p}%` }))),
            el('td', { class: 'num' }, `${st.correct}/${st.total}`),
            el('td', { class: 'num' }, `${p}%`));
        })))
        : el('p', { class: 'muted' }, '아직 기록이 없습니다.'),
      el('h2', { style: 'margin-top:18px' }, '최근 회차 점수'),
      history.length
        ? el('table', { class: 'stats' },
          el('thead', null, el('tr', null, el('th', null, '일시 · 회차'), el('th', { class: 'num' }, '점수'))),
          el('tbody', null, history.map((h) => el('tr', null,
            el('td', null, el('div', null, h.label), el('small', { class: 'muted' }, new Date(h.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }))),
            el('td', { class: 'num' }, `${pct(h.correct, h.total)}점`, el('br'), el('small', { class: 'muted' }, `${h.correct}/${h.total}`))))))
        : el('p', { class: 'muted' }, '아직 기록이 없습니다.'));
  }

  function showRecords() {
    session = null;
    const wrongSet = wrongNote.all();
    render(
      recordsSection(),
      el('section', { class: 'card stack' },
        el('p', { class: 'muted', style: 'margin:0' }, `오답 노트 ${bank.filter((q) => wrongSet.has(q.id)).length}문항 · 출제 이력 ${store.get(KEYS.seen, []).length}문항`),
        el('button', { class: 'btn secondary block', type: 'button', onclick: showHome }, '처음으로'),
        el('button', { class: 'btn danger block', type: 'button', onclick: () => {
          if (!confirm('점수 기록, 주차별 정답률, 오답 노트, 출제 이력을 모두 지울까요?')) return;
          [KEYS.wrong, KEYS.seen, KEYS.history, KEYS.weekStats].forEach((k) => {
            try { localStorage.removeItem(k); } catch (e) { /* 무시 */ }
          });
          toast('기록을 초기화했습니다');
          showRecords();
        } }, '기록 모두 초기화')),
    );
  }

  /* ---------- 시작 ---------- */
  loadBank()
    .then((problems) => {
      showHome();
      if (problems.length) {
        app.prepend(el('div', { class: 'card error', style: 'padding:12px;text-align:left' },
          '일부 문항을 불러오지 못했습니다:\n' + problems.join('\n')));
      }
    })
    .catch((err) => {
      const local = location.protocol === 'file:';
      render(el('div', { class: 'error' },
        `문제를 불러오지 못했습니다.\n${err.message}`,
        local ? '\n\n파일을 직접 열면(file://) 브라우저가 JSON을 막습니다.\nREADME의 "내 컴퓨터에서 미리 보기"를 참고하세요.' : ''));
    });
})();
