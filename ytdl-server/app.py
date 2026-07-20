from flask import Flask, request, jsonify
import yt_dlp
import os

app = Flask(__name__)

@app.route('/', methods=['POST'])
def extract():
    data = request.get_json(silent=True)
    if not data or not data.get('url'):
        return jsonify({'error': 'Missing url'}), 400
    url = data['url']
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'format': 'b[ext=mp4]/b'}) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return jsonify({'error': 'No info'}), 500
            stream_url = info.get('url')
            if not stream_url:
                fmts = info.get('formats', [])
                for f in fmts:
                    if f.get('url'):
                        stream_url = f['url']
                        break
            return jsonify({
                'streamUrl': stream_url or '',
                'duration': info.get('duration', 0),
                'title': info.get('title', ''),
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
