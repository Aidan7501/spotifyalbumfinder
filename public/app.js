let appState = {
  currentTrack: null,
  albums: [],
  activeFilter: 'all',
  activeSort: 'date-desc',
  currentAudio: null,
  playingAudioUrl: null,
};

// DOM Elements
const trackInput = document.getElementById('trackInput');
const searchBtn = document.getElementById('searchBtn');
const pasteBtn = document.getElementById('pasteBtn');
const exampleChips = document.querySelectorAll('.chip');

const errorAlert = document.getElementById('errorAlert');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');
const resultsSection = document.getElementById('resultsSection');

const targetTrackImage = document.getElementById('targetTrackImage');
const targetTrackName = document.getElementById('targetTrackName');
const targetTrackArtist = document.getElementById('targetTrackArtist');
const targetTrackYear = document.getElementById('targetTrackYear');
const targetSpotifyLink = document.getElementById('targetSpotifyLink');

const statTotal = document.getElementById('statTotal');
const statCompilations = document.getElementById('statCompilations');
const statStudio = document.getElementById('statStudio');
const statSingles = document.getElementById('statSingles');

const tabButtons = document.querySelectorAll('.tab-btn');
const sortSelect = document.getElementById('sortSelect');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const albumsGrid = document.getElementById('albumsGrid');
const noResultsInFilter = document.getElementById('noResultsInFilter');

const compilationsCountBadge = document.getElementById('compilationsCountBadge');
const allCountBadge = document.getElementById('allCountBadge');
const albumsCountBadge = document.getElementById('albumsCountBadge');
const singlesCountBadge = document.getElementById('singlesCountBadge');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
});

function setupEventListeners() {
  // Search actions
  searchBtn.addEventListener('click', () => performSearch());
  trackInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // Paste button
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        trackInput.value = text.trim();
        performSearch();
      }
    } catch (err) {
      trackInput.focus();
    }
  });

  // Example pills
  exampleChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      trackInput.value = chip.dataset.query;
      performSearch();
    });
  });

  // Tabs filtering
  tabButtons.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      tab.classList.add('active');
      appState.activeFilter = tab.dataset.filter;
      renderAlbums();
    });
  });

  // Sorting
  sortSelect.addEventListener('change', (e) => {
    appState.activeSort = e.target.value;
    renderAlbums();
  });

  // Export CSV
  exportCsvBtn.addEventListener('click', exportToCsv);

  // Copy link action via event delegation on albumsGrid
  albumsGrid.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.card-copy-btn');
    if (!copyBtn) return;
    const url = copyBtn.dataset.url;
    if (!url) return;

    await copyToClipboard(url);

    const originalHtml = copyBtn.innerHTML;
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Copied!</span>
    `;

    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = originalHtml;
    }, 2000);
  });

  // Target song copy link button
  const targetCopyLinkBtn = document.getElementById('targetCopyLinkBtn');
  if (targetCopyLinkBtn) {
    targetCopyLinkBtn.addEventListener('click', async () => {
      const url = appState.currentTrack?.spotifyUrl;
      if (!url) return;
      await copyToClipboard(url);
      const originalHtml = targetCopyLinkBtn.innerHTML;
      targetCopyLinkBtn.classList.add('copied');
      targetCopyLinkBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Copied!</span>
      `;
      setTimeout(() => {
        targetCopyLinkBtn.classList.remove('copied');
        targetCopyLinkBtn.innerHTML = originalHtml;
      }, 2000);
    });
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch (err) {
    console.error('Copy failed:', err);
    return false;
  }
}

// ---------------- SEARCH LOGIC ----------------

async function performSearch() {
  const url = trackInput.value.trim();
  if (!url) {
    showError('Please enter a Spotify song link or song name.');
    trackInput.focus();
    return;
  }

  hideError();
  resultsSection.classList.add('hidden');
  loadingState.classList.remove('hidden');
  searchBtn.disabled = true;

  // Stop any playing audio
  stopAudio();

  try {
    const res = await fetch('/api/find-albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Unable to scan catalog for this track.');
    }

    displayResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    loadingState.classList.add('hidden');
    searchBtn.disabled = false;
  }
}

function displayResults(data) {
  appState.currentTrack = data.targetTrack;
  appState.albums = data.albums || [];

  // Update target track banner
  const track = data.targetTrack;
  targetTrackName.textContent = track.name;
  targetTrackArtist.textContent = track.artistDisplay || track.artists?.[0] || '';
  targetTrackYear.textContent = track.releaseDate ? `Year: ${track.releaseDate.slice(0, 4)}` : 'Year: Catalog';
  targetTrackImage.src = track.imageUrl || 'https://via.placeholder.com/120?text=Song';
  targetSpotifyLink.href = track.spotifyUrl || '#';

  // Update stats counters
  statTotal.textContent = data.stats.totalAlbums;
  statCompilations.textContent = data.stats.totalCompilations;
  statStudio.textContent = data.stats.totalStudioAlbums;
  statSingles.textContent = data.stats.totalSingles;

  // Update tab badge numbers
  compilationsCountBadge.textContent = data.stats.totalCompilations;
  allCountBadge.textContent = data.stats.totalAlbums;
  albumsCountBadge.textContent = data.stats.totalStudioAlbums;
  singlesCountBadge.textContent = data.stats.totalSingles;

  // Default to 'all' tab so all album editions and compilations are clearly visible
  setFilterTab('all');

  resultsSection.classList.remove('hidden');
  renderAlbums();
}

function setFilterTab(filter) {
  appState.activeFilter = filter;
  tabButtons.forEach((btn) => {
    if (btn.dataset.filter === filter) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function renderAlbums() {
  const filtered = filterAlbums(appState.albums, appState.activeFilter);
  const sorted = sortAlbums(filtered, appState.activeSort);

  albumsGrid.innerHTML = '';

  if (sorted.length === 0) {
    noResultsInFilter.classList.remove('hidden');
    return;
  }
  noResultsInFilter.classList.add('hidden');

  sorted.forEach((album) => {
    const card = document.createElement('div');
    card.className = 'album-card';

    // Badge styling
    let badgeLabel = 'Album';
    let badgeClass = 'badge-album';
    if (album.isCompilation) {
      badgeLabel = 'Compilation';
      badgeClass = 'badge-compilation';
    } else if (album.albumType === 'single') {
      badgeLabel = 'Single / EP';
      badgeClass = 'badge-single';
    }

    const isVarious = (album.artistDisplay || '').toLowerCase().includes('various artists');
    const releaseYear = album.releaseYear || (album.releaseDate ? album.releaseDate.slice(0, 4) : 'Catalog');
    const hasPreview = Boolean(appState.currentTrack?.previewUrl);
    const isPlaying = appState.playingAudioUrl === appState.currentTrack?.previewUrl;

    card.innerHTML = `
      <div class="album-art-wrap">
        <img src="${album.imageUrl || 'https://via.placeholder.com/300?text=No+Cover'}" alt="${escapeHtml(album.name)}" loading="lazy">
        <span class="album-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <h3 class="album-title" title="${escapeHtml(album.name)}">${escapeHtml(album.name)}</h3>
      <p class="album-artist ${isVarious ? 'va' : ''}" title="${escapeHtml(album.artistDisplay)}">${escapeHtml(album.artistDisplay)}</p>
      
      <div class="album-meta-row">
        <span>Year: <strong>${releaseYear}</strong></span>
        <span>${album.totalTracks || 1} tracks</span>
      </div>

      <div class="card-footer">
        <a href="${album.spotifyUrl}" target="_blank" rel="noopener" class="card-link-btn" title="Open in Spotify">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          <span>Open</span>
        </a>
        <button type="button" class="card-copy-btn" data-url="${album.spotifyUrl}" title="Copy Spotify album link">
          <svg class="copy-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span class="copy-label">Copy Link</span>
        </button>
      </div>
    `;

    albumsGrid.appendChild(card);
  });
}

function filterAlbums(albums, filter) {
  if (filter === 'compilations') {
    return albums.filter((a) => a.isCompilation);
  }
  if (filter === 'albums') {
    return albums.filter((a) => !a.isCompilation && a.albumType === 'album');
  }
  if (filter === 'singles') {
    return albums.filter((a) => !a.isCompilation && a.albumType === 'single');
  }
  return albums; // 'all'
}

function sortAlbums(albums, sortType) {
  const copy = [...albums];
  switch (sortType) {
    case 'date-desc':
      return copy.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
    case 'date-asc':
      return copy.sort((a, b) => (a.releaseYear || 0) - (b.releaseYear || 0));
    case 'name-asc':
      return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'tracks-desc':
      return copy.sort((a, b) => (b.totalTracks || 0) - (a.totalTracks || 0));
    default:
      return copy;
  }
}

// ---------------- AUDIO PREVIEW ----------------

function stopAudio() {
  if (appState.currentAudio) {
    appState.currentAudio.pause();
    appState.currentAudio = null;
    appState.playingAudioUrl = null;
  }
}

// ---------------- EXPORT ----------------

function exportToCsv() {
  if (!appState.albums.length) return;

  const headers = ['Album Name', 'Type', 'Is Compilation', 'Artist(s)', 'Release Year', 'Total Tracks', 'Spotify URL'];
  const rows = appState.albums.map((a) => [
    `"${(a.name || '').replace(/"/g, '""')}"`,
    `"${a.albumType || ''}"`,
    a.isCompilation ? 'Yes' : 'No',
    `"${(a.artistDisplay || '').replace(/"/g, '""')}"`,
    `"${a.releaseYear || ''}"`,
    a.totalTracks || '',
    `"${a.spotifyUrl || ''}"`,
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  const safeTitle = (appState.currentTrack?.name || 'song').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  link.setAttribute('download', `${safeTitle}_compilations_and_albums.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------------- UTILS ----------------

function showError(msg) {
  errorMessage.textContent = msg;
  errorAlert.classList.remove('hidden');
}

function hideError() {
  errorAlert.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
