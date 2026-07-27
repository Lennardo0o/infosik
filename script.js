function parseProxyResponse(rawText) {
    try {
        const parsed = JSON.parse(rawText);
        if (parsed && parsed.data && typeof parsed.data.content === 'string') {
            return JSON.parse(parsed.data.content);
        }
        return parsed;
    } catch (error) {
        console.error('Proxy-Antwort konnte nicht geparst werden:', error);
        return null;
    }
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

function showDetails(release) {
    document.getElementById('resultsList').innerHTML = '';
    const infoCard = document.getElementById('infoCard');

    const title = release.title || 'Unbekannt';
    const artist = getArtistName(release);
    const date = release.date || 'Nicht angegeben';
    const country = release.country || 'International';
    const format = (release.media && release.media[0] && release.media[0].format) ? release.media[0].format : 'Unbekannt';
    const rawBarcode = release.barcode;
    const barcode = normalizeBarcode(rawBarcode);

    document.getElementById('cardTitle').innerText = title;
    document.getElementById('cardArtist').innerText = artist;
    document.getElementById('cardArtistLine').innerText = artist;
    document.getElementById('cardDate').innerText = date;
    document.getElementById('cardCountry').innerText = country;
    document.getElementById('cardFormat').innerText = format;

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

    infoCard.style.display = 'block';
}
