from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import os

PORT = int(os.environ.get('PORT', 7860))

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._respond(200, {'status': 'ok'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length).decode())
        except Exception:
            self._respond(400, {'error': 'Invalid JSON'})
            return

        url = body.get('url', '')
        if not url:
            self._respond(400, {'error': 'Missing url'})
            return

        try:
            stream = subprocess.run(
                ['yt-dlp', '-f', 'best[ext=mp4]//best', '-g', url],
                capture_output=True, text=True, timeout=120,
            )
            if stream.returncode != 0:
                self._respond(500, {'error': stream.stderr.strip()})
                return

            meta = subprocess.run(
                ['yt-dlp', '--dump-json', url],
                capture_output=True, text=True, timeout=120,
            )

            info = {}
            if meta.returncode == 0:
                data = json.loads(meta.stdout)
                info['duration'] = data.get('duration', 0)
                info['title'] = data.get('title', '')
                info['resolution'] = data.get('resolution', '')

            self._respond(200, {
                'streamUrl': stream.stdout.strip(),
                'duration': info.get('duration', 0),
                'title': info.get('title', ''),
                'resolution': info.get('resolution', ''),
            })
        except subprocess.TimeoutExpired:
            self._respond(504, {'error': 'yt-dlp timed out'})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _respond(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

HTTPServer(('', PORT), Handler).serve_forever()
