# Spotify Compilation & Album Finder 🎵

A dedicated web application that takes any Spotify song link and reveals **every compilation, soundtrack, box set, and studio album** containing that song across Spotify's entire catalog.

![Spotify Release Finder](public/style.css)

## Key Features

- 🔍 **Multi-Vector Deep Search**:
  - Leverages the track's **ISRC (International Standard Recording Code)** to find all licensed compilation releases across labels (soundtracks, "Now That's What I Call...", curated 80s/90s collections, greatest hits).
  - Performs intelligent title and artist search queries to find alternate pressings and remastered compilation appearances.
- 📂 **Smart Release Classification**:
  - Distinguishes **Compilations & Soundtracks**, **Studio LPs**, and **Singles / EPs**.
  - Highlights "Various Artists" releases and compilation box sets.
- ⚡ **Filter & Sort**:
  - Filter by Compilations Only, Studio Albums, or Singles.
  - Sort by release year (newest/oldest), title, or track count.
- 🎧 **Direct Integration**:
  - Direct 1-click links to open albums or tracks in Spotify.
  - 30-second audio preview playback.
  - Export full compilation listings to CSV.
- 🔑 **Simple Setup**:
  - Built-in credentials wizard in the web UI.

---

## Quick Start

### 1. Start the Server

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your web browser.

### 2. Configure Spotify API (Free, 1 Minute)

To search Spotify's catalog, the app uses Spotify's official Web API (Client Credentials Flow):

1. Visit [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in with any Spotify account (free or premium).
2. Click **Create App**:
   - **App Name**: `AlbumFinder`
   - **Redirect URI**: `http://localhost:3000`
   - **Which API/SDKs**: Check **Web API**
3. Open your app's **Settings** to see your **Client ID** and **Client Secret**.
4. Enter them into the app's top-right settings button or create a `.env` file:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   PORT=3000
   ```

---

## How It Works

1. **Extract Track ID**: Parses URLs (`https://open.spotify.com/track/...`, international links, or `spotify:track:...`).
2. **Retrieve Master Recording Metadata**: Obtains title, primary artist, and the ISRC code from `GET /v1/tracks/{id}`.
3. **ISRC Search**: Queries `GET /v1/search?q=isrc:{ISRC}&type=track`. Because recording rights holders reuse the ISRC when licensing tracks to multi-artist compilations and soundtracks, this reveals releases that title-based searches miss.
4. **Fuzzy Search & Deduplication**: Runs secondary queries for `track:"{title}" artist:"{artist}"` to detect remastered or re-indexed compilation appearances, verifies audio duration & artist match to eliminate false positives, and deduplicates unique albums.
