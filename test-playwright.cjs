const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const videoId = '90lLQVZe2Nc';
  
  // Load watch page to get session/visitor data
  console.log('=== Loading watch page ===');
  await page.goto(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Extract VISITOR_DATA and other session tokens from page
  const sessionData = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    // Look for VISITOR_DATA
    const vdMatch = html.match(/"VISITOR_DATA":\s*"([^"]+)"/);
    const vsMatch = html.match(/"VISITOR_DATA署名":\s*"([^"]+)"/);
    // Look for INNERTUBE_API_KEY
    const keyMatch = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
    // Look for INNERTUBE_CONTEXT
    const ctxMatch = html.match(/"INNERTUBE_CONTEXT":\s*(\{[^}]+\})/);
    // Look for client version
    const cvMatch = html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/);
    
    return {
      visitorData: vdMatch?.[1] || null,
      apiKey: keyMatch?.[1] || null,
      clientVersion: cvMatch?.[1] || null,
    };
  });
  console.log('Session data:', JSON.stringify(sessionData));
  
  // Method 1: InnerTube get_transcript endpoint
  console.log('\n=== Method 1: InnerTube get_transcript ===');
  const transcriptResult = await page.evaluate(async (vid) => {
    try {
      const body = {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250717.00.00',
            hl: 'en',
          }
        },
        params: btoa(`\n\x0b${vid}`)
      };
      
      const r = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const data = await r.json();
      if (data.error) return { error: data.error };
      
      // Extract segments
      const body2 = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer;
      if (!body2) return { raw: JSON.stringify(data).substring(0, 1000) };
      
      const segments = body2.cueGroups?.map(g => {
        const cue = g.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
        return {
          text: cue?.cue?.simpleText || '',
          startMs: parseInt(cue?.startOffsetMs || '0'),
          durationMs: parseInt(cue?.durationMs || '0'),
        };
      }) || [];
      
      return { count: segments.length, first5: segments.slice(0, 5), last: segments.slice(-1) };
    } catch (e) {
      return { error: e.message };
    }
  }, videoId);
  console.log('get_transcript result:', JSON.stringify(transcriptResult, null, 2));
  
  // Method 2: Try srv3 format on timedtext URL
  console.log('\n=== Method 2: timedtext with srv3 format ===');
  const tracks = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const m = html.match(/"captionTracks":\s*(\[.*?\])/);
    return m ? JSON.parse(m[1]) : null;
  });
  
  if (tracks && tracks.length > 0) {
    const baseUrl = tracks[0].baseUrl.replace(/\\u0026/g, '&');
    
    for (const fmt of ['srv3', 'json3', '']) {
      const fmtUrl = fmt ? `${baseUrl}&fmt=${fmt}` : baseUrl;
      const result = await page.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        const text = await r.text();
        return { status: r.status, length: text.length, preview: text.substring(0, 200) };
      }, fmtUrl);
      console.log(`  fmt=${fmt || 'default'}:`, JSON.stringify(result));
    }
  }
  
  // Method 3: Check if player actually loaded captions on page
  console.log('\n=== Method 3: Check player caption state ===');
  const playerState = await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    if (!player || !player.getPlayerResponse) return { noPlayer: true };
    const pr = player.getPlayerResponse();
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return {
      hasTracks: !!tracks,
      trackCount: tracks?.length || 0,
      trackDetails: tracks?.map(t => ({ lang: t.languageCode, kind: t.kind, url: t.baseUrl?.substring(0, 100) })),
    };
  });
  console.log('Player state:', JSON.stringify(playerState, null, 2));
  
  // Method 4: Try to get transcript via player API
  console.log('\n=== Method 4: Player getCaptions ===');
  const captionData = await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    if (!player) return { noPlayer: true };
    
    // Try different player methods
    const methods = [];
    for (const m of ['getCaptions', 'getAvailableCaptions', 'getOption']) {
      if (typeof player[m] === 'function') methods.push(m);
    }
    
    let result = { availableMethods: methods };
    
    if (typeof player.getOption === 'function') {
      try {
        result.captionTrackList = player.getOption('captions', 'tracklist');
      } catch(e) { result.trackListError = e.message; }
    }
    
    return result;
  });
  console.log('Caption data:', JSON.stringify(captionData, null, 2));
  
  await browser.close();
  console.log('\n=== Done ===');
})();
