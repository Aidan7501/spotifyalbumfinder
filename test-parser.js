const assert = require('assert');

// 1. Test URL and Track ID parser
function extractTrackId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/track[/:]([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  const rawMatch = trimmed.match(/^[a-zA-Z0-9]{22}$/);
  if (rawMatch) return rawMatch[0];
  return null;
}

// 2. Test Title Cleaner
function cleanSongTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*-\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|live|mono|stereo|radio edit|original mix|deluxe|bonus track).*$/i, '')
    .replace(/\s*[\(\[](?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s*\d{4})?|live.*?|mono.*?|stereo.*?|radio edit.*?|original mix.*?|deluxe.*?|bonus track.*?|feat\..*?|with.*?)[\)\]]/gi, '')
    .trim();
}

console.log('Running unit checks...');

// Test 1: Standard URL
const url1 = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123xyz';
assert.strictEqual(extractTrackId(url1), '4cOdK2wGLETKBW3PvgPWqT', 'Standard URL failed');

// Test 2: International Spotify URL
const url2 = 'https://open.spotify.com/intl-es/track/2WfaOiMkCvy7Z5vo2vrvUR?si=999';
assert.strictEqual(extractTrackId(url2), '2WfaOiMkCvy7Z5vo2vrvUR', 'International URL failed');

// Test 3: Spotify URI
const uri = 'spotify:track:4u7EnebtmKWzUH433cf5Qv';
assert.strictEqual(extractTrackId(uri), '4u7EnebtmKWzUH433cf5Qv', 'Spotify URI failed');

// Test 4: Raw 22-character ID
const raw = '2grjqo0Frpf25SaISBkumy';
assert.strictEqual(extractTrackId(raw), '2grjqo0Frpf25SaISBkumy', 'Raw ID failed');

// Test 5: Clean titles
assert.strictEqual(cleanSongTitle('Take on Me - 2015 Remaster'), 'Take on Me');
assert.strictEqual(cleanSongTitle('Bohemian Rhapsody (Remastered 2011)'), 'Bohemian Rhapsody');
assert.strictEqual(cleanSongTitle('September (Live at Red Rocks)'), 'September');

console.log('✅ All unit checks passed!');
