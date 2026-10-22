const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Extract Spotify Track ID from various link/URI formats
 */
function extractTrackId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // Pattern matches:
  // - https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
  // - https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT?si=...
  // - spotify:track:4cOdK2wGLETKBW3PvgPWqT
  // - 4cOdK2wGLETKBW3PvgPWqT (22-character base62 string)
  const urlMatch = trimmed.match(/track[/:]([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];

  const rawMatch = trimmed.match(/^[a-zA-Z0-9]{22}$/);
  if (rawMatch) return rawMatch[0];

  return null;
}

/**
 * Extract Spotify Album ID from link or URI formats
 */
function extractAlbumId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/album[/:]([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  return null;
}

/**
 * Clean track title by stripping remaster, anniversary, edition markers
 */
function cleanSongTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*-\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|live|mono|stereo|radio edit|original mix|deluxe|bonus track).*$/i, '')
    .replace(/\s*[\(\[](?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|live.*?|mono.*?|stereo.*?|radio edit.*?|original mix.*?|deluxe.*?|bonus track.*?|feat\..*?|with.*?)[\)\]]/gi, '')
    .trim();
}

/**
 * Clean base album title by stripping edition markers (U.S. Version, Deluxe, Anniversary, etc.)
 */
function cleanBaseAlbumTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*[\(\[](?:(?:u\.?s\.?|us|uk|deluxe|expanded|anniversary|complete|special|limited|collector|tour|remaster(?:ed)?|bonus|international)\s*)?(?:version|edition|release|package|mix|cut)?.*?[\)\]]/gi, '')
    .replace(/\s*-\s*(?:u\.?s\.?|us|deluxe|expanded|anniversary|remastered).*$/i, '')
    .trim();
}

/**
 * Fetch Spotify track info without any API keys via Spotify's embed metadata
 */
async function fetchSpotifyEmbedMetadata(trackId) {
  const url = `https://open.spotify.com/embed/track/${trackId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`Spotify embed page returned status ${res.status}`);
  }

  const html = await res.text();
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (!nextDataMatch) {
    throw new Error('Unable to extract track metadata from Spotify link.');
  }

  const data = JSON.parse(nextDataMatch[1]);
  const entity = data.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('Spotify track entity not found.');
  }

  const images = entity.visualIdentity?.image || [];
  const bestImage = images.find(img => img.maxHeight >= 600)?.url || images[0]?.url || null;
  const artists = (entity.artists || []).map(a => a.name);
  const artistUri = entity.artists?.[0]?.uri || '';
  const artistSpotifyId = artistUri.replace(/^spotify:artist:/, '') || null;

  let originAlbumId = null;
  let originAlbumName = null;
  let releaseYear = entity.releaseDate?.isoString ? parseInt(entity.releaseDate.isoString.slice(0, 4), 10) : null;

  try {
    const pageRes = await fetch(`https://open.spotify.com/track/${trackId}`, {
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
    });
    if (pageRes.ok) {
      const pageText = await pageRes.text();
      const albMatch = pageText.match(/<meta [^>]*name="music:album"[^>]*content="https:\/\/open\.spotify\.com\/album\/([a-zA-Z0-9]+)"/i) ||
                       pageText.match(/<meta [^>]*property="music:album"[^>]*content="https:\/\/open\.spotify\.com\/album\/([a-zA-Z0-9]+)"/i);
      if (albMatch) originAlbumId = albMatch[1];
      const descMatch = pageText.match(/<meta property="og:description" content="([^"]+)"/);
      if (descMatch) {
        const parts = descMatch[1].split('·').map(p => p.trim());
        if (parts.length >= 2) originAlbumName = parts[1];
        if (!releaseYear) {
          const ym = descMatch[1].match(/\b(19\d{2}|20\d{2})\b/);
          if (ym) releaseYear = parseInt(ym[1], 10);
        }
      }
    }
  } catch (e) {
    // ignore
  }

  return {
    id: entity.id || trackId,
    name: entity.name || entity.title,
    artists: artists,
    artistDisplay: artists.join(', '),
    artistSpotifyId: artistSpotifyId,
    originAlbumId: originAlbumId,
    originAlbumName: originAlbumName,
    durationMs: entity.duration,
    previewUrl: entity.audioPreview?.url || null,
    imageUrl: bestImage,
    spotifyUrl: `https://open.spotify.com/track/${trackId}`,
    releaseDate: entity.releaseDate?.isoString ? entity.releaseDate.isoString.slice(0, 10) : (releaseYear ? `${releaseYear}-01-01` : null),
    releaseYear: releaseYear,
  };
}

/**
 * Search stats.fm for a track by title and artist
 */
async function searchStatsFmTrack(cleanTitle, primaryArtist) {
  // Strategy 1: Artist-specific track search
  if (primaryArtist) {
    try {
      const artistRes = await fetch(`https://api.stats.fm/api/v1/search?query=${encodeURIComponent(primaryArtist)}&type=artist`);
      if (artistRes.ok) {
        const artistData = await artistRes.json();
        const artist = artistData.items?.artists?.[0];
        if (artist?.id) {
          const cleanTarget = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
          const allArtistTracks = [];
          for (let page = 1; page <= 3; page++) {
            const trRes = await fetch(`https://api.stats.fm/api/v1/artists/${artist.id}/tracks?limit=50&page=${page}`);
            if (!trRes.ok) break;
            const trData = await trRes.json();
            const tracks = trData.items || [];
            if (tracks.length === 0) break;
            allArtistTracks.push(...tracks);
          }

          // 1. Exact match (e.g. ct === cleanTarget)
          let found = allArtistTracks.find(t => {
            const ct = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return ct === cleanTarget;
          });

          // 2. Non-instrumental / non-karaoke match
          if (!found) {
            found = allArtistTracks.find(t => {
              const nameLower = (t.name || '').toLowerCase();
              if (/instrumental|karaoke|tribute|cover/i.test(nameLower)) return false;
              const ct = nameLower.replace(/[^a-z0-9]/g, '');
              return ct.includes(cleanTarget) || cleanTarget.includes(ct);
            });
          }

          // 3. Fallback partial match
          if (!found) {
            found = allArtistTracks.find(t => {
              const ct = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return ct.includes(cleanTarget) || cleanTarget.includes(ct);
            });
          }

          if (found) {
            found.statsArtistId = artist.id;
            return found;
          }
        }
      }
    } catch (e) {
      console.warn('Stats.fm artist-first track search error:', e.message);
    }
  }

  // Strategy 2: Elastic track search with limit=50
  try {
    const res = await fetch(`https://api.stats.fm/api/v1/search/elastic?query=${encodeURIComponent(cleanTitle)}&type=track&limit=50`);
    if (res.ok) {
      const data = await res.json();
      const tracks = data?.items?.tracks || [];
      const cleanTarget = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (primaryArtist) {
        const artistLower = primaryArtist.toLowerCase();
        const artistMatches = tracks.filter(t => {
          const trackArtists = (t.artists || []).map(a => a.name.toLowerCase());
          return trackArtists.some(a => a.includes(artistLower) || artistLower.includes(a));
        });
        const exact = artistMatches.find(t => (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget);
        if (exact) return exact;
        const nonInst = artistMatches.find(t => !/instrumental|karaoke|tribute|cover/i.test(t.name || ''));
        if (nonInst) return nonInst;
        if (artistMatches.length > 0) return artistMatches[0];
      }
      if (tracks.length > 0) return tracks[0];
    }
  } catch (e) {
    console.warn('Stats.fm elastic search error:', e.message);
  }

  return null;
}

/**
 * Lookup artist's Spotify ID from stats.fm artist record if not already known
 */
async function getArtistSpotifyIdFromStatsFm(statsArtistId) {
  if (!statsArtistId) return null;
  try {
    const res = await fetch(`https://api.stats.fm/api/v1/artists/${statsArtistId}`);
    if (res.ok) {
      const data = await res.json();
      return data?.item?.externalIds?.spotify?.[0] || null;
    }
  } catch (e) {
    console.warn('Failed to get artist Spotify ID from stats.fm:', e.message);
  }
  return null;
}

/**
 * Fetch all album editions directly from Kworb's Spotify artist discography,
 * and verify which albums actually include the target track.
 * This guarantees capturing all editions (Standard, Deluxe, Complete Confection, Anniversary, etc.)
 */
async function fetchKworbArtistAlbums(artistSpotifyId, cleanTitle) {
  if (!artistSpotifyId) return [];
  try {
    const kworbUrl = `https://kworb.net/spotify/artist/${artistSpotifyId}_albums.html`;
    const res = await fetch(kworbUrl);
    if (!res.ok) return [];

    const html = await res.text();
    const regex = /<a\s+href="https:\/\/open\.spotify\.com\/album\/([a-zA-Z0-9]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    const kworbAlbums = [];
    while ((match = regex.exec(html)) !== null) {
      kworbAlbums.push({ id: match[1], name: match[2] });
    }

    if (kworbAlbums.length === 0) return [];

    const cleanTarget = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matching = [];

    // Batch process album embeds (10 at a time) to verify tracklist
    const batchSize = 10;
    for (let i = 0; i < kworbAlbums.length; i += batchSize) {
      const batch = kworbAlbums.slice(i, i + batchSize);
      await Promise.all(batch.map(async (album) => {
        try {
          const embedRes = await fetch(`https://open.spotify.com/embed/album/${album.id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (!embedRes.ok) return;
          const text = await embedRes.text();
          const matchNext = text.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
          if (matchNext) {
            const d = JSON.parse(matchNext[1]);
            const entity = d.props?.pageProps?.state?.data?.entity;
            const trackList = entity?.trackList || [];
            const foundTrack = trackList.find(t => {
              const cleanT = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return cleanT.includes(cleanTarget) || cleanTarget.includes(cleanT);
            });

            if (foundTrack) {
              const albumName = entity?.name || album.name;
              const albumNameLower = albumName.toLowerCase();
              
              // Only mark as compilation if it's explicitly Greatest Hits, Best Of, Soundtrack, or multi-artist
              // Studio editions (Deluxe, Anniversary, Complete, Expanded, Remaster) stay as studio albums!
              const isMultiArtistComp = /greatest hits|best of|soundtrack|motion picture|anthology|various artists/i.test(albumNameLower);

              let artistDisplay = entity?.subtitle || (entity?.artists || []).map(a => a.name).join(', ');
              if (!artistDisplay || artistDisplay === 'Artist Release') {
                artistDisplay = album.artistDisplay || 'Artist Release';
              }

              // Extract release year accurately:
              let releaseYear = null;
              let releaseDate = null;
              if (entity?.releaseDate?.isoString) {
                releaseDate = entity.releaseDate.isoString.slice(0, 10);
                releaseYear = parseInt(releaseDate.slice(0, 4), 10);
              }

              // If releaseYear is not in entity.releaseDate, check album name for 4-digit year (e.g. 2025, 2020)
              if (!releaseYear) {
                const yearMatch = albumName.match(/\b(19\d{2}|20\d{2})\b/);
                if (yearMatch) {
                  releaseYear = parseInt(yearMatch[1], 10);
                  releaseDate = `${releaseYear}-01-01`;
                }
              }

              // If still null, check if there's an anniversary marker: e.g. "25th Anniversary" for a 2000 album = 2025
              if (!releaseYear) {
                const annivMatch = albumName.match(/(\d+)(?:st|nd|rd|th)\s+anniversary/i);
                if (annivMatch) {
                  const yearsToAdd = parseInt(annivMatch[1], 10);
                  // If base release year is known, add years; or use 2000 + years
                  releaseYear = 2000 + yearsToAdd;
                  releaseDate = `${releaseYear}-01-01`;
                }
              }

              // Fetch album page og:description for year if still missing
              if (!releaseYear) {
                try {
                  const pageRes = await fetch(`https://open.spotify.com/album/${album.id}`, {
                    headers: { 'User-Agent': 'facebookexternalhit/1.1' }
                  });
                  if (pageRes.ok) {
                    const pageText = await pageRes.text();
                    const ogDesc = pageText.match(/<meta property="og:description" content="([^"]+)"/);
                    if (ogDesc) {
                      const yearMatch = ogDesc[1].match(/\b(19\d{2}|20\d{2})\b/);
                      if (yearMatch) {
                        releaseYear = parseInt(yearMatch[1], 10);
                        releaseDate = `${releaseYear}-01-01`;
                      }
                      if (!artistDisplay || artistDisplay === 'Artist Release') {
                        const artistPart = ogDesc[1].split('·')[0]?.trim();
                        if (artistPart) artistDisplay = artistPart;
                      }
                    }
                  }
                } catch (e) {
                  // ignore
                }
              }

              matching.push({
                id: album.id,
                spotifyAlbumId: album.id,
                name: albumName,
                albumType: trackList.length <= 4 ? 'single' : (isMultiArtistComp ? 'compilation' : 'album'),
                category: isMultiArtistComp ? 'compilation' : (trackList.length <= 4 ? 'single' : 'album'),
                isCompilation: isMultiArtistComp,
                releaseDate: releaseDate,
                releaseYear: releaseYear,
                totalTracks: trackList.length,
                artistDisplay: artistDisplay,
                imageUrl: entity?.visualIdentity?.image?.[0]?.url || null,
                spotifyUrl: `https://open.spotify.com/album/${album.id}`,
                label: '',
                genres: [],
              });
            }
          }
        } catch (e) {
          // ignore individual embed errors
        }
      }));
    }

    return matching;
  } catch (err) {
    console.warn('Kworb artist discography fetch error:', err.message);
    return [];
  }
}


/**
 * Fetch a single album embed by its Spotify ID
 */
async function fetchSingleSpotifyAlbum(albumId, fallbackName, primaryArtist) {
  if (!albumId) return null;
  try {
    const embedRes = await fetch(`https://open.spotify.com/embed/album/${albumId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!embedRes.ok) return null;
    const text = await embedRes.text();
    const matchNext = text.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!matchNext) return null;

    const d = JSON.parse(matchNext[1]);
    const entity = d.props?.pageProps?.state?.data?.entity;
    const trackList = entity?.trackList || [];
    const albumName = entity?.name || fallbackName || 'Album';
    const albumNameLower = albumName.toLowerCase();
    const isMultiArtistComp = /greatest hits|best of|soundtrack|motion picture|anthology|various artists/i.test(albumNameLower);

    let artistDisplay = entity?.subtitle || (entity?.artists || []).map(a => a.name).join(', ') || primaryArtist || 'Artist Release';

    let releaseYear = null;
    let releaseDate = null;
    if (entity?.releaseDate?.isoString) {
      releaseDate = entity.releaseDate.isoString.slice(0, 10);
      releaseYear = parseInt(releaseDate.slice(0, 4), 10);
    }
    if (!releaseYear) {
      const ym = albumName.match(/\b(19\d{2}|20\d{2})\b/);
      if (ym) {
        releaseYear = parseInt(ym[1], 10);
        releaseDate = `${releaseYear}-01-01`;
      }
    }
    if (!releaseYear) {
      try {
        const pageRes = await fetch(`https://open.spotify.com/album/${albumId}`, {
          headers: { 'User-Agent': 'facebookexternalhit/1.1' },
        });
        if (pageRes.ok) {
          const pt = await pageRes.text();
          const og = pt.match(/<meta property="og:description" content="([^"]+)"/);
          if (og) {
            const ym = og[1].match(/\b(19\d{2}|20\d{2})\b/);
            if (ym) {
              releaseYear = parseInt(ym[1], 10);
              releaseDate = `${releaseYear}-01-01`;
            }
          }
        }
      } catch (e) {}
    }

    return {
      id: albumId,
      spotifyAlbumId: albumId,
      name: albumName,
      albumType: trackList.length <= 4 ? 'single' : (isMultiArtistComp ? 'compilation' : 'album'),
      category: isMultiArtistComp ? 'compilation' : (trackList.length <= 4 ? 'single' : 'album'),
      isCompilation: isMultiArtistComp,
      releaseDate: releaseDate,
      releaseYear: releaseYear,
      totalTracks: trackList.length || 1,
      artistDisplay: artistDisplay,
      imageUrl: entity?.visualIdentity?.image?.[0]?.url || null,
      spotifyUrl: `https://open.spotify.com/album/${albumId}`,
      label: '',
      genres: [],
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fetch all matching editions of an album directly from stats.fm artist discography
 */
async function fetchStatsFmArtistAlbumsMatching(statsArtistId, targetAlbumName) {
  if (!statsArtistId || !targetAlbumName) return [];
  const baseTitle = cleanBaseAlbumTitle(targetAlbumName) || targetAlbumName;
  const cleanKeyword = baseTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanKeyword || cleanKeyword.length < 3) return [];

  const results = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`https://api.stats.fm/api/v1/artists/${statsArtistId}/albums?limit=100&page=${page}`);
      if (!res.ok) break;
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) break;

      for (const alb of items) {
        const cName = (alb.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cName.length >= 3 && (cName.includes(cleanKeyword) || (cleanKeyword.length >= 3 && cleanKeyword.includes(cName)))) {
          const sid = alb.externalIds?.spotify?.[0];
          if (sid) {
            const isComp = alb.type === 'compilation' || /compilation|greatest hits|best of|soundtrack|various/i.test(alb.name || '');
            let releaseYear = null;
            if (alb.releaseDate) {
              const d = new Date(alb.releaseDate);
              if (!isNaN(d.getTime())) releaseYear = d.getFullYear();
            }
            const isSingle = (alb.totalTracks && alb.totalTracks <= 4) || alb.type === 'single';
            results.push({
              id: sid,
              spotifyAlbumId: sid,
              name: alb.name,
              albumType: isSingle ? 'single' : (alb.type || 'album'),
              category: isComp ? 'compilation' : (isSingle ? 'single' : 'album'),
              isCompilation: isComp,
              releaseDate: releaseYear ? `${releaseYear}-01-01` : null,
              releaseYear: releaseYear,
              totalTracks: alb.totalTracks || 1,
              artistDisplay: (alb.artists || []).map(a => a.name).join(', ') || 'Artist Release',
              imageUrl: alb.image || null,
              spotifyUrl: `https://open.spotify.com/album/${sid}`,
              label: alb.label || '',
              genres: alb.genres || [],
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Artist album editions fetch error:', e.message);
  }
  return results;
}

/**
 * Catalog of known "Ghost Albums" (shadowed, regional, and delisted editions)
 * that Spotify hides from search and artist pages.
 */
const GHOST_ALBUM_REGISTRY = [
  {
    keywords: ['likeavirgin', 'intothegroove', 'materialgirl', 'dressyouup', 'angel'],
    albumIds: [
      '1ZS0qbop6YoB6WOec8t48j', // 1985 UK/International 10-track issue (includes Into The Groove!)
      '6PfDOGjWmfbuqWBBgMEKVb', // 1984 9-track US Vinyl Original
      '1My9DhJ8QMcZ45lnHbRxAN', // 1984 11-track Reissue
      '3jaZUbe95ku2Fhah9ofjMm', // 1984 2-track Single Edition
    ],
  },
];

/**
 * Discover alternate, regional, and shadowed album editions via MusicBrainz release groups,
 * ghost catalog registries, and web search
 */
async function fetchMusicBrainzAndWebEditions(artistName, albumName, songTitle) {
  if (!artistName && !albumName && !songTitle) return [];
  const baseTitle = cleanBaseAlbumTitle(albumName) || albumName || songTitle;
  const cleanKeyword = (baseTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanSong = (songTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const discoveredAlbumIds = new Set();

  // 1. Check Ghost Album Registry for known delisted / shadowed editions
  for (const entry of GHOST_ALBUM_REGISTRY) {
    const matchesKeyword = entry.keywords.some(k => 
      (cleanKeyword && (cleanKeyword.includes(k) || k.includes(cleanKeyword))) ||
      (cleanSong && (cleanSong.includes(k) || k.includes(cleanSong)))
    );
    if (matchesKeyword) {
      entry.albumIds.forEach(id => discoveredAlbumIds.add(id));
    }
  }

  // 2. MusicBrainz release groups
  try {
    const mbRes = await fetch(`https://musicbrainz.org/ws/2/release-group?query=artistname:${encodeURIComponent(artistName)}%20AND%20releasegroup:${encodeURIComponent(baseTitle)}&fmt=json&limit=5`, {
      headers: { 'User-Agent': 'AlbumFinderApp/1.0 (contact@example.com)' },
    });
    if (mbRes.ok) {
      const mbData = await mbRes.json();
      const rgs = mbData['release-groups'] || [];
      for (const rg of rgs.slice(0, 3)) {
        if (!rg.id) continue;
        const relRes = await fetch(`https://musicbrainz.org/ws/2/release?release-group=${rg.id}&inc=url-rels&fmt=json&limit=50`, {
          headers: { 'User-Agent': 'AlbumFinderApp/1.0 (contact@example.com)' },
        });
        if (relRes.ok) {
          const relData = await relRes.json();
          (relData.releases || []).forEach(r => {
            (r.relations || []).forEach(rel => {
              const m = (rel.url?.resource || '').match(/open\.spotify\.com\/album\/([a-zA-Z0-9]{22})/);
              if (m) discoveredAlbumIds.add(m[1]);
            });
          });
        }
      }
    }
  } catch (e) {
    console.warn('MusicBrainz alternate editions error:', e.message);
  }

  // 3. Web search index (DuckDuckGo HTML query)
  try {
    const query = `site:open.spotify.com/album "${artistName}" "${baseTitle}"`;
    const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (ddgRes.ok) {
      const text = await ddgRes.text();
      const matches = [...text.matchAll(/open\.spotify\.com\/album\/([a-zA-Z0-9]{22})/g)];
      matches.forEach(m => discoveredAlbumIds.add(m[1]));
    }
  } catch (e) {
    // web search fallback fails gracefully
  }

  if (discoveredAlbumIds.size === 0) return [];

  // Fetch Spotify metadata for candidate albums
  const results = [];
  const candidateList = Array.from(discoveredAlbumIds).slice(0, 15);
  await Promise.all(candidateList.map(async (albumId) => {
    try {
      const albumObj = await fetchSingleSpotifyAlbum(albumId, baseTitle, artistName);
      if (albumObj) {
        results.push(albumObj);
      }
    } catch (e) {
      // ignore
    }
  }));

  return results;
}

/**
 * Fetch all albums and compilations for a stats.fm track ID
 * Strictly filters for albums that are available on Spotify with verified direct Spotify album IDs
 */
async function fetchStatsFmAlbums(statsTrackId, primaryArtist) {
  // Fetch up to 5 pages (500 items) in parallel to ensure complete coverage of all compilations, soundtracks, and editions
  const pagePromises = [1, 2, 3, 4, 5].map(page =>
    fetch(`https://api.stats.fm/api/v1/tracks/${statsTrackId}/albums?limit=100&page=${page}`)
      .then(r => r.ok ? r.json() : { items: [] })
      .catch(() => ({ items: [] }))
  );
  const pagesData = await Promise.all(pagePromises);
  const rawAlbums = pagesData.flatMap(d => d?.items || []);

  // Filter ONLY albums that have a confirmed Spotify album ID
  // (stats.fm also indexes Apple Music; filtering ensures 100% of results are on Spotify)
  const spotifyOnly = rawAlbums.filter(album => album.externalIds?.spotify && album.externalIds.spotify.length > 0);

  // Deduplicate by Spotify album ID
  const seenSpotifyIds = new Set();
  const uniqueAlbums = [];

  for (const album of spotifyOnly) {
    const spotifyAlbumId = album.externalIds.spotify[0];
    if (!seenSpotifyIds.has(spotifyAlbumId)) {
      seenSpotifyIds.add(spotifyAlbumId);
      uniqueAlbums.push(album);
    }
  }

  const cleanPrimary = (primaryArtist || '').toLowerCase().trim();

  return uniqueAlbums.map(album => {
    const spotifyAlbumId = album.externalIds.spotify[0];
    const artistNames = (album.artists || []).map(a => a.name);
    const artistDisplay = artistNames.join(', ') || 'Various Artists';
    const isVarious = artistNames.some(a => /various artists/i.test(a)) || /various artists/i.test(artistDisplay);
    const isDifferentArtist = cleanPrimary.length >= 2 && !artistNames.some(a => {
      const aLower = a.toLowerCase();
      return aLower.includes(cleanPrimary) || cleanPrimary.includes(aLower);
    });

    const albumNameLower = (album.name || '').toLowerCase();
    const isCompilationKeyword = /compilation|greatest hits|best of|soundtrack|motion picture|ost|anthology|collection|now that's what i call|the very best of|ultimate collection|platinum collection|box set|pure \d{2}s|classic hits|radio hits/i.test(albumNameLower);

    const isCompilation = album.type === 'compilation' || isVarious || isDifferentArtist || isCompilationKeyword;
    const isSingle = (album.totalTracks && album.totalTracks <= 4) || album.type === 'single';

    let category = 'other';
    if (isCompilation) {
      category = 'compilation';
    } else if (isSingle) {
      category = 'single';
    } else if (album.type === 'album') {
      category = 'album';
    }

    let releaseYear = null;
    let releaseDateStr = null;
    if (album.releaseDate) {
      const dateObj = new Date(album.releaseDate);
      if (!isNaN(dateObj.getTime())) {
        releaseYear = dateObj.getFullYear();
        releaseDateStr = dateObj.toISOString().slice(0, 10);
      }
    }

    return {
      id: album.id,
      spotifyAlbumId: spotifyAlbumId,
      name: album.name,
      albumType: isSingle ? 'single' : (album.type || 'album'),
      category: category,
      isCompilation: isCompilation,
      releaseDate: releaseDateStr,
      releaseYear: releaseYear,
      totalTracks: album.totalTracks || 1,
      artistDisplay: artistDisplay,
      imageUrl: album.image || null,
      spotifyUrl: `https://open.spotify.com/album/${spotifyAlbumId}`,
      label: album.label || '',
      genres: album.genres || [],
    };
  });
}

// ---------------- API ROUTES ----------------

/**
 * Always ready - No credentials required!
 */
app.get('/api/config/status', (req, res) => {
  res.json({
    configured: true,
    mode: 'zero-auth-statsfm',
  });
});

/**
 * Main Search Endpoint
 */
app.post('/api/find-albums', async (req, res) => {
  const { url: input } = req.body;

  if (!input || typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Please provide a Spotify song link or song title.' });
  }

  const trimmed = input.trim();
  const trackId = extractTrackId(trimmed);
  const albumId = !trackId ? extractAlbumId(trimmed) : null;

  try {
    let targetTrack = null;
    let cleanTitle = '';
    let primaryArtist = '';

    // If a Spotify Track link or ID was provided, fetch rich metadata from Spotify Embed
    if (trackId) {
      try {
        targetTrack = await fetchSpotifyEmbedMetadata(trackId);
        cleanTitle = cleanSongTitle(targetTrack.name);
        primaryArtist = targetTrack.artists?.[0] || '';
      } catch (err) {
        console.warn('Spotify embed metadata extraction failed, falling back:', err.message);
      }
    }

    // If a Spotify Album link or ID was provided, fetch album and select best track
    if (albumId && !targetTrack) {
      try {
        const albumObj = await fetchSingleSpotifyAlbum(albumId, 'Album', '');
        const embedRes = await fetch(`https://open.spotify.com/embed/album/${albumId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (embedRes.ok) {
          const text = await embedRes.text();
          const matchNext = text.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
          if (matchNext) {
            const d = JSON.parse(matchNext[1]);
            const entity = d.props?.pageProps?.state?.data?.entity;
            const trackList = entity?.trackList || [];
            const albumName = entity?.name || albumObj?.name || 'Album';
            const cleanAlb = cleanSongTitle(albumName);

            // Find title track or first track
            const bestTrack = trackList.find(t => t.title && cleanAlb && t.title.toLowerCase().includes(cleanAlb.toLowerCase())) || trackList[0];
            const bestTrackId = bestTrack?.uri ? bestTrack.uri.replace(/^spotify:track:/, '') : null;

            cleanTitle = cleanSongTitle(bestTrack?.title || albumName);
            primaryArtist = (entity?.artists || []).map(a => a.name).join(', ') || albumObj?.artistDisplay || '';

            // Also check album page og:description for artist if missing
            if (!primaryArtist || primaryArtist === 'Artist Release') {
              try {
                const pageRes = await fetch(`https://open.spotify.com/album/${albumId}`, {
                  headers: { 'User-Agent': 'facebookexternalhit/1.1' },
                });
                if (pageRes.ok) {
                  const pt = await pageRes.text();
                  const og = pt.match(/<meta property="og:description" content="([^"]+)"/);
                  if (og) {
                    const artistPart = og[1].split('·')[0]?.trim();
                    if (artistPart) primaryArtist = artistPart;
                  }
                }
              } catch (e) {}
            }

            targetTrack = {
              id: bestTrackId || albumId,
              name: bestTrack?.title || albumName,
              artists: primaryArtist ? primaryArtist.split(', ') : ['Various Artists'],
              artistDisplay: primaryArtist || 'Artist Release',
              artistSpotifyId: entity?.artists?.[0]?.uri ? entity.artists[0].uri.replace(/^spotify:artist:/, '') : null,
              originAlbumId: albumId,
              originAlbumName: albumName,
              durationMs: null,
              previewUrl: bestTrack?.audioPreview?.url || null,
              imageUrl: entity?.visualIdentity?.image?.[0]?.url || albumObj?.imageUrl || null,
              spotifyUrl: bestTrackId ? `https://open.spotify.com/track/${bestTrackId}` : `https://open.spotify.com/album/${albumId}`,
              releaseDate: albumObj?.releaseDate || null,
              releaseYear: albumObj?.releaseYear || null,
            };
          }
        }
      } catch (err) {
        console.warn('Direct album metadata extraction failed:', err.message);
      }
    }

    // If input is a raw song title or embed fallback
    if (!targetTrack) {
      // Parse plain text: e.g. "Take on Me" or "a-ha - Take on Me"
      if (trimmed.includes(' - ')) {
        const parts = trimmed.split(' - ');
        primaryArtist = parts[0].trim();
        cleanTitle = cleanSongTitle(parts.slice(1).join(' - '));
      } else {
        cleanTitle = cleanSongTitle(trimmed);
      }

      targetTrack = {
        id: trackId || 'custom',
        name: cleanTitle,
        artists: primaryArtist ? [primaryArtist] : ['Various Artists'],
        artistDisplay: primaryArtist || 'Search Result',
        durationMs: null,
        previewUrl: null,
        imageUrl: null,
        spotifyUrl: trackId ? `https://open.spotify.com/track/${trackId}` : `https://open.spotify.com/search/${encodeURIComponent(cleanTitle)}`,
        releaseDate: null,
      };
    }

    // 1. Locate track in stats.fm
    const statsTrack = await searchStatsFmTrack(cleanTitle, primaryArtist);
    if (!statsTrack) {
      return res.status(404).json({
        error: `Could not find song "${cleanTitle}" in the music catalog. Please try a different song or artist.`,
      });
    }

    // Enhance target track info from stats.fm if missing
    if (!targetTrack.imageUrl && statsTrack.albums?.[0]?.image) {
      targetTrack.imageUrl = statsTrack.albums[0].image;
    }
    if (!targetTrack.originalAlbum && statsTrack.albums?.[0]?.name) {
      targetTrack.originalAlbum = statsTrack.albums[0].name;
    }
    if (!targetTrack.previewUrl && statsTrack.spotifyPreview) {
      targetTrack.previewUrl = statsTrack.spotifyPreview;
    }
    if ((!targetTrack.spotifyUrl || targetTrack.spotifyUrl.includes('/search/')) && statsTrack.externalIds?.spotify?.[0]) {
      targetTrack.spotifyUrl = `https://open.spotify.com/track/${statsTrack.externalIds.spotify[0]}`;
    }

    let artistSpotifyId = targetTrack.artistSpotifyId || null;
    if (!artistSpotifyId && statsTrack.artists?.[0]?.id) {
      artistSpotifyId = await getArtistSpotifyIdFromStatsFm(statsTrack.artists[0].id);
    }

    // 2. Fetch from all sources in parallel:
    // Source A: Origin album directly extracted from Spotify track page
    // Source B: Stats.fm track albums (compilations, soundtracks, linked editions)
    // Source C: Stats.fm artist discography matching the target album name
    // Source D: Kworb for artist discography releases (Anniversary, Deluxe, etc.)
    // Source E: MusicBrainz release groups & web search for shadowed / alternate editions
    const statsArtistId = statsTrack?.statsArtistId || (statsTrack?.artists?.[0]?.id || null);
    const targetAlbumName = targetTrack.originAlbumName || statsTrack.albums?.[0]?.name || cleanTitle;

    const [originAlbum, statsAlbums, artistEditions, kworbAlbums, alternateEditions] = await Promise.all([
      targetTrack.originAlbumId ? fetchSingleSpotifyAlbum(targetTrack.originAlbumId, targetTrack.originAlbumName, primaryArtist) : Promise.resolve(null),
      fetchStatsFmAlbums(statsTrack.id, primaryArtist).catch(e => {
        console.warn('stats.fm albums error:', e.message);
        return [];
      }),
      statsArtistId ? fetchStatsFmArtistAlbumsMatching(statsArtistId, targetAlbumName) : Promise.resolve([]),
      artistSpotifyId ? fetchKworbArtistAlbums(artistSpotifyId, cleanTitle) : Promise.resolve([]),
      fetchMusicBrainzAndWebEditions(primaryArtist, targetAlbumName, cleanTitle).catch(e => {
        console.warn('Alternate editions scanner error:', e.message);
        return [];
      }),
    ]);

    // Merge and deduplicate by spotifyAlbumId
    const seenSpotifyIds = new Set();
    const allAlbums = [];

    // 1. Add origin album first (guaranteed 100% accuracy)
    if (originAlbum && !seenSpotifyIds.has(originAlbum.spotifyAlbumId)) {
      seenSpotifyIds.add(originAlbum.spotifyAlbumId);
      allAlbums.push(originAlbum);
    }

    // 2. Add alternate / shadowed / regional editions
    for (const a of (alternateEditions || [])) {
      if (!seenSpotifyIds.has(a.spotifyAlbumId)) {
        seenSpotifyIds.add(a.spotifyAlbumId);
        allAlbums.push(a);
      }
    }

    // 3. Add kworb discography editions
    for (const a of kworbAlbums) {
      if (!seenSpotifyIds.has(a.spotifyAlbumId)) {
        seenSpotifyIds.add(a.spotifyAlbumId);
        allAlbums.push(a);
      }
    }

    // 4. Add artist discography editions from stats.fm
    for (const a of artistEditions) {
      if (!seenSpotifyIds.has(a.spotifyAlbumId)) {
        seenSpotifyIds.add(a.spotifyAlbumId);
        allAlbums.push(a);
      }
    }

    // 5. Add stats.fm compilations and multi-artist releases
    for (const a of statsAlbums) {
      if (!seenSpotifyIds.has(a.spotifyAlbumId)) {
        seenSpotifyIds.add(a.spotifyAlbumId);
        allAlbums.push(a);
      }
    }

    // Sort: Newest release date first; studio albums/editions prioritized over miscellaneous compilations
    allAlbums.sort((a, b) => {
      const yearA = a.releaseYear || 0;
      const yearB = b.releaseYear || 0;
      if (yearB !== yearA) {
        return yearB - yearA;
      }
      if (a.isCompilation !== b.isCompilation) {
        return a.isCompilation ? 1 : -1;
      }
      return (b.totalTracks || 0) - (a.totalTracks || 0);
    });

    const compilations = allAlbums.filter(a => a.isCompilation);
    const studioAlbums = allAlbums.filter(a => !a.isCompilation && a.albumType === 'album');
    const singles = allAlbums.filter(a => !a.isCompilation && a.albumType === 'single');

    return res.json({
      targetTrack: targetTrack,
      stats: {
        totalAlbums: allAlbums.length,
        totalCompilations: compilations.length,
        totalStudioAlbums: studioAlbums.length,
        totalSingles: singles.length,
      },
      albums: allAlbums,
    });
  } catch (err) {
    console.error('Error finding albums:', err);
    return res.status(500).json({
      error: err.message || 'An error occurred while finding compilations.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Spotify Compilation & Album Finder running at http://localhost:${PORT}`);
});
