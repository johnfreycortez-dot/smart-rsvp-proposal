/* Smart RSVP walkthrough: a small in-browser stand-in for the Google Sheet, so every screen on this
 * page can be tried with sample data. One shared store per page; the guest page and couple dashboard
 * frames reuse the parent page's store, so a reply on the phone shows up on the dashboard and in the outbox. */
(function () {
  try { if (window.parent !== window && window.parent.DemoStore) { window.DemoStore = window.parent.DemoStore; return; } } catch (e) { /* not same origin */ }

  var D = window.DEMO_DATA;
  var listeners = [];
  var H = D.guests[0];
  var col = function (n) { return H.indexOf(n); };
  var C = { id: col('Guest ID'), code: col('Event Code'), group: col('Group Name'), main: col('Main Guest'), comp: col('Companions (separate with commas)'),
    email: col('Email'), mobile: col('Mobile'), table: col('Table No.'), vip: col('VIP'), notes: col('Notes for Couple'), role: col('Guest Role'),
    message: col('Message for Guest'), status: col('RSVP Status'), att: col('Attending'), dec: col('Declined'), names: col('Attending Names'), last: col('Last Response') };

  function splitNames(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String); }
  var guests = D.guests.slice(1).map(function (r) {
    return { id: r[C.id], code: r[C.code], group: r[C.group], people: [r[C.main]].concat(splitNames(r[C.comp])), email: r[C.email] || '', mobile: r[C.mobile] || '',
      table: r[C.table] === '' || r[C.table] == null ? '' : String(r[C.table]), vip: !!r[C.vip], notes: r[C.notes] || '', role: r[C.role] || '', message: r[C.message] || '',
      status: r[C.status] || '', attendingNames: r[C.names] || '', last: r[C.last] ? new Date(r[C.last]) : null, changeNo: r[C.status] ? 1 : 0, lastReminder: 0 };
  });
  var responses = D.responses.slice(1).map(function (r) { return { t: new Date(r[0]), code: r[1], id: r[2] }; });
  var settings = { confirmGuest: true, alertCouple: true, reminders: true, weddingReminders: true, autoClose: true, thankYou: true, welcomeCouple: true, ccCouple: true, verifyMobile: false };
  var events = {};
  Object.keys(D.events).forEach(function (code) {
    var e = D.events[code];
    events[code] = { code: code, name: e.rsvp.event.name, closed: false, coupleEmail: D.mails[code + ':links'].to, key: e.key, linksState: 'none', linksAt: null, queueTimer: null, queueEnds: 0, design: JSON.parse(JSON.stringify(e.rsvp.design)) };
  });
  var outbox = [];
  var nextId = guests.length + 1;

  function emit(what) { listeners.slice().forEach(function (f) { try { f(what); } catch (e) { /* frame may be gone */ } }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function lev(a, b) {
    if (a === b) return 0; var m = a.length, n = b.length, prev = [], cur;
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) { cur = [i]; for (var k = 1; k <= n; k++) cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  function match(code, typed) {
    var q = norm(typed); if (q.length < 3) return [];
    var out = [];
    guests.forEach(function (g) {
      if (g.code !== code) return; var best = 99;
      g.people.forEach(function (p) { var n = norm(p), d = n === q ? 0 : lev(q, n), allowed = n.length <= 6 ? 1 : 2; if (d <= allowed && d < best) best = d; });
      if (best < 99) out.push({ g: g, d: best });
    });
    return out.sort(function (a, b) { return a.d - b.d; });
  }
  function fmtDay(d) { return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : ''; }
  function fmtStamp(d) { return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; }
  function privacyOk(g, digits) {
    if (!settings.verifyMobile) return true;
    var want = String(g.mobile || '').replace(/\D/g, ''); if (want.length < 4) return true;
    return String(digits || '').replace(/\D/g, '') === want.slice(-4);
  }
  function mail(code, type, to, guestEmail) {
    var tpl = D.mails[code + ':' + type];
    var couple = events[code].coupleEmail;
    var cc = guestEmail && settings.ccCouple && couple && couple !== to ? couple : '';
    outbox.unshift({ at: new Date(), code: code, type: type, to: to, cc: cc, subject: tpl.subject, event: events[code].name });
    if (outbox.length > 60) outbox.length = 60;
  }
  function guestById(code, id) { for (var i = 0; i < guests.length; i++) if (guests[i].code === code && guests[i].id === id) return guests[i]; return null; }

  var api = {
    findGuest: function (code, typed, digits) {
      var ev = events[code];
      if (ev.closed) return { ok: false, closed: true, message: 'RSVP for this event is now closed.' };
      if (norm(typed).length < 3) return { ok: false, message: 'Please type your full name as written on the invitation.' };
      var m = match(code, typed);
      if (!m.length) return { ok: false, message: 'Sorry, we can’t find that name on the guest list. Please type it exactly as written on your invitation.' };
      if (m.length > 1 && m[1].d === m[0].d) return { ok: false, message: 'More than one invitation matches that name. Please type your full name, including your middle initial if you have one.' };
      var g = m[0].g;
      if (!privacyOk(g, digits)) return { ok: false, needDigits: true, message: digits ? 'Those digits don’t match. Please try again, or contact the couple.' : 'For privacy, please enter the last 4 digits of your mobile number.' };
      var prev = g.status ? splitNames(g.attendingNames).map(norm) : null;
      return { ok: true, guestId: g.id, group: g.group, role: g.role, message: g.message, seats: g.people.length, email: g.email, responded: !!g.status,
        lastResponse: fmtDay(g.last), people: g.people.map(function (p) { return { name: p, attending: prev ? prev.indexOf(norm(p)) >= 0 : true }; }) };
    },
    submitRsvp: function (code, id, answers, email, digits) {
      var g = guestById(code, id); if (!g) throw new Error('We couldn’t save your response. Please try again.');
      if (events[code].closed) throw new Error('RSVP for this event is now closed.');
      var yes = [], no = [];
      g.people.forEach(function (p, i) { (answers[i] ? yes : no).push(p); });
      g.status = !yes.length ? 'Declined' : (no.length ? 'Partly attending' : 'Attending');
      g.attendingNames = yes.join(', '); g.last = new Date(); g.changeNo++;
      if (email) g.email = email;
      responses.push({ t: new Date(), code: code, id: id });
      if (settings.confirmGuest && g.email) mail(code, 'confirmation', g.email, true);
      if (settings.alertCouple) mail(code, 'alert', events[code].coupleEmail, false);
      emit('rsvp');
      return { ok: true, status: g.status, attending: yes, declined: no, seats: g.people.length, email: g.email, changeNo: g.changeNo,
        calendarUrl: yes.length ? D.events[code].links.calendar : '', table: yes.length ? g.table : '' };
    },
    findTable: function (code, typed, digits) {
      var m = match(code, typed);
      if (!m.length) return { ok: false, message: 'Sorry, we can’t find that name on the guest list.' };
      if (m.length > 1 && m[1].d === m[0].d) return { ok: false, message: 'More than one guest matches that name. Please type your full name.' };
      var g = m[0].g;
      if (!privacyOk(g, digits)) return { ok: false, needDigits: true, message: digits ? 'Those digits don’t match. Please try again.' : 'For privacy, please enter the last 4 digits of your mobile number.' };
      if (g.status === 'Declined') return { ok: false, message: 'Our records show your group declined the invitation. Please see the reception desk if your plans changed.' };
      if (!g.table) return { ok: false, message: 'Your table hasn’t been assigned yet. Please check again closer to the day, or ask the reception desk.' };
      return { ok: true, group: g.group, table: g.table, names: g.attendingNames ? splitNames(g.attendingNames) : g.people, vip: g.vip, role: g.role, message: g.message };
    },
    getDashboard: function (code, key) { checkKey(code, key); return stats(code); },
    coupleSaveGuest: function (code, key, x) {
      checkKey(code, key);
      var main = String(x.main || '').trim();
      if (!main) throw new Error('Please type the main guest’s name.');
      if (!String(x.group || '').trim()) throw new Error('Please add a group name.');
      if (!String(x.email || '').trim() && !String(x.mobile || '').trim()) throw new Error('Please add an email or a mobile number.');
      if (x.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x.email).trim())) throw new Error('That email address doesn’t look right.');
      var people = [main].concat(splitNames(x.companions));
      var taken = {};
      guests.forEach(function (g) { if (g.code === code && g.id !== x.id) g.people.forEach(function (p) { taken[norm(p)] = g.group; }); });
      people.forEach(function (p) { if (taken[norm(p)]) throw new Error(p + ' is already on your guest list (' + taken[norm(p)] + ').'); });
      var g = x.id ? guestById(code, x.id) : null;
      if (x.id && !g) throw new Error('This guest was not found. Tap Refresh and try again.');
      if (!g) { g = { id: 'G' + String(nextId++).padStart(4, '0'), code: code, status: '', attendingNames: '', last: null, changeNo: 0, lastReminder: 0 }; guests.push(g); }
      g.group = String(x.group).trim(); g.people = people; g.email = String(x.email || '').trim(); g.mobile = String(x.mobile || '').trim();
      g.table = String(x.table || '').trim(); g.vip = x.vip === true; g.notes = x.notes || ''; g.role = x.role || ''; g.message = x.message || '';
      emit('guests');
      return { ok: true, edited: !!x.id, group: g.group, seats: people.length, stats: stats(code) };
    },
    coupleAddGuest: function (code, key, x) { x.id = ''; return api.coupleSaveGuest(code, key, x); },
    coupleRemoveGuest: function (code, key, id) {
      checkKey(code, key);
      var g = guestById(code, id); if (!g) throw new Error('This guest was not found. Tap Refresh and try again.');
      guests.splice(guests.indexOf(g), 1); emit('guests');
      return { ok: true, group: g.group, stats: stats(code) };
    },
    coupleSendReminders: function (code, key) {
      checkKey(code, key);
      var sent = 0, noEmail = 0, recent = 0, now = Date.now();
      guests.forEach(function (g) {
        if (g.code !== code || g.status) return;
        if (!g.email) { noEmail++; return; }
        if (now - g.lastReminder < 864e5) { recent++; return; }
        g.lastReminder = now; mail(code, 'reminder', g.email, true); sent++;
      });
      emit('mail');
      return { sent: sent, noEmail: noEmail, recent: recent };
    },
    coupleSendAnnouncement: function (code, key, aud, subject, body) {
      checkKey(code, key);
      if (!String(subject || '').trim() || !String(body || '').trim()) throw new Error('Please add a subject and a message.');
      var sent = 0, noEmail = 0;
      guests.forEach(function (g) {
        if (g.code !== code) return;
        var include = aud === 'all' ? g.status !== 'Declined' : (g.status === 'Attending' || g.status === 'Partly attending');
        if (!include) return;
        if (!g.email) { noEmail++; return; }
        mail(code, 'announcement', g.email, true); outbox[0].subject = String(subject).trim() + ' – ' + events[code].name; sent++;
      });
      emit('mail');
      return { sent: sent, noEmail: noEmail };
    }
  };
  function checkKey(code, key) { if (!events[code] || events[code].key !== key) throw new Error('This dashboard link is not valid.'); }

  function stats(code) {
    var seats = 0, yes = 0, no = 0, reach = { pending: 0, pendingEmail: 0, attending: 0, attendingEmail: 0, invited: 0, invitedEmail: 0 }, tables = {};
    var list = guests.filter(function (g) { return g.code === code; });
    var groups = list.map(function (g) {
      var att = g.status ? splitNames(g.attendingNames).length : 0, dec = g.status ? g.people.length - att : 0;
      seats += g.people.length; yes += att; no += dec;
      if (g.status !== 'Declined') { reach.invited++; if (g.email) reach.invitedEmail++; }
      if (!g.status) { reach.pending++; if (g.email) reach.pendingEmail++; }
      if (att > 0) {
        reach.attending++; if (g.email) reach.attendingEmail++;
        var tk = g.table || 'Unassigned';
        (tables[tk] = tables[tk] || []).push({ group: g.group, names: splitNames(g.attendingNames), count: att, vip: g.vip, role: g.role });
      }
      return { id: g.id, group: g.group, main: g.people[0], companions: g.people.slice(1).join(', '), email: g.email, mobile: g.mobile, notes: g.notes, message: g.message,
        seats: g.people.length, status: g.status || 'No reply yet', role: g.role, attending: g.status ? att : '', names: g.attendingNames, table: g.table, vip: g.vip, last: fmtStamp(g.last) };
    });
    var seating = Object.keys(tables).sort(function (a, b) {
      if (a === 'Unassigned') return 1; if (b === 'Unassigned') return -1;
      var na = Number(a), nb = Number(b); return (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b));
    }).map(function (k) { return { table: k, total: tables[k].reduce(function (s, x) { return s + x.count; }, 0), groups: tables[k] }; });
    var seen = {}, days = {};
    responses.forEach(function (r) {
      if (r.code !== code || seen[r.id]) return; seen[r.id] = 1;
      var k = r.t.toISOString().slice(0, 10); days[k] = (days[k] || 0) + 1;
    });
    var cum = 0, timeline = Object.keys(days).sort().map(function (k) { cum += days[k]; return { day: new Date(k + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), n: days[k], total: cum }; });
    var rs = D.events[code].rsvp.event;
    return { seats: seats, attending: yes, declined: no, waiting: seats - yes - no, groups: groups, groupsWaiting: groups.filter(function (g) { return g.status === 'No reply yet'; }).length,
      reach: reach, seating: seating, rsvpOpen: !events[code].closed, daysLeft: rs.daysLeft, updated: fmtStamp(new Date()), timeline: timeline };
  }

  // ---- things Nix does in the Sheet, and the daily automation
  var sheet = {
    missingForLinks: function (code) {
      var ev = events[code], miss = [];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+/.test(ev.coupleEmail || '')) miss.push('Couple Email');
      return miss;
    },
    setCoupleEmail: function (code, v) { events[code].coupleEmail = String(v || '').trim(); emit('event'); },
    tickSendLinks: function (code, on, seconds) {
      var ev = events[code];
      clearTimeout(ev.queueTimer);
      if (!on) { if (ev.linksState === 'queued') ev.linksState = 'cancelled'; emit('event'); return; }
      if (ev.linksState === 'sent') { emit('event'); return; }
      var miss = sheet.missingForLinks(code);
      if (miss.length) { ev.linksState = 'missing'; ev.missing = miss; emit('event'); return; }
      ev.linksState = 'queued'; ev.queueEnds = Date.now() + seconds * 1000;
      ev.queueTimer = setTimeout(function () {
        if (!settings.welcomeCouple) { ev.linksState = 'off'; emit('event'); return; }
        ev.linksState = 'sent'; ev.linksAt = new Date(); mail(code, 'links', ev.coupleEmail, false); emit('mail');
      }, seconds * 1000);
      emit('event');
    },
    runDaily: function (code, moment) {
      var n = 0;
      if (moment === 'reminder' && settings.reminders) guests.forEach(function (g) { if (g.code === code && !g.status && g.email) { mail(code, 'reminder', g.email, true); n++; } });
      if (moment === 'event' && settings.weddingReminders) guests.forEach(function (g) { if (g.code === code && splitNames(g.attendingNames).length && g.email) { mail(code, 'event', g.email, true); n++; } });
      if (moment === 'close' && settings.autoClose) { events[code].closed = true; n = 1; }
      if (moment === 'thankyou' && settings.thankYou) guests.forEach(function (g) { if (g.code === code && splitNames(g.attendingNames).length && g.email) { mail(code, 'thankyou', g.email, true); n++; } });
      emit(moment === 'close' ? 'event' : 'mail');
      return n;
    },
    reopen: function (code) { events[code].closed = false; emit('event'); }
  };

  window.DemoStore = {
    data: D, api: api, sheet: sheet, settings: settings, events: events, outbox: outbox, guests: guests, stats: stats, splitNames: splitNames,
    set: function (k, v) { settings[k] = v; emit('settings'); },
    on: function (f) { listeners.push(f); return function () { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; },
    emit: emit,
    rsvpData: function (code, params) {
      var base = JSON.parse(JSON.stringify(D.events[code].rsvp));
      base.design = JSON.parse(JSON.stringify(events[code].design));
      if (params.view === 'table') { base.mode = 'table'; }
      if (events[code].closed && base.mode !== 'table') base.state = 'closed';
      base.askEmail = settings.confirmGuest;
      if (params.layout) base.design.layout = params.layout;
      if (params.palette) { var p = D.palettes.filter(function (x) { return x[0] === params.palette; })[0]; if (p) { base.design.main = p[1]; base.design.accent = p[2]; base.design.bg = p[3]; base.design.text = p[4]; } }
      if (params.font) base.design.namesFont = params.font;
      return base;
    },
    dashData: function (code) {
      var base = JSON.parse(JSON.stringify(D.events[code].dash));
      base.design = JSON.parse(JSON.stringify(events[code].design));
      base.stats = stats(code);
      return base;
    }
  };
})();

/* google.script.run stand-in used inside the demo frames */
window.makeGoogleShim = function (store) {
  function mk(ok, fail) {
    return new Proxy({}, { get: function (_, k) {
      if (k === 'withSuccessHandler') return function (h) { return mk(h, fail); };
      if (k === 'withFailureHandler') return function (h) { return mk(ok, h); };
      if (!store.api[k]) return undefined;
      return function () {
        var a = arguments;
        setTimeout(function () { try { var r = store.api[k].apply(null, a); ok && ok(r); } catch (e) { fail && fail(e); } }, 450);
      };
    } });
  }
  return { script: { run: mk(null, null) } };
};
