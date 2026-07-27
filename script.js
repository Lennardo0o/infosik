let currentRelease = null;
const selectedSongs = [];
const API_BASE_URL = 'http://127.0.0.1:8002';

function parseProxyResponse(rawText) {
    if (!rawText) return null;

    const cleaned = String(rawText)
        .replace(/^\s*Title:\s*.*?\n\n/i, '')
        .replace(/^\s*URL Source:\s*.*?\n\n/i, '')
        .replace(/^\s*Published Time:\s*.*?\n\n/i, '')
        .replace(/^\s*Markdown Content:\s*/i, '')
        .trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonCandidate = firstBrace >= 0 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;

    try {
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && parsed.data && typeof parsed.data.content === 'string') {
            return parseProxyResponse(parsed.data.content);
        }
        return parsed;
    } catch (error) {
        console.error('Proxy-Antwort konnte nicht geparst werden:', error);
        return null;
    }
}

function init() {
    document.getElementById('addSelectionButton').addEventListener('click', () => {
        if (currentRelease) {
            addSelectedRelease(currentRelease);
        }
    });

    document.getElementById('downloadCurrentButton').addEventListener('click', async () => {
        if (currentRelease) {
            const lyrics = document.getElementById('lyricsContent').textContent;
            await downloadReleasePackage(currentRelease, lyrics);
        }
    });

    document.getElementById('downloadAllButton').addEventListener('click', async () => {
        if (!selectedSongs.length) return;
        await downloadSelectedBundle(selectedSongs);
    });

    document.getElementById('downloadSongButton').addEventListener('click', async () => {
        const url = document.getElementById('audioUrlInput').value.trim();
        if (!url) {
            alert('Bitte gib einen direkten Audio-Link ein.');
            return;
        }
        await downloadSongFromUrl(url);
    });

    document.getElementById('searchAudioButton').addEventListener('click', async () => {
        const query = document.getElementById('audioSearchInput').value.trim() || (currentRelease ? `${getArtistName(currentRelease)} ${currentRelease.title || ''}`.trim() : '');
        if (!query) {
            alert('Bitte gib einen Suchbegriff für die Musik-Suche ein.');
            return;
        }
        await searchAndDownloadAudio(query);
    });
}

async function searchRelease() {
    const query = document.getElementById('searchInput').value.trim();
    const resultsList = document.getElementById('resultsList');
    const infoCard = document.getElementById('infoCard');

    if (!query) return;

    resultsList.innerHTML = '<li>Lade Ergebnisse...</li>';
    infoCard.style.display = 'none';

    try {
        const response = await fetch(`https://r.jina.ai/http://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json`);
        const rawText = await response.text();
        const payload = parseProxyResponse(rawText);
        const releases = payload && Array.isArray(payload.releases) ? payload.releases : [];

        resultsList.innerHTML = '';

        if (!releases.length) {
            resultsList.innerHTML = '<li>Keine Ergebnisse gefunden.</li>';
            return;
        }

        releases.slice(0, 6).forEach(release => {
            const li = document.createElement('li');
            li.className = 'result-item';
            const artist = release['artist-credit'] && release['artist-credit'][0] ? release['artist-credit'][0].name : (release.artist || 'Unbekannt');
            const coverUrl = getCoverArtUrl(release);

            const cover = document.createElement('img');
            cover.className = 'result-cover';
            cover.alt = `${release.title} cover`;
            cover.src = coverUrl || createCoverPlaceholder();
            cover.onerror = () => {
                cover.src = createCoverPlaceholder();
            };

            const content = document.createElement('div');
            content.className = 'result-content';
            content.innerHTML = `
                <span class="result-title">${release.title}</span>
                <span class="result-meta">${artist}</span>
                <span class="result-meta">${release.date || 'Datum unbekannt'}</span>
            `;

            li.appendChild(cover);
            li.appendChild(content);
            li.onclick = () => showDetails(release);
            resultsList.appendChild(li);
        });
    } catch (error) {
        console.error(error);
        resultsList.innerHTML = '<li>Fehler bei der Suche.</li>';
    }
}

function createCoverPlaceholder() {
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
            <rect width="120" height="120" rx="24" fill="#1e293b"/>
            <circle cx="60" cy="50" r="24" fill="#475569"/>
            <path d="M34 98c8-22 44-22 52 0" fill="#64748b"/>
        </svg>
    `);
}

function getCoverArtUrl(release) {
    if (!release) return '';
    if (release.id) {
        return `https://coverartarchive.org/release/${release.id}/front-250`;
    }
    if (release['release-group'] && release['release-group'].id) {
        return `https://coverartarchive.org/release-group/${release['release-group'].id}/front-250`;
    }
    return '';
}

function getArtistName(release) {
    if (release['artist-credit'] && release['artist-credit'][0]) {
        return release['artist-credit'][0].name;
    }
    return release.artist || 'Unbekannt';
}

function buildSearchQuery(release) {
    const title = (release.title || '').trim();
    const artist = getArtistName(release).trim();
    const parts = [artist, title].filter(Boolean);
    return encodeURIComponent(parts.join(' '));
}

function getMusicLinks(release) {
    const query = buildSearchQuery(release);
    return [
        { name: 'Spotify', url: `https://open.spotify.com/search/${query}` },
        { name: 'Apple Music', url: `https://music.apple.com/search?term=${query}` },
        { name: 'Deezer', url: `https://www.deezer.com/search/${query}` },
        { name: 'Amazon', url: `https://www.amazon.de/s?k=${query}` },
        { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${query}` }
    ];
}

function renderMusicLinks(release) {
    const container = document.getElementById('musicLinks');
    container.innerHTML = '';

    getMusicLinks(release).forEach(service => {
        const link = document.createElement('a');
        link.className = 'service-link';
        link.href = service.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = service.name;
        container.appendChild(link);
    });
}

function normalizeBarcode(value) {
    return (value || '').toString().trim().replace(/[\s-]/g, '');
}

function calculateCheckDigit(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        const digit = parseInt(digits[i], 10);
        sum += digit * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
}

function isValidBarcode(value) {
    const cleaned = normalizeBarcode(value);
    if (!/^\d+$/.test(cleaned)) {
        return false;
    }

    if (cleaned.length === 8 || cleaned.length === 12 || cleaned.length === 13) {
        const digits = cleaned.slice(0, -1);
        const expected = calculateCheckDigit(digits);
        return parseInt(cleaned.slice(-1), 10) === expected;
    }

    return false;
}

function detectBarcodeFormat(value) {
    const cleaned = normalizeBarcode(value);

    if (!isValidBarcode(cleaned)) {
        return null;
    }

    if (cleaned.length === 8) {
        return { format: 'EAN8', value: cleaned };
    }

    if (cleaned.length === 12) {
        return { format: 'UPC', value: cleaned };
    }

    if (cleaned.length === 13) {
        return { format: 'EAN13', value: cleaned };
    }

    return null;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;');
}

async function fetchLyrics(release) {
    const artist = getArtistName(release).trim();
    const title = (release.title || '').trim();

    if (!artist || !title) {
        return `[00:00.00]${artist || 'Unbekannt'} – ${title || 'Unbekannt'}\n[00:05.00]Keine Lyrics verfügbar.`;
    }

    try {
        const response = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (!response.ok) throw new Error('no lyrics');
        const data = await response.json();
        if (data && data.lyrics) {
            return data.lyrics;
        }
    } catch (error) {
        console.warn('Lyrics konnten nicht geladen werden:', error);
    }

    return `[00:00.00]${artist} – ${title}\n[00:05.00]Lyrics werden vorbereitet.\n[00:10.00]Bitte später herunterladen.`;
}

function toLrc(text) {
    return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, index) => `[${String(index * 2).padStart(2, '0')}:00.00] ${line}`)
        .join('\n');
}

async function addSelectedRelease(release) {
    if (!release) return;
    const existing = selectedSongs.find(item => item.id === (release.id || release.title));
    if (existing) return;

    const lyrics = await fetchLyrics(release);
    selectedSongs.push({ ...release, lyrics, id: release.id || `${release.title}-${release.date || 'unknown'}` });
    renderSelectedSongs();
}

function renderSelectedSongs() {
    const container = document.getElementById('selectedSongs');
    if (!selectedSongs.length) {
        container.innerHTML = '<div class="selected-song"><p>Keine Songs ausgewählt. Öffne ein Release und füge es zur Auswahl hinzu.</p></div>';
        return;
    }

    container.innerHTML = '';
    selectedSongs.forEach(item => {
        const article = document.createElement('article');
        article.className = 'selected-song';
        const preview = item.lyrics.split(/\r?\n/).slice(0, 3).join('<br>');
        article.innerHTML = `
            <div class="selected-song-head">
                <div>
                    <h3>${escapeHtml(item.title || 'Unbekannt')}</h3>
                    <p>${escapeHtml(getArtistName(item))}</p>
                </div>
                <button type="button" class="secondary" data-download-id="${item.id}">Download</button>
            </div>
            <pre>${escapeHtml(preview)}</pre>
        `;
        article.querySelector('button').addEventListener('click', () => downloadReleasePackage(item, item.lyrics));
        container.appendChild(article);
    });
}

async function searchAndDownloadAudio(query) {
    const statusEl = document.getElementById('audioStatus');
    statusEl.textContent = 'Suche nach Musik …';

    try {
        const response = await fetch(`${API_BASE_URL}/api/ytdlp?query=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (!response.ok || !data.downloadUrl) {
            throw new Error(data.error || 'Keine Datei gefunden');
        }

        statusEl.textContent = `Datei bereit: ${data.filename}`;
        triggerDownloadUrl(`${API_BASE_URL}${data.downloadUrl}`, data.filename);
    } catch (error) {
        console.error(error);
        statusEl.textContent = 'Die Musik-Suche war nicht erfolgreich. Bitte versuche es mit einem anderen Suchbegriff.';
    }
}

async function downloadSongFromUrl(url) {
    const filename = getDownloadFilename(url);

    try {
        const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Proxy-Download fehlgeschlagen');

        const blob = await response.blob();
        triggerDownload(blob, filename);
    } catch (error) {
        console.warn('Proxy-Download fehlgeschlagen, versuche direkten Download:', error);
        triggerDownloadUrl(url, filename);
    }
}

function getDownloadFilename(url) {
    try {
        const parsed = new URL(url);
        const name = parsed.pathname.split('/').filter(Boolean).pop() || 'song';
        return decodeURIComponent(name) || 'song';
    } catch {
        return 'song';
    }
}

function triggerDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
}

function triggerDownloadUrl(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function downloadReleasePackage(release, lyricsText) {
    const zip = new JSZip();
    const safeName = (release.title || 'song').toString().replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/(^-|-$)/g, '') || 'song';
    const folder = safeName;
    const metadata = {
        title: release.title || 'Unbekannt',
        artist: getArtistName(release),
        date: release.date || '',
        country: release.country || '',
        status: release.status || '',
        label: (release['label-info'] && release['label-info'][0] && release['label-info'][0].label && release['label-info'][0].label.name) ? release['label-info'][0].label.name : '',
        format: (release.media && release.media[0] && release.media[0].format) ? release.media[0].format : '',
        barcode: release.barcode || '',
        lyrics: lyricsText || ''
    };

    zip.file(`${folder}/info.json`, JSON.stringify(metadata, null, 2));
    zip.file(`${folder}/lyrics.lrc`, toLrc(lyricsText || ''));
    zip.file(`${folder}/lyrics.txt`, lyricsText || '');

    const coverUrl = getCoverArtUrl(release) || createCoverPlaceholder();
    try {
        const coverResponse = await fetch(coverUrl);
        const coverBlob = coverResponse.ok ? await coverResponse.blob() : await (await fetch(createCoverPlaceholder())).blob();
        const coverExt = coverBlob.type.includes('png') ? 'png' : 'jpg';
        zip.file(`${folder}/cover.${coverExt}`, coverBlob);
    } catch (error) {
        console.warn('Cover konnte nicht geladen werden:', error);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `${folder}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
}

async function downloadSelectedBundle(items) {
    const zip = new JSZip();
    for (const item of items) {
        const folder = (item.title || 'song').toString().replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/(^-|-$)/g, '') || 'song';
        const metadata = {
            title: item.title || 'Unbekannt',
            artist: getArtistName(item),
            date: item.date || '',
            country: item.country || '',
            status: item.status || '',
            label: (item['label-info'] && item['label-info'][0] && item['label-info'][0].label && item['label-info'][0].label.name) ? item['label-info'][0].label.name : '',
            format: (item.media && item.media[0] && item.media[0].format) ? item.media[0].format : '',
            barcode: item.barcode || '',
            lyrics: item.lyrics || ''
        };

        zip.file(`${folder}/info.json`, JSON.stringify(metadata, null, 2));
        zip.file(`${folder}/lyrics.lrc`, toLrc(item.lyrics || ''));
        zip.file(`${folder}/lyrics.txt`, item.lyrics || '');

        const coverUrl = getCoverArtUrl(item) || createCoverPlaceholder();
        try {
            const coverResponse = await fetch(coverUrl);
            const coverBlob = coverResponse.ok ? await coverResponse.blob() : await (await fetch(createCoverPlaceholder())).blob();
            const coverExt = coverBlob.type.includes('png') ? 'png' : 'jpg';
            zip.file(`${folder}/cover.${coverExt}`, coverBlob);
        } catch (error) {
            console.warn('Cover konnte nicht geladen werden:', error);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = 'infosik-auswahl.zip';
    link.click();
    URL.revokeObjectURL(link.href);
}

async function showDetails(release) {
    currentRelease = release;
    document.getElementById('resultsList').innerHTML = '';
    const infoCard = document.getElementById('infoCard');

    const title = release.title || 'Unbekannt';
    const artist = getArtistName(release);
    const date = release.date || 'Nicht angegeben';
    const country = release.country || 'International';
    const status = release.status || 'Unbekannt';
    const label = (release['label-info'] && release['label-info'][0] && release['label-info'][0].label && release['label-info'][0].label.name) ? release['label-info'][0].label.name : 'Nicht angegeben';
    const format = (release.media && release.media[0] && release.media[0].format) ? release.media[0].format : 'Unbekannt';
    const rawBarcode = release.barcode;
    const barcode = normalizeBarcode(rawBarcode);

    document.getElementById('cardTitle').innerText = title;
    document.getElementById('cardArtist').innerText = artist;
    document.getElementById('cardArtistLine').innerText = artist;
    document.getElementById('cardDate').innerText = date;
    document.getElementById('cardCountry').innerText = country;
    document.getElementById('cardStatus').innerText = status;
    document.getElementById('cardLabel').innerText = label;
    document.getElementById('cardFormat').innerText = format;

    const lyricsContent = document.getElementById('lyricsContent');
    lyricsContent.textContent = 'Lyrics werden geladen…';

    const coverImage = document.getElementById('coverImage');
    const coverUrl = getCoverArtUrl(release);
    renderMusicLinks(release);
    coverImage.src = coverUrl || createCoverPlaceholder();
    coverImage.onerror = () => {
        coverImage.src = createCoverPlaceholder();
    };

    const barcodeSvg = document.getElementById('barcode');
    const noBarcodeText = document.getElementById('noBarcodeText');

    if (barcode) {
        const barcodeSpec = detectBarcodeFormat(barcode);

        if (barcodeSpec) {
            document.getElementById('cardBarcodeNum').innerText = barcode;
            barcodeSvg.innerHTML = '';
            barcodeSvg.style.display = 'inline-block';
            noBarcodeText.style.display = 'none';

            try {
                JsBarcode('#barcode', barcodeSpec.value, {
                    format: barcodeSpec.format,
                    lineColor: '#000',
                    width: 2,
                    height: 80,
                    displayValue: true
                });
            } catch (e) {
                console.error('Barcode konnte nicht gerendert werden:', e);
                document.getElementById('cardBarcodeNum').innerText = 'Barcode konnte nicht gerendert werden';
                barcodeSvg.style.display = 'none';
                noBarcodeText.innerText = 'Der Barcode-Wert ist nicht als gültiger EAN/UPC-Code verfügbar.';
                noBarcodeText.style.display = 'block';
            }
        } else {
            document.getElementById('cardBarcodeNum').innerText = 'Barcode nicht als EAN/UPC lesbar';
            barcodeSvg.style.display = 'none';
            noBarcodeText.innerText = 'Der Barcode-Wert ist nicht als gültiger EAN/UPC-Code verfügbar.';
            noBarcodeText.style.display = 'block';
        }
    } else {
        document.getElementById('cardBarcodeNum').innerText = 'Keine Nummer vorhanden';
        barcodeSvg.style.display = 'none';
        noBarcodeText.innerText = 'Kein Barcode in der Datenbank verfügbar.';
        noBarcodeText.style.display = 'block';
    }

    const lyrics = await fetchLyrics(release);
    lyricsContent.textContent = lyrics;
    infoCard.style.display = 'block';
}

init();
