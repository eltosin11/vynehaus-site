// The front door: say where you are, not which county you want.
//
// Two indexes do the work, both built from our own records (pipeline/places.py):
// places.json maps "houston|tx" to the county slug that holds most of that town's
// churches, and counties.json carries each county's mid-point so the browser's
// coordinates can be matched without asking a geocoding service for them. The
// chips are not filters here — nothing to filter yet — so they travel to the
// county page as a query string and are applied on arrival.
(function () {
  var index = null, loading = null;
  var where = document.getElementById('where');
  var help = document.getElementById('finderHelp');
  var suggest = document.getElementById('suggest');
  var chips = document.getElementById('chips');

  // Region names come from the index (build writes them from the same table the
  // pages are titled from), so "Maidstone Kent" and "Koeln Nordrhein-Westfalen" work
  // without a list of names living here as well.
  var regions = {}, regionNames = {};

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
      return data;
    });
    return loading;
  }

  // Warm the index as soon as someone shows intent, so the first search is instant
  where.addEventListener('focus', load, { once: true });

  function say(msg) { help.textContent = msg || ''; }

  function params() {
    var on = [].slice.call(chips.querySelectorAll('[aria-pressed="true"]'));
    if (!on.length) return '';
    return '?' + on.map(function (b) { return 'f=' + encodeURIComponent(b.dataset.filter); }).join('&');
  }

  function go(slug) { location.href = slug + '/index.html' + params(); }

  // "Houston, TX" / "houston texas" / "Maidstone Kent" / "Houston" all have to work
  function parse(text) {
    var q = text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return null;
    // a trailing code: two letters for a state or province, three for a British county
    var m = q.match(/^(.*?)[,\s]+([a-z]{2,3})$/);
    if (m && m[2] !== 'in' && (regions[m[2]] === undefined)) {
      return { town: m[1].trim(), state: m[2] };
    }
    var best = null;
    for (var name in regions) {
      // longest match wins: "york" must not win over "new york"
      if ((q.endsWith(' ' + name) || q.endsWith(',' + name)) &&
          (!best || name.length > best.length)) best = name;
    }
    if (best) {
      return { town: q.slice(0, -best.length - 1).trim(), state: regions[best] };
    }
    return { town: q, state: null };
  }

  function matches(q) {
    if (!index) return [];
    var parsed = parse(q);
    if (!parsed || parsed.town.length < 2) return [];
    var out = [];
    var exact = parsed.state && index.places[parsed.town + '|' + parsed.state];
    if (exact) out.push({ town: parsed.town, state: parsed.state, slug: exact });
    for (var key in index.places) {
      if (out.length >= 8) break;
      var bar = key.lastIndexOf('|');
      var town = key.slice(0, bar), st = key.slice(bar + 1);
      if (parsed.state && st !== parsed.state) continue;
      if (town.indexOf(parsed.town) !== 0) continue;
      if (exact && town === parsed.town && st === parsed.state) continue;
      out.push({ town: town, state: st, slug: index.places[key] });
    }
    return out;
  }

  function title(s) {
    return s.replace(/(^|[\s'-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function showSuggestions(list) {
    if (!list.length) { suggest.hidden = true; suggest.innerHTML = ''; return; }
    suggest.innerHTML = list.map(function (p) {
      var where = regionNames[p.state] || p.state.toUpperCase();
      return '<li><button type="button" data-slug="' + p.slug + '">' + title(p.town) +
        ', ' + where + ' <span class="where">' +
        title(p.slug.replace(/-/g, ' ').replace(/ [a-z]{2}$/, '')) + '</span></button></li>';
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
      say('We could not place “' + q + '”. Try the town name, or browse by state below.');
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
