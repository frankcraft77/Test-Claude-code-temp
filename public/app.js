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

  // Deck-mode gesture engine state (unused in feed mode).
  var transitioning = false; // a commit/cancel/bounce animation is in flight
  var drag = null;           // the in-progress pointer gesture, or null
  var wasDrag = false;       // suppresses the synthetic click after a real drag
  var LOCK_PX = 8;           // px of movement before an axis is chosen
  var COMMIT_RATIO = 0.3;    // fraction of stage size that counts as a commit
  var COMMIT_VELOCITY = 0.5; // px/ms flick speed that also counts as a commit
  var SETTLE_MS = 420;       // fallback cleanup if transitionend never fires

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
      fetch(CFG.SUBMIT_URL || '/api/submit', {
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

  // goTo is only ever called from deck-mode entry points (edge taps,
  // arrow keys, the Back button) — feed mode scrolls directly instead.
  function goTo(idx) {
    settle(idx, 'x', false);
  }

  /* ---- Deck-mode gesture engine ----
     A single-card "stage": .cards.deck is position:relative;overflow:hidden
     and every .card is position:absolute, laid out edge-to-edge. Only the
     current card (plus, transiently, whichever neighbor a gesture reveals)
     carries .is-active. Cards are always exactly one stage-width/height
     apart, so the "current slides out / neighbor slides in" carousel math
     never needs them to overlap — no z-index layering required, just
     pointer-events gating via .is-current so a peeking neighbor can't be
     tapped before it's actually current. */

  function stageSize(axis) {
    return axis === 'y' ? elCards.clientHeight : elCards.clientWidth;
  }

  function setTransform(elx, axis, px) {
    elx.style.transform = axis === 'y' ? 'translateY(' + px + 'px)' : 'translateX(' + px + 'px)';
  }

  function clearCard(elx) {
    elx.classList.remove('is-active', 'is-current', 'settling');
    elx.style.transform = '';
  }

  // Animate the current card (and, if present, the peeking neighbor from a
  // cancelled drag) back to rest, then reset the neighbor to hidden.
  function springBack(cardEl, axis, neighbor, neighborDir) {
    var size = stageSize(axis);
    cardEl.classList.add('settling');
    if (neighbor) neighbor.classList.add('settling');
    requestAnimationFrame(function () {
      setTransform(cardEl, axis, 0);
      if (neighbor) setTransform(neighbor, axis, neighborDir === 'next' ? size : -size);
    });
    var timer;
    var done = function () {
      cardEl.removeEventListener('transitionend', done);
      clearTimeout(timer);
      cardEl.classList.remove('settling');
      cardEl.style.transform = '';
      if (neighbor) clearCard(neighbor);
    };
    cardEl.addEventListener('transitionend', done);
    timer = setTimeout(done, SETTLE_MS);
  }

  // Nudge the current card toward an out-of-bounds neighbor and back —
  // visible feedback that this is the first/last card.
  function bounce(axis, sign) {
    if (transitioning) return;
    var cardEl = cardEls[current];
    cardEl.classList.add('settling');
    setTransform(cardEl, axis, sign * 16);
    void cardEl.offsetWidth; // commit the nudge before animating back
    requestAnimationFrame(function () { setTransform(cardEl, axis, 0); });
    var timer;
    var done = function () {
      cardEl.removeEventListener('transitionend', done);
      clearTimeout(timer);
      cardEl.classList.remove('settling');
      cardEl.style.transform = '';
    };
    cardEl.addEventListener('transitionend', done);
    timer = setTimeout(done, SETTLE_MS);
  }

  // Commit the transition from `current` to `targetIdx`. When `viaDrag` is
  // true the neighbor is already positioned/transformed by a live gesture
  // (the animation just continues from wherever the finger left it); when
  // false (tap/keyboard/Back button) the neighbor is placed off-stage first
  // so the browser has a "from" state to transition away from.
  function settle(targetIdx, axis, viaDrag) {
    if (transitioning) return;
    if (targetIdx === current) return;
    if (targetIdx < 0 || targetIdx >= cardEls.length) {
      bounce(axis, targetIdx < 0 ? 1 : -1);
      return;
    }

    var dir = targetIdx > current ? 'next' : 'prev';
    var size = stageSize(axis);
    var outgoing = cardEls[current];
    var incoming = cardEls[targetIdx];

    transitioning = true;
    setCurrent(targetIdx); // progress/title update at commit start, not after the animation

    incoming.classList.add('is-active');
    if (!viaDrag) {
      setTransform(incoming, axis, dir === 'next' ? size : -size);
      void incoming.offsetWidth; // commit that "from" position before animating
    }

    outgoing.classList.remove('is-current');
    outgoing.classList.add('settling');
    incoming.classList.add('settling');

    requestAnimationFrame(function () {
      setTransform(outgoing, axis, dir === 'next' ? -size : size);
      setTransform(incoming, axis, 0);
    });

    var timer;
    var finish = function () {
      outgoing.removeEventListener('transitionend', finish);
      clearTimeout(timer);
      clearCard(outgoing);
      incoming.classList.remove('settling');
      incoming.style.transform = '';
      incoming.classList.add('is-current');
      transitioning = false;
    };
    outgoing.addEventListener('transitionend', finish);
    timer = setTimeout(finish, SETTLE_MS);
  }

  function onPointerDown(ev) {
    if (transitioning || drag) return;
    if (ev.target.closest('button, input, textarea, a, select')) return;
    var cardEl = cardEls[current];
    drag = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      axis: null,
      dir: null,
      neighbor: null,
      atTop: cardEl.scrollTop <= 0,
      atBottom: cardEl.scrollTop >= cardEl.scrollHeight - cardEl.clientHeight - 1,
      samples: [{ t: performance.now(), x: ev.clientX, y: ev.clientY }],
      wasReal: false
    };
    elCards.setPointerCapture(ev.pointerId);
  }

  function resetNeighbor() {
    if (drag && drag.neighbor) {
      clearCard(drag.neighbor);
      drag.neighbor = null;
    }
  }

  function onPointerMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    var dx = ev.clientX - drag.startX;
    var dy = ev.clientY - drag.startY;

    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
      var wantAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (wantAxis === 'y') {
        // Only hijack a vertical drag into a card-swipe once the current
        // card's own content can't scroll any further in that direction —
        // otherwise let native scrolling handle a tall card as usual.
        var eligible = dy < 0 ? drag.atBottom : drag.atTop;
        if (!eligible) { drag.axis = 'scroll'; return; }
      }
      drag.axis = wantAxis;
    }
    if (drag.axis === 'scroll') return;

    ev.preventDefault();
    drag.wasReal = true;
    drag.samples.push({ t: performance.now(), x: ev.clientX, y: ev.clientY });
    if (drag.samples.length > 6) drag.samples.shift();

    var delta = drag.axis === 'x' ? dx : dy;
    var dir = delta < 0 ? 'next' : delta > 0 ? 'prev' : drag.dir;
    var targetIdx = dir === 'next' ? current + 1 : current - 1;
    var hasTarget = targetIdx >= 0 && targetIdx < cardEls.length;

    if (dir !== drag.dir) {
      resetNeighbor();
      drag.dir = dir;
      if (hasTarget) {
        drag.neighbor = cardEls[targetIdx];
        drag.neighbor.classList.add('is-active');
        var size = stageSize(drag.axis);
        setTransform(drag.neighbor, drag.axis, dir === 'next' ? size : -size);
      }
    }

    var applied = hasTarget ? delta : delta * 0.3; // rubber-band past the ends
    setTransform(cardEls[current], drag.axis, applied);
    if (drag.neighbor) {
      var base = dir === 'next' ? stageSize(drag.axis) : -stageSize(drag.axis);
      setTransform(drag.neighbor, drag.axis, base + applied);
    }
  }

  function onPointerUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    var g = drag;
    drag = null;
    if (!g.axis || g.axis === 'scroll' || !g.wasReal) return; // a tap or a native scroll

    wasDrag = true; // the browser may still synthesize a click — ignore it

    var size = stageSize(g.axis);
    var first = g.samples[0];
    var last = g.samples[g.samples.length - 1];
    var totalMoved = g.axis === 'x' ? (last.x - g.startX) : (last.y - g.startY);
    var velocity = Math.abs((g.axis === 'x' ? last.x - first.x : last.y - first.y)) / Math.max(1, last.t - first.t);
    var targetIdx = g.dir === 'next' ? current + 1 : current - 1;
    var hasTarget = targetIdx >= 0 && targetIdx < cardEls.length;
    var shouldCommit = hasTarget && (Math.abs(totalMoved) > size * COMMIT_RATIO || velocity > COMMIT_VELOCITY);

    if (shouldCommit) {
      settle(targetIdx, g.axis, true); // neighbor is already live-positioned
    } else {
      springBack(cardEls[current], g.axis, g.neighbor, g.dir);
    }
  }

  function onPointerCancel(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    var g = drag;
    drag = null;
    if (!g.axis || g.axis === 'scroll') return;
    springBack(cardEls[current], g.axis, g.neighbor, g.dir);
  }

  /* ---- Boot ---- */

  function render(rows) {
    // Display-only mode: with no submit endpoint configured, input cards
    // can't save anything, so show story cards only.
    if (CFG.SUBMIT_URL === '') {
      rows = rows.filter(function (row) { return !INPUT_TYPES[row.type]; });
    }
    cards = rows;
    elCards.innerHTML = '';
    elCards.classList.add(MODE);

    rows.forEach(function (row, i) {
      var card = INPUT_TYPES[row.type] ? inputCard(row, i) : storyCard(row, i);
      cardEls.push(card);
      elCards.appendChild(card);
    });

    buildProgress();

    if (MODE === 'deck') {
      current = 0;
      if (cardEls[0]) cardEls[0].classList.add('is-active', 'is-current');
    }
    setCurrent(0);

    if (MODE === 'deck') {
      elCards.addEventListener('pointerdown', onPointerDown);
      elCards.addEventListener('pointermove', onPointerMove);
      elCards.addEventListener('pointerup', onPointerUp);
      elCards.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('resize', function () {
        if (drag) onPointerCancel({ pointerId: drag.pointerId });
      });

      // Tap the outer edges of a story area to flip cards (never steals
      // taps from buttons or fields). A real drag suppresses the one
      // synthetic click that follows it, so releasing inside a tap zone
      // doesn't also fire a second, conflicting navigation.
      elCards.addEventListener('click', function (ev) {
        if (wasDrag) { wasDrag = false; return; }
        if (ev.target.closest('button, input, textarea, a, select')) return;
        var x = ev.clientX, w = window.innerWidth;
        if (x < w * 0.25) goTo(current - 1);
        else if (x > w * 0.75) goTo(current + 1);
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.target.closest && ev.target.closest('input, textarea')) return;
        if (ev.key === 'ArrowLeft') goTo(current - 1);
        if (ev.key === 'ArrowRight') goTo(current + 1);
        if (ev.key === 'ArrowUp') goTo(current + 1);
        if (ev.key === 'ArrowDown') goTo(current - 1);
      });
    } else {
      // Keep progress + title in sync with whatever card is in view.
      // Track all visible cards and follow the topmost one, so the title
      // is right even when two cards share the screen.
      var visible = new Set();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var idx = cardEls.indexOf(entry.target);
          if (entry.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        });
        if (visible.size) setCurrent(Math.min.apply(null, Array.from(visible)));
      }, { root: elCards, threshold: 0.35 });
      cardEls.forEach(function (c) { io.observe(c); });

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

  fetch(CFG.CONTENT_URL || '/api/content')
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
