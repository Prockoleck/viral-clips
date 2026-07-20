FROM python:3.11-slim

RUN pip install --no-cache-dir yt-dlp

WORKDIR /app
COPY server.py .

EXPOSE 7860
CMD ["python", "server.py"]
