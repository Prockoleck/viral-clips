from flask import Flask, request, jsonify
import subprocess, os, json

app = Flask(__name__)

@app.route('/', methods=['POST'])
def extract():
    data = request.get_json()
    url = data.get('url', '')
    if not url:
        return jsonify({'error': 'Missing url'}), 400

    try:
        stream = subprocess.run(
            ['yt-dlp', '-f', 'best[ext=mp4]//best', '-g', url],
            capture_output=True, text=True, timeout=120,
        )
        if stream.returncode != 0:
            return jsonify({'error': stream.stderr.strip()}), 500

        meta = subprocess.run(
            ['yt-dlp', '--dump-json', url],
            capture_output=True, text=True, timeout=120,
        )

        info = {}
        if meta.returncode == 0:
            d = json.loads(meta.stdout)
            info['duration'] = d.get('duration', 0)
            info['title'] = d.get('title', '')
            info['resolution'] = d.get('resolution', '')

        return jsonify({
            'streamUrl': stream.stdout.strip(),
            'duration': info.get('duration', 0),
            'title': info.get('title', ''),
            'resolution': info.get('resolution', ''),
        })
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'yt-dlp timed out'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
