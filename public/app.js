/* Story-card app: loads CSV content, renders story + input cards,
   handles deck/feed navigation, progress, and form submissions.
   No dependencies. */

(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var MODE = CFG.MODE === 'feed' ? 'feed' : 'deck';

  var elCards = document.getElementById('cards');
  var elProgress = document.getElementById('progress');
  var elTitle = document.getElementById('bar-title');
  var elBack = document.getElementById('btn-back');
  var elClose = document.getElementById('btn-close');

  var cards = [];      // row objects from the CSV
  var cardEls = [];    // rendered .card elements
  var current = 0;

  var INPUT_TYPES = { input: 'text', email: 'email', longtext: 'textarea', choice: 'choice' };

  /* ---- CSV parsing (RFC 4180: quotes, "" escapes, embedded newlines) ---- */

  function parseCSV(text) {
    var rows = [], row = [], field = '', inQuotes = false, i = 0;
    text = text.replace(/^﻿/, '');
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (f) { return f.trim() !== ''; });
    });
  }

  function toObjects(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, idx) { o[h] = (r[idx] || '').trim(); });
      return o;
    });
  }

  /* ---- Rendering ---- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function iconBtn(cls, label, svgPath, filledPath) {
    var b = el('button', 'icon-btn ' + (cls || ''));
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' + (svgPath || filledPath) + '"/></svg>';
    return b;
  }

  var SHARE_PATH = 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M12 3v13 M7 8l5-5 5 5';
  var BOOKMARK_PATH = 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z';

  function cardFooter(row, index) {
    var foot = el('div', 'card-footer');

    var share = iconBtn('', 'Share', SHARE_PATH);
    share.addEventListener('click', function () {
      var payload = { title: row.title || CFG.APP_TITLE || document.title, text: row.text || '' };
      if (navigator.share) {
        navigator.share(payload).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(payload.title + '\n\n' + payload.text).catch(function () {});
      }
    });

    var bmKey = 'bookmark:' + index;
    var bm = iconBtn('', 'Bookmark', BOOKMARK_PATH);
    if (localStorage.getItem(bmKey)) bm.classList.add('saved');
    bm.addEventListener('click', function () {
      if (bm.classList.toggle('saved')) localStorage.setItem(bmKey, '1');
      else localStorage.removeItem(bmKey);
    });

    foot.appendChild(share);
    foot.appendChild(bm);
    return foot;
  }

  function storyCard(row, index) {
    var card = el('article', 'card');
    var body = el('div', 'card-text');
    (row.text || '').split(/\n\s*\n|\n/).forEach(function (para) {
      if (para.trim()) body.appendChild(el('p', null, para.trim()));
    });
    card.appendChild(body);
    if (row.image) {
      var img = document.createElement('img');
      img.className = 'card-img';
      img.src = row.image;
      img.alt = row.alt || '';
      img.loading = 'lazy';
      card.appendChild(img);
    }
    card.appendChild(cardFooter(row, index));
    return card;
  }

  function inputCard(row, index) {
    var kind = INPUT_TYPES[row.type];
    var card = el('article', 'card');
    card.appendChild(el('h2', 'prompt', row.text || ''));

    var getValue, field;

    if (kind === 'choice') {
      var pills = el('div', 'pills');
      (row.options || '').split('|').forEach(function (opt) {
        opt = opt.trim();
        if (!opt) return;
        var p = el('button', 'pill', opt);
        p.addEventListener('click', function () {
          pills.querySelectorAll('.pill').forEach(function (q) { q.classList.remove('selected'); });
          p.classList.add('selected');
          resetNote();
        });
        pills.appendChild(p);
      });
      card.appendChild(pills);
      getValue = function () {
        var sel = pills.querySelector('.pill.selected');
        return sel ? sel.textContent : '';
      };
    } else {
      field = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
      field.className = 'field';
      if (kind !== 'textarea') field.type = kind; // 'text' | 'email'
      field.placeholder = row.placeholder || (kind === 'email' ? 'you@example.com' : 'Type your answer…');
      if (kind === 'textarea') {
        field.addEventListener('input', function () {
          field.style.height = 'auto';
          field.style.height = field.scrollHeight + 'px';
        });
      }
      field.addEventListener('input', resetNote);
      card.appendChild(field);
      getValue = function () { return field.value.trim(); };
    }

    var rowEl = el('div', 'submit-row');
    var btn = el('button', 'btn-submit', 'Submit');
    var note = el('span', 'form-note', '');
    rowEl.appendChild(btn);
    rowEl.appendChild(note);
    card.appendChild(rowEl);

    function resetNote() {
      if (btn.textContent !== 'Submit') { btn.textContent = 'Submit'; btn.disabled = false; }
      note.textContent = '';
      note.className = 'form-note';
    }

    function fail(msg) {
      note.textContent = msg;
      note.className = 'form-note err';
    }

    btn.addEventListener('click', function () {
      var value = getValue();
      if (!value) return fail(kind === 'choice' ? 'Pick an option first.' : 'Please write an answer first.');
      if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return fail('That doesn’t look like an email address.');
      }
      btn.disabled = true;
      note.textContent = '';
      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_key: row.field_key || 'answer', value: value })
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        btn.textContent = 'Saved ✓';
        note.textContent = 'Thank you!';
        note.className = 'form-note ok';
      }).catch(function () {
        btn.disabled = false;
        fail('Could not save — please try again.');
      });
    });

    card.appendChild(cardFooter(row, index));
    return card;
  }

  /* ---- Progress + title ---- */

  function buildProgress() {
    elProgress.innerHTML = '';
    if (MODE === 'deck') {
      cards.forEach(function () { elProgress.appendChild(el('span', 'seg')); });
    } else {
      var bar = el('span', 'bar');
      bar.appendChild(el('span', 'fill'));
      elProgress.appendChild(bar);
    }
  }

  function setCurrent(idx) {
    current = idx;
    elTitle.textContent = cards[idx] && cards[idx].title ? cards[idx].title : (CFG.APP_TITLE || '');
    if (MODE === 'deck') {
      elProgress.querySelectorAll('.seg').forEach(function (seg, i) {
        seg.classList.toggle('active', i === idx);
        seg.classList.toggle('done', i < idx);
      });
    }
  }

  function goTo(idx) {
    if (idx < 0 || idx >= cardEls.length) return;
    cardEls[idx].scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: MODE === 'feed' ? 'start' : 'nearest'
    });
  }

  /* ---- Boot ---- */

  function render(rows) {
    cards = rows;
    elCards.innerHTML = '';
    elCards.classList.add(MODE);

    rows.forEach(function (row, i) {
      var card = INPUT_TYPES[row.type] ? inputCard(row, i) : storyCard(row, i);
      cardEls.push(card);
      elCards.appendChild(card);
    });

    buildProgress();
    setCurrent(0);

    // Keep progress + title in sync with whatever card is in view.
    // Track all visible cards and follow the topmost/leftmost one, so the
    // title is right even when two cards share the screen (feed mode).
    var visible = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var idx = cardEls.indexOf(entry.target);
        if (entry.isIntersecting) visible.add(idx);
        else visible.delete(idx);
      });
      if (visible.size) setCurrent(Math.min.apply(null, Array.from(visible)));
    }, { root: elCards, threshold: MODE === 'deck' ? 0.6 : 0.35 });
    cardEls.forEach(function (c) { io.observe(c); });

    if (MODE === 'deck') {
      // Tap the outer edges of a story area to flip cards (never steals
      // taps from buttons or fields).
      elCards.addEventListener('click', function (ev) {
        if (ev.target.closest('button, input, textarea, a, select')) return;
        var x = ev.clientX, w = window.innerWidth;
        if (x < w * 0.25) goTo(current - 1);
        else if (x > w * 0.75) goTo(current + 1);
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.target.closest && ev.target.closest('input, textarea')) return;
        if (ev.key === 'ArrowLeft') goTo(current - 1);
        if (ev.key === 'ArrowRight') goTo(current + 1);
      });
    } else {
      var fill = elProgress.querySelector('.fill');
      elCards.addEventListener('scroll', function () {
        var max = elCards.scrollHeight - elCards.clientHeight;
        fill.style.width = (max > 0 ? (elCards.scrollTop / max) * 100 : 100) + '%';
      }, { passive: true });
    }
  }

  elBack.addEventListener('click', function () {
    if (MODE === 'deck') goTo(current - 1);
    else elCards.scrollTo({ top: 0, behavior: 'smooth' });
  });

  if (CFG.CLOSE_URL) {
    elClose.hidden = false;
    elClose.addEventListener('click', function () { location.href = CFG.CLOSE_URL; });
  }

  elTitle.textContent = CFG.APP_TITLE || '';
  document.title = CFG.APP_TITLE || document.title;

  fetch('/api/content')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(function (text) {
      var rows = toObjects(parseCSV(text));
      if (!rows.length) throw new Error('empty');
      render(rows);
    })
    .catch(function () {
      document.getElementById('state-msg').textContent =
        'Couldn’t load content. Check that data/content.csv exists on the server.';
    });
})();
