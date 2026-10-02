// The front door: say where you are, not which county you want.
//
// Two indexes do the work, both built from our own records (pipeline/places.py):
// places.json maps "houston|tx" to the county slug that holds most of that town's
// churches, and counties.json carries each county's mid-point so the browser's
// coordinates can be matched without asking a geocoding service for them. The
// chips are not filters here — nothing to filter yet — so they travel to the
// county page as a query string and are applied on arrival.
//
// A visitor types what is true of where they live, in whatever shape comes to
// hand: "Bonn, Germany", "Maidstone, Kent", "Montreal", "Cologne", "Houston TX".
// All of those have to arrive somewhere, so the query is folded to plain ASCII
// words and read from the right: country first, then region, then the town.
(function () {
  var index = null, loading = null;
  var where = document.getElementById('where');
  var help = document.getElementById('finderHelp');
  var suggest = document.getElementById('suggest');
  var chips = document.getElementById('chips');

  // Region and country names come from the index (build writes them from the same
  // table the pages are titled from), so "Maidstone Kent" and "Bonn, Germany" work
  // without a list of names living here as well.
  var regions = {}, regionNames = {}, countries = {};
  var regionKeys = [], countryKeys = [];
  var entries = [];      // {t: folded town, d: as written, s: region, g: slug, n: churches}

  // Letters NFD leaves whole, so they are named. Must agree with places.fold().
  var LETTERS = { 'ß': 'ss', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'æ': 'ae', 'œ': 'oe',
                  'þ': 'th', 'ð': 'd', 'ı': 'i' };
  // dropped, not spaced: Haleʻiwa is typed "Haleiwa" and St John's is one word
  var MARKS = /['‘’ʻʼ´`]/g;

  // "Côte-St-Luc" and "cote st luc" are one query. Nobody types the umlaut in
  // Köln, and 1,299 of our towns carry a mark of some kind.
  function fold(text) {
    var s = (text || '').toLowerCase();
    for (var ch in LETTERS) s = s.split(ch).join(LETTERS[ch]);
    s = s.replace(MARKS, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function load() {
    if (loading) return loading;
    var url = (document.querySelector('meta[name="places-url"]') || {}).content || 'places.json';
    loading = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (data) {
      index = data;
      regions = data.regions || {};
      regionNames = data.region_names || {};
      countries = data.countries || {};
      // Folded once here rather than on every keystroke: longest first, so
      // "northern ireland" is not read as Ireland and "new york" beats "york".
      regionKeys = Object.keys(regions).map(fold).sort(byLengthDesc);
      countryKeys = Object.keys(countries).map(fold).sort(byLengthDesc);
      var folded = {};
      for (var name in regions) folded[fold(name)] = regions[name];
      regions = folded;
      folded = {};
      for (name in countries) folded[fold(name)] = countries[name];
      countries = folded;
      for (var key in data.places) {
        var bar = key.lastIndexOf('|'), place = data.places[key];
        entries.push({ t: fold(key.slice(0, bar)), d: key.slice(0, bar),
                       s: key.slice(bar + 1), g: place[0], n: place[1] });
      }
      return data;
    });
    return loading;
  }

  function byLengthDesc(a, b) { return b.length - a.length; }

  // Warm the index as soon as someone shows intent, so the first search is instant
  where.addEventListener('focus', load, { once: true });

  function say(msg) { help.textContent = msg || ''; }

  function params() {
    var on = [].slice.call(chips.querySelectorAll('[aria-pressed="true"]'));
    if (!on.length) return '';
    return '?' + on.map(function (b) { return 'f=' + encodeURIComponent(b.dataset.filter); }).join('&');
  }

  function go(slug) { location.href = slug + '/index.html' + params(); }

  function endsWithWord(q, word) {
    return q === word || q.slice(-(word.length + 1)) === ' ' + word;
  }

  function strip(q, word) { return q.slice(0, q.length - word.length).trim(); }

  // "Houston, TX" / "houston texas" / "Maidstone, Kent" / "Bonn, Germany" /
  // "Bonn" all have to work. Read from the right and keep what is left over.
  function parse(text) {
    var q = fold(text);
    if (!q) return null;
    var codes = null, state = null, i;
    for (i = 0; i < countryKeys.length; i++) {
      if (endsWithWord(q, countryKeys[i]) && strip(q, countryKeys[i])) {
        codes = countries[countryKeys[i]];
        q = strip(q, countryKeys[i]);
        break;
      }
    }
    for (i = 0; i < regionKeys.length; i++) {
      if (endsWithWord(q, regionKeys[i]) && strip(q, regionKeys[i])) {
        state = regions[regionKeys[i]];
        q = strip(q, regionKeys[i]);
        break;
      }
    }
    if (!state) {
      // a trailing code: two letters for a state or province, three for a British
      // county. Only if we hold that code - otherwise it is part of the name.
      var m = q.match(/^(.+)\s([a-z]{2,3})$/);
      if (m && regionNames[m[2]]) { state = m[2]; q = m[1].trim(); }
    }
    return { town: q, state: state, codes: codes };
  }

  function matches(q) {
    if (!entries.length) return [];
    var parsed = parse(q);
    if (!parsed || parsed.town.length < 2) return [];
    var town = parsed.town, out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (parsed.state && e.s !== parsed.state) continue;
      if (parsed.codes && parsed.codes.indexOf(e.s) < 0) continue;
      var rank;
      if (e.t === town) rank = 0;
      else if (e.t.indexOf(town) === 0) rank = 1;
      else continue;
      out.push({ town: e.d, t: e.t, state: e.s, slug: e.g, rank: rank, n: e.n });
    }
    // what was typed exactly, then the town with the most churches in it: typing
    // "Bonn" must not bury Bonn under eight American towns that merely begin with
    // those letters, and "Houston" means the one with 2,790 of them.
    out.sort(function (a, b) {
      return a.rank - b.rank || b.n - a.n ||
        a.town.length - b.town.length || (a.town < b.town ? -1 : 1);
    });
    return out.slice(0, 8);
  }

  function title(s) {
    return s.replace(/(^|[\s'-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function showSuggestions(list) {
    if (!list.length) { suggest.hidden = true; suggest.innerHTML = ''; return; }
    suggest.innerHTML = list.map(function (p) {
      var where = regionNames[p.state] || p.state.toUpperCase();
      // the locality they would land in, unless that is the town they just typed:
      // "Toronto, Ontario — Toronto" says nothing twice. The region code comes off
      // the end, and a British county's code is three letters, not two.
      var landing = p.slug.replace(/-[a-z]{2,3}$/, '').replace(/-/g, ' ');
      return '<li><button type="button" data-slug="' + p.slug + '">' + title(p.town) +
        ', ' + where + (fold(landing) === p.t ? '' :
        ' <span class="where">' + title(landing) + '</span>') + '</button></li>';
    }).join('');
    suggest.hidden = false;
  }

  var timer = null;
  where.addEventListener('input', function () {
    clearTimeout(timer);
    var q = where.value;
    timer = setTimeout(function () {
      load().then(function () { showSuggestions(matches(q)); })
        .catch(function () { say('The place list could not be loaded. Browse by country below.'); });
    }, 120);
  });

  suggest.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-slug]');
    if (b) go(b.dataset.slug);
  });

  document.addEventListener('click', function (e) {
    if (!suggest.contains(e.target) && e.target !== where) suggest.hidden = true;
  });

  document.getElementById('finder').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = where.value.trim();
    if (!q) { where.focus(); return; }
    say('Looking…');
    load().then(function () {
      var found = matches(q);
      if (found.length) { go(found[0].slug); return; }
      say('We could not place “' + q + '”. Try the town name on its own, or browse by country below.');
      suggest.hidden = true;
    }).catch(function () { say('The place list could not be loaded. Browse by country below.'); });
  });

  document.getElementById('locate').addEventListener('click', function () {
    if (!navigator.geolocation) { say('This browser cannot share your location. Type a town instead.'); return; }
    say('Finding your nearest churches…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      load().then(function (data) {
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        var best = null, bestD = null;
        for (var i = 0; i < data.counties.length; i++) {
          var c = data.counties[i];
          var dy = c.lat - lat, dx = (c.lon - lon) * Math.cos(lat * Math.PI / 180);
          var d = dy * dy + dx * dx;
          if (bestD === null || d < bestD) { best = c.s; bestD = d; }
        }
        if (best) go(best); else say('We could not match your location. Try the town name.');
      }).catch(function () { say('The place list could not be loaded. Browse by country below.'); });
    }, function () {
      say('We could not read your location. Type a town instead.');
    }, { timeout: 10000, maximumAge: 600000 });
  });

  chips.addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  });

  // "All 51" simply reveals the states the grid is holding back
  var all = document.getElementById('allStates'), grid = document.getElementById('stateGrid');
  if (all && grid) {
    all.addEventListener('click', function (e) {
      e.preventDefault();
      [].forEach.call(grid.querySelectorAll('li[hidden]'), function (li) { li.hidden = false; });
      all.hidden = true;
    });
  }
})();
