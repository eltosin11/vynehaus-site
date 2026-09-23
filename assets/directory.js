// Directory page behaviour: filters, search, sort, list/map.
// Records live in churches.json next to the page (one entry per church, short keys
// and omitted empties, so a big county stays a small download). Labels the page can
// look up are not stored per record.
  const TRADITION = {catholic:'Catholic', orthodox:'Orthodox', anglican:'Anglican / Episcopal',
    methodist:'Methodist', baptist:'Baptist', presbyterian:'Presbyterian', lutheran:'Lutheran',
    pentecostal:'Pentecostal', nondenom:'Non-denominational', other:'Other'};
  const STRUCTURE = {preach:'Preaching-centered', liturgy:'Liturgy-centered', spirit:'Spirit-led'};
  // full field names the rest of the page uses, filled in from the compact record
  const expand = c => ({
    slug: c.s, name: c.n, tradition: c.t || 'other', structure: c.st || 'preach',
    traditionLabel: c.tl || TRADITION[c.t || 'other'] || 'Other',
    structLabel: c.sl || STRUCTURE[c.st || 'preach'],
    language: c.lang || [], music: c.m || [], practical: c.p || [], welcome: c.w || [],
    meta: c.meta || [], tags: c.tags || [], note: c.note || '', tagline: c.tag || '',
    times: c.ti || (c.web ? 'See website' : 'Service times not listed'),
    lat: c.lat, lon: c.lon, verified: c.v || '', unverified: !!c.u, listed: !!c.l,
    phone: c.ph || '', facebook: c.fb || '', website: c.web || '',
    completeness: c.c || 0, profile: !!c.pr, address: c.a || '',
  });
  let churches = [];
  const active = { tradition:[], structure:[], language:[], music:[], practical:[], welcome:[] };
  const quickMap = {
    seekers: ['welcome','seekers'], english: ['language','english'],
    kids: ['practical','kids'], accessible: ['practical','accessible'], livestream: ['practical','livestream']
  };

  // Record text comes from OSM and church websites: never trust it as HTML
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let query = '';
  let view = 'list';
  let map = null, markers = null;

  function matches(c, ignoreKey) {
    if (query && !c.name.toLowerCase().includes(query)) return false;
    for (const key in active) {
      if (key === ignoreKey || active[key].length === 0) continue;
      const vals = Array.isArray(c[key]) ? c[key] : [c[key]];
      if (!active[key].some(v => vals.includes(v))) return false;
    }
    return true;
  }

  // Counts show how many results each option would give with the other filters applied
  function updateCounts() {
    document.querySelectorAll('.opt input').forEach(cb => {
      const f = cb.dataset.f, v = cb.value;
      const n = churches.filter(c => matches(c, f)).filter(c => {
        const vals = Array.isArray(c[f]) ? c[f] : [c[f]];
        return vals.includes(v);
      }).length;
      cb.parentElement.querySelector('.count').textContent = n;
      cb.parentElement.hidden = n === 0 && !cb.checked;
    });
  }

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    complete: (a, b) => b.completeness - a.completeness || a.name.localeCompare(b.name),
    verified: (a, b) => (b.verified || '').localeCompare(a.verified || '') || a.name.localeCompare(b.name),
  };

  function render() {
    const grid = document.getElementById('grid');
    const visible = churches.filter(c => matches(c)).sort(sorters[document.getElementById('sortSelect').value]);
    document.getElementById('count').textContent = visible.length;
    updateCounts();
    if (view === 'map') renderMap(visible);
    if (visible.length === 0) {
      grid.innerHTML = `<div class="no-results"><h3>No churches match all your filters</h3><p>Try removing one to widen your search \u2014 every filter narrows the list.</p></div>`;
      return;
    }
    grid.innerHTML = visible.map(c => `
      <article class="card${c.profile ? '' : ' no-profile'}" ${c.profile ? `data-href="${encodeURIComponent(c.slug)}.html"` : ''}>
        <div class="card-banner ${esc(c.structure)}">
          <span class="card-struct">${esc(c.structLabel)}</span>
          ${c.unverified ? (c.listed ? '<span class="card-listed" title="Found in both OpenStreetMap and Overture Maps">Listed in 2 sources</span>'
                                     : '<span class="card-unverified">Not yet verified</span>') : ''}
        </div>
        <div class="card-body">
          <div class="card-trad">${esc(c.traditionLabel)}</div>
          <div class="card-name">${esc(c.name)}</div>
          ${c.tagline ? `<div class="card-tagline">\u201c${esc(c.tagline)}\u201d</div>` : ''}
          <div class="card-meta">${c.meta.map((m,i)=>`${i>0?'<span class="dot"></span>':''}<span>${esc(m)}</span>`).join('')}</div>
          <div class="card-tags">${c.tags.map(t=>{
            const w = ['Welcomes newcomers','LGBTQ+ affirming','Women clergy'].includes(t);
            return `<span class="ctag ${w?'welcome':''}">${esc(t)}</span>`;
          }).join('')}</div>
          ${c.note ? `<div class="card-note">${esc(c.note)}</div>` : ''}
          ${c.address && !c.profile ? `<div class="card-times"><i class="ti ti-map-pin"></i> ${esc(c.address)}</div>` : ''}
          ${c.phone && !c.profile ? `<div class="card-times"><i class="ti ti-phone"></i> <a href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a></div>` : ''}
          ${c.facebook && !c.profile ? `<div class="card-times"><i class="ti ti-brand-facebook"></i> <a href="${esc(c.facebook)}" rel="noopener nofollow" target="_blank">Facebook page</a></div>` : ''}
          ${c.website && !c.profile ? `<div class="card-times"><i class="ti ti-world"></i> <a href="${esc(c.website)}" rel="noopener nofollow" target="_blank">Church website</a></div>` : ''}
          <div class="card-times"><i class="ti ti-clock"></i> ${esc(c.times)}</div>
        </div>
      </article>
    `).join('');
  }

  document.getElementById('grid').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card && card.dataset.href) location.href = card.dataset.href;
  });

  function renderMap(visible) {
    const note = document.getElementById('mapNote');
    if (!window.L) {
      note.hidden = false;
      note.textContent = 'The map could not load. Check your connection and try again.';
      return;
    }
    if (!map) {
      map = L.map('map', { scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      markers = L.layerGroup().addTo(map);
    }
    markers.clearLayers();
    const placed = visible.filter(c => c.lat != null && c.lon != null);
    placed.forEach(c => {
      L.circleMarker([c.lat, c.lon], { radius: 7, weight: 2, color: '#2C4A3E', fillColor: '#C4603A', fillOpacity: 0.9 })
        .bindPopup(`<div class="map-pop"><strong>${esc(c.name)}</strong><span>${esc(c.traditionLabel)}</span>` +
                   `${c.unverified ? (c.listed ? '<em class="pop-listed">Listed in 2 sources</em>'
                                               : '<em class="pop-unverified">Not yet verified</em>') : ''}` +
                   `${esc(c.times)}` +
                   (c.profile ? `<br><a href="${encodeURIComponent(c.slug)}.html">View profile \u2192</a>`
                              : (c.address ? `<br>${esc(c.address)}` : '')) + `</div>`)
        .addTo(markers);
    });
    if (placed.length) map.fitBounds(placed.map(c => [c.lat, c.lon]), { padding: [30, 30], maxZoom: 15 });
    const missing = visible.length - placed.length;
    note.hidden = missing === 0;
    note.textContent = missing ? (missing === 1 ? "1 church without a location isn't shown on the map."
                                  : `${missing} churches without a location aren't shown on the map.`) : '';
    setTimeout(() => map.invalidateSize(), 0);
  }

  function setView(v) {
    view = v;
    document.getElementById('listBtn').classList.toggle('on', v === 'list');
    document.getElementById('mapBtn').classList.toggle('on', v === 'map');
    document.getElementById('grid').hidden = v === 'map';
    document.getElementById('map').hidden = v !== 'map';
    if (v === 'list') document.getElementById('mapNote').hidden = true;
    render();
  }
  document.getElementById('listBtn').addEventListener('click', () => setView('list'));
  document.getElementById('mapBtn').addEventListener('click', () => setView('map'));
  document.getElementById('sortSelect').addEventListener('change', render);
  document.getElementById('searchInput').addEventListener('input', e => {
    query = e.target.value.trim().toLowerCase();
    render();
  });
  document.querySelector('.search-bar button').addEventListener('click', render);

  // sidebar checkbox filters
  document.querySelectorAll('.opt input').forEach(cb => {
    cb.addEventListener('change', () => {
      const f = cb.dataset.f, v = cb.value;
      if (cb.checked) active[f].push(v);
      else active[f] = active[f].filter(x => x !== v);
      syncQuick();
      render();
    });
  });

  // quick filter bar
  document.querySelectorAll('.qf[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [f, v] = quickMap[btn.dataset.quick];
      const idx = active[f].indexOf(v);
      if (idx === -1) { active[f].push(v); btn.classList.add('on'); }
      else { active[f].splice(idx,1); btn.classList.remove('on'); }
      // sync the matching sidebar checkbox
      const cb = document.querySelector(`.opt input[data-f="${f}"][value="${v}"]`);
      if (cb) cb.checked = active[f].includes(v);
      render();
    });
  });

  function syncQuick() {
    document.querySelectorAll('.qf[data-quick]').forEach(btn => {
      const [f, v] = quickMap[btn.dataset.quick];
      btn.classList.toggle('on', active[f].includes(v));
    });
  }

  document.getElementById('clearAll').addEventListener('click', () => {
    for (const k in active) active[k] = [];
    document.querySelectorAll('.opt input').forEach(cb => cb.checked = false);
    syncQuick();
    render();
  });

  // mobile sidebar
  const sidebar = document.getElementById('sidebar'), overlay = document.getElementById('overlay');
  function openSide(){ sidebar.classList.add('open'); overlay.classList.add('open'); }
  function closeSide(){ sidebar.classList.remove('open'); overlay.classList.remove('open'); }
  document.getElementById('mobileFilterBtn').addEventListener('click', openSide);
  document.getElementById('moreFiltersBtn').addEventListener('click', () => {
    if (window.innerWidth <= 900) openSide();
    else document.getElementById('sidebar').scrollIntoView({behavior:'smooth'});
  });
  overlay.addEventListener('click', closeSide);

  function sendCard(name){ if (window.sendPrompt) sendPrompt('Show me the full church profile page for ' + name); }

  fetch('churches.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => { churches = data.map(expand); render(); })
    .catch(err => {
      document.getElementById('grid').innerHTML =
        '<div class="no-results"><h3>The church list could not be loaded</h3>' +
        '<p>Check your connection and reload the page.</p></div>';
      console.error('churches.json:', err);
    });
