import json
import os
import re
import subprocess
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(ROOT, 'downloads')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/search':
            query = (parse_qs(parsed.query).get('query', [''])[0] or '').strip()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            try:
                url = 'https://r.jina.ai/http://musicbrainz.org/ws/2/release/?query=' + urllib.parse.quote(query) + '&fmt=json'
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                })
                with urllib.request.urlopen(req, timeout=30) as response:
                    body = response.read().decode('utf-8', 'ignore')
                    payload = None
                    try:
                        payload = json.loads(body)
                    except json.JSONDecodeError:
                        payload = None

                    if isinstance(payload, dict) and isinstance(payload.get('data'), dict) and isinstance(payload['data'].get('content'), str):
                        payload = json.loads(payload['data']['content'])

                    raw_releases = payload.get('releases', []) if isinstance(payload, dict) else []
                    releases = []
                    for release in raw_releases[:8]:
                        if not isinstance(release, dict):
                            continue
                        releases.append({
                            'id': release.get('id'),
                            'title': release.get('title'),
                            'artist': release.get('artist-credit', [{}])[0].get('name') if release.get('artist-credit') else None,
                            'artist-credit': release.get('artist-credit'),
                            'date': release.get('date'),
                            'country': release.get('country'),
                            'media': release.get('media'),
                            'barcode': release.get('barcode')
                        })
                    self.wfile.write(json.dumps({'releases': releases}).encode('utf-8'))
            except Exception as exc:
                self.wfile.write(json.dumps({'releases': [], 'error': str(exc)}).encode('utf-8'))
            return

        if parsed.path == '/api/download':
            target_url = (parse_qs(parsed.query).get('url', [''])[0] or '').strip()
            if not target_url:
                self.send_response(400)
                self.end_headers()
                return

            filename = os.path.basename(urllib.parse.urlparse(target_url).path) or 'download'
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
            self.end_headers()

            try:
                req = urllib.request.Request(target_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=60) as response:
                    self.wfile.write(response.read())
            except Exception as exc:
                self.wfile.write(str(exc).encode('utf-8'))
            return

        if parsed.path == '/api/ytdlp':
            query = (parse_qs(parsed.query).get('query', [''])[0] or '').strip()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            if not query:
                self.wfile.write(json.dumps({'error': 'Kein Suchbegriff angegeben.'}).encode('utf-8'))
                return

            safe_name = re.sub(r'[^a-z0-9]+', '-', query.lower()).strip('-') or 'download'
            output_template = os.path.join(DOWNLOAD_DIR, f'{safe_name}.%(ext)s')

            try:
                cmd = [
                    'yt-dlp',
                    '--no-warnings',
                    '--extract-audio',
                    '--audio-format', 'mp3',
                    '--audio-quality', '0',
                    '-o', output_template,
                    '--print', 'after_move:filepath',
                    f'ytsearch1:{query}'
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
                if proc.returncode != 0:
                    raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or 'Download fehlgeschlagen')

                output_path = None
                for line in proc.stdout.splitlines():
                    line = line.strip()
                    if line and os.path.exists(line):
                        output_path = line
                        break

                if not output_path:
                    raise FileNotFoundError('Es wurde keine Datei erzeugt')

                filename = os.path.basename(output_path)
                download_url = f'/api/file?name={urllib.parse.quote(filename)}'
                self.wfile.write(json.dumps({'filename': filename, 'downloadUrl': download_url}).encode('utf-8'))
            except Exception as exc:
                self.wfile.write(json.dumps({'error': str(exc)}).encode('utf-8'))
            return

        if parsed.path == '/api/file':
            name = (parse_qs(parsed.query).get('name', [''])[0] or '').strip()
            safe_path = os.path.join(DOWNLOAD_DIR, os.path.basename(name))
            if not os.path.exists(safe_path) or not os.path.isfile(safe_path):
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(safe_path)}"')
            self.end_headers()
            with open(safe_path, 'rb') as fh:
                self.wfile.write(fh.read())
            return

        if parsed.path in ('/', '/index.html'):
            file_path = os.path.join(ROOT, 'index.html')
        else:
            file_path = os.path.join(ROOT, parsed.path.lstrip('/'))

        if os.path.exists(file_path) and os.path.isfile(file_path):
            self.send_response(200)
            if file_path.endswith('.html'):
                self.send_header('Content-Type', 'text/html; charset=utf-8')
            elif file_path.endswith('.js'):
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            else:
                self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with open(file_path, 'rb') as fh:
                self.wfile.write(fh.read())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


HOST = '127.0.0.1'
PORT = 8002

if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Server läuft auf http://{HOST}:{PORT}')
    server.serve_forever()
