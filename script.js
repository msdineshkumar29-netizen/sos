/* RapidAid Advanced Client Script */
const siren = document.getElementById('siren');
const sosBtn = document.getElementById('sosBtn');
const cancelBtn = document.getElementById('cancelSOS');
const statusBox = document.getElementById('statusBox');
const timerBox = document.getElementById('timerBox');
const helpBox = document.getElementById('helpBox');
const activityLog = document.getElementById('activityLog');
const callBtn = document.getElementById('callBtn');
const shareBtn = document.getElementById('shareBtn');
const voiceBtn = document.getElementById('voiceSOS');
const shakeToggle = document.getElementById('shakeToggle');
let watchId = null; let map, marker; let emergencyActive = false; let countdownTimer = null; let countdown = 5; let timerSeconds = 0; let autoRepeat = false; let repeatInterval = 60; let shakeEnabled = false; let contacts = []; 
window.addEventListener('load', () => {
  const saved = localStorage.getItem('contacts');
  if (saved) contacts = JSON.parse(saved);
  const primary = contacts[0] || '';
  const secondary = contacts[1] || '';
  const primEl = document.getElementById('contactPrimary');
  const secEl = document.getElementById('contactSecondary');
  if(primEl) primEl.value = primary;
  if(secEl) secEl.value = secondary;
  initMap();
  startBackgroundParticles();
  registerServiceWorker();
  addNeonHandlers();
});
function initMap(){
  map = L.map('map', {attributionControl:false}).setView([20,0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
}
function log(msg){
  const li = document.createElement('li'); li.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; activityLog.prepend(li);
}
function setStatus(msg){ statusBox.textContent = msg; log(msg); }
document.getElementById('saveContact').addEventListener('click', ()=>{
  const p = document.getElementById('contactPrimary').value.trim();
  const s = document.getElementById('contactSecondary').value.trim();
  if(!p) return alert('Enter at least a primary contact');
  // normalize list and remove duplicates
  const list = [];
  if(p) list.push(p);
  if(s && s!==p) list.push(s);
  contacts = list.concat(contacts.filter(x=>!list.includes(x)));
  localStorage.setItem('contacts', JSON.stringify(contacts));
  setStatus('Contacts saved: ' + contacts.slice(0,3).join(', '));
});
sosBtn.addEventListener('click', ()=>{
  beginCountdown();
});
function beginCountdown(){
  if (emergencyActive) return;
  countdown = 5; document.getElementById('lockScreen').style.display='flex'; document.getElementById('lockScreen').setAttribute('aria-hidden','false');
  document.getElementById('countdown').textContent = `Sending in ${countdown}...`;
  countdownTimer = setInterval(()=>{ countdown--; document.getElementById('countdown').textContent = `Sending in ${countdown}...`; if(countdown<=0){ clearInterval(countdownTimer); sendSOS(); }} ,1000);
}
cancelBtn.addEventListener('click', ()=>{ clearInterval(countdownTimer); document.getElementById('lockScreen').style.display='none'; document.getElementById('lockScreen').setAttribute('aria-hidden','true'); setStatus('Emergency canceled'); });
async function sendSOS(){
  emergencyActive = true; setStatus('📍 Acquiring location...');
  document.getElementById('lockScreen').querySelector('.headline')?.classList.add('active');
  try{
    const position = await getLocation({enableHighAccuracy:true,timeout:10000});
    const lat = position.coords.latitude; const lng = position.coords.longitude;
    document.getElementById('coords').textContent = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
    if(!marker) marker = L.marker([lat,lng]).addTo(map);
    marker.setLatLng([lat,lng]); map.setView([lat,lng], 15);
    setStatus('🔎 Locating nearest hospital...');
    const hospital = await findNearestHospital(lat,lng);
    const name = document.getElementById('userName').value || 'Unknown';
    const rawP = (document.getElementById('contactPrimary')?.value || contacts[0] || '').trim();
    const rawS = (document.getElementById('contactSecondary')?.value || contacts[1] || '').trim();
    const recipients = [rawP, rawS].filter(Boolean).map(c => c.replace(/[^\d\+]/g,'')).filter((v,i,a)=>a.indexOf(v)===i);
    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const message = `🚨 EMERGENCY 🚨\nName: ${name}\nLocation: ${mapsLink}\nNearest Hospital: ${hospital.name || 'N/A'} (${hospital.distance ? (hospital.distance.toFixed(2)+'km') : '—'})`;
    // Native share if available (user can optionally use it)
    if(navigator.share){
      await navigator.share({title:'Emergency',text:message,url:mapsLink});
      setStatus('Shared via native share');
    }

    // Send via WhatsApp to first recipient and SMS to all recipients (track results)
    if(recipients.length){
      try{ window.open(`https://wa.me/${recipients[0].replace(/[^0-9]/g,'')}?text=${encodeURIComponent(message)}`,'_blank'); }catch(e){}
      const sendPromises = recipients.map(r => sendSmsNative(r, message).catch(err=>({number:r,method:'send',status:'failed',error:String(err)})));
      const results = await Promise.all(sendPromises);
      updateSendStatusUI(results);
      setStatus('Message send results: '+results.map(s=>`${s.number}:${s.status}`).join(', '));
    }

    callBtn.href = `tel:${recipients[0]||'108'}`;
    fetch('/sos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat,lng,contacts:recipients,name})}).catch(()=>{});
    siren.play().catch(()=>{}); if(navigator.vibrate) navigator.vibrate([200,100,200]);
    document.getElementById('lockScreen').querySelector('#countdown').textContent = 'Emergency Active';
    setStatus('🚨 Emergency sent — sending to: '+(recipients.join(', ')||'none'));
    startTimer();
  }catch(err){ setStatus('Failed to get location: '+err.message); emergencyActive=false; document.getElementById('lockScreen').style.display='none'; }
}
async function ensureLocationPermission(){
  if(!('geolocation' in navigator)) throw new Error('Geolocation not supported in this browser');
  // Best-effort check using Permissions API
  try{
    const p = await navigator.permissions.query({ name: 'geolocation' });
    if(p.state === 'granted') return 'granted';
    if(p.state === 'denied') throw new Error('permission_denied');
    // state === 'prompt' -> attempt to prompt the user
  }catch(e){ /* permissions API may not be available, fall through */ }

  // Trigger a prompt by attempting to get the position with a short timeout
  return new Promise((res, rej) => {
    const onSuccess = () => res('granted');
    const onError = (err) => {
      if(err && err.code === 1) return rej(new Error('permission_denied'));
      return rej(err || new Error('geolocation_error'));
    };
    navigator.geolocation.getCurrentPosition(onSuccess, onError, {timeout:8000,maximumAge:0});
  });
}

async function getLocation(opt){
  if(!('geolocation' in navigator)) throw new Error('Geolocation not supported');
  opt = opt || { enableHighAccuracy: true, timeout: 10000 };

  return new Promise((resolve, reject) => {
    let settled = false;
    const fallbackTimer = setTimeout(() => {
      // fallback: try watchPosition for a short period
      if(settled) return;
      const watchId = navigator.geolocation.watchPosition(pos => {
        clearTimeout(fallbackTimer);
        navigator.geolocation.clearWatch(watchId);
        settled = true;
        resolve(pos);
      }, err2 => {
        navigator.geolocation.clearWatch(watchId);
        if(!settled){ settled = true; reject(new Error('Position unavailable (watch fallback)')); }
      }, { enableHighAccuracy: true, maximumAge:0 });
      // give watch 8s to obtain a fix
      setTimeout(()=>{ try{ navigator.geolocation.clearWatch(watchId); }catch(e){} if(!settled){ settled=true; reject(new Error('Timeout obtaining location')); } },8000);
    }, opt.timeout || 10000);

    navigator.geolocation.getCurrentPosition(pos => {
      if(settled) return; clearTimeout(fallbackTimer); settled = true; resolve(pos);
    }, err => {
      clearTimeout(fallbackTimer);
      if(settled) return;
      settled = true;
      if(err.code === 1) return reject(new Error('Permission denied'));
      if(err.code === 2) return reject(new Error('Position unavailable'));
      if(err.code === 3) return reject(new Error('Timeout'));
      return reject(new Error(err.message || 'Unknown geolocation error'));
    }, opt);
  });
}

function showLocationHelp(reason){
  const msg = {
    'permission_denied': 'Location permission was denied. Enable location access in your browser or device settings and retry.',
    'Permission denied': 'Location permission was denied. Enable location access in your browser or device settings and retry.',
    'Position unavailable': 'Location not available. Try moving outdoors or enable high accuracy (GPS) and retry.',
    'Timeout': 'Location attempt timed out. Try again or move to a location with a clear sky view.',
    'Geolocation not supported': 'Your browser does not support geolocation. Use Chrome or a modern browser, or run on a device with GPS.'
  }[reason] || `Location error: ${reason}`;
  alert(msg + "\n\nTip: Serve over https or use localhost, and grant location permission when prompted.");
}

// retry button
const retryLocBtn = document.getElementById('retryLoc');
retryLocBtn?.addEventListener('click', async ()=>{
  setStatus('Retrying location...');
  try{
    await ensureLocationPermission();
    const pos = await getLocation({enableHighAccuracy:true, timeout:12000});
    setStatus('Location obtained: '+pos.coords.latitude.toFixed(5)+','+pos.coords.longitude.toFixed(5));
    if(!marker) marker = L.marker([pos.coords.latitude,pos.coords.longitude]).addTo(map);
    marker.setLatLng([pos.coords.latitude,pos.coords.longitude]); map.setView([pos.coords.latitude,pos.coords.longitude],15);
  }catch(e){ setStatus('Location error: '+(e.message||e)); showLocationHelp(e.message||e); }
});

// Update sendSOS to use permission check + clearer errors
const _oldSendSOS = sendSOS; // keep a reference in case
async function isNativePlatform(){
  try{
    if(window.Capacitor && (window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : false))) return true;
  }catch(e){}
  return false;
}

// Try to get location using native Background Geolocation plugin (Android/iOS) when available
async function getNativeBgLocation(timeoutMs = 10000){
  try{
    const bg = await import('@capacitor-community/background-geolocation');
    const BackgroundGeolocation = bg.BackgroundGeolocation || bg.default || bg;
    // addWatcher returns an id; it calls callback with (location, error)
    return await new Promise((resolve, reject) => {
      let resolved = false;
      BackgroundGeolocation.addWatcher({requestPermissions:true, backgroundTitle:'RapidAid tracking', backgroundMessage:'Using location for emergency', stale:false}, (location, error) => {
        if(error){ if(!resolved){ resolved = true; reject(new Error(error.message || 'BG location error')); } return; }
        if(location && !resolved){ resolved = true; resolve(location); }
      }).then(watcherId => {
        // guard timeout
        setTimeout(()=>{ if(!resolved){ BackgroundGeolocation.removeWatcher({id: watcherId}).catch(()=>{}); resolved = true; reject(new Error('Native location timeout')); } }, timeoutMs);
      }).catch(err=>{ if(!resolved){ resolved = true; reject(err); } });
    });
  }catch(e){ throw new Error('Native BG plugin unavailable'); }
}

async function getBestLocation(){
  // prefer native plugin when on native (Android/iOS) and plugin available
  if(await isNativePlatform()){
    setStatus('Using native location provider');
    try{
      const loc = await getNativeBgLocation(12000);
      // location fields may vary (latitude/longitude or lat/lng)
      const lat = loc.latitude || loc.coords?.latitude || loc.lat;
      const lng = loc.longitude || loc.coords?.longitude || loc.lon || loc.lng;
      if(lat && lng) return { latitude: lat, longitude: lng };
    }catch(e){ console.warn('Native location failed', e); setStatus('Native location failed, falling back'); }
  }

  // fallback to browser geolocation
  try{
    const pos = await getLocation({enableHighAccuracy:true, timeout:15000});
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }catch(e){ console.warn('Browser geolocation failed', e); throw e; }
}

async function sendSOS(){
  try{
    setStatus('Checking location permission...');
    await ensureLocationPermission();
  }catch(e){ setStatus('Location permission error'); showLocationHelp(e.message||e); return; }

  // proceed with most reliable provider
  try{
    const loc = await getBestLocation();
    await processLocation(loc.latitude, loc.longitude);
  }catch(err){
    setStatus('Failed to get location: '+(err.message||err));
    // show helpful message and offer approximate IP-based fallback
    setLastLocationError(err.message||String(err));
    document.getElementById('useApproxBtn').style.display = 'inline-block';
    showLocationHelp(err.message||err);
    emergencyActive=false; document.getElementById('lockScreen').style.display='none';
  }
}

async function processLocation(lat, lng){
  try{
    emergencyActive = true; setStatus('📍 Location confirmed');
    document.getElementById('countdown').textContent = 'Emergency Active';
    document.getElementById('coords').textContent = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
    if(!marker) marker = L.marker([lat,lng]).addTo(map);
    marker.setLatLng([lat,lng]); map.setView([lat,lng], 15);
    setStatus('🔎 Locating nearest hospital...');
    const hospital = await findNearestHospital(lat,lng);
    const name = document.getElementById('userName').value || 'Unknown';
    const rawP = (document.getElementById('contactPrimary')?.value || contacts[0] || '').trim();
    const rawS = (document.getElementById('contactSecondary')?.value || contacts[1] || '').trim();
    const recipients = [rawP, rawS].filter(Boolean).map(c => c.replace(/[^\d\+]/g,'')).filter((v,i,a)=>a.indexOf(v)===i);
    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const message = `🚨 EMERGENCY 🚨\nName: ${name}\nLocation: ${mapsLink}\nNearest Hospital: ${hospital.name || 'N/A'} (${hospital.distance ? (hospital.distance.toFixed(2)+'km') : '—'})`;
    if(navigator.share){ await navigator.share({title:'Emergency',text:message,url:mapsLink}); setStatus('Shared via native share'); } else { if(recipients.length){ try{ window.open(`https://wa.me/${recipients[0].replace(/[^0-9]/g,'')}?text=${encodeURIComponent(message)}`,'_blank'); }catch(e){} recipients.forEach(r=>{ try{ sendSmsNative(r, message); }catch(e){ console.warn('SMS send failure', e); } }); } }
    callBtn.href = `tel:${recipients[0]||'108'}`;
    fetch('/sos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat,lng,contacts:recipients,name})}).catch(()=>{});
    siren.play().catch(()=>{}); if(navigator.vibrate) navigator.vibrate([200,100,200]);
    document.getElementById('lockScreen').querySelector('#countdown').textContent = 'Emergency Active';
    setStatus('🚨 Emergency sent — sending to: '+(recipients.join(', ')||'none'));
    startTimer();
  }catch(e){ setStatus('Error during SOS flow: '+e.message); }
}

function setLastLocationError(msg){
  const el = document.getElementById('lastLocationError');
  if(!el) return; el.style.display='block'; el.textContent = 'Last location error: '+msg; window._diagErrors = window._diagErrors || []; window._diagErrors.push('LocationError: '+msg);
}

async function ipFallbackLocation(){
  setStatus('Fetching approximate location from IP...');
  try{
    // use ipapi.co for free fallback
    const resp = await fetch('https://ipapi.co/json/');
    if(!resp.ok) throw new Error('IP lookup failed');
    const data = await resp.json();
    const lat = parseFloat(data.latitude || data.lat || 0);
    const lng = parseFloat(data.longitude || data.lon || data.longitude);
    if(!lat || !lng) throw new Error('IP location not available');
    const choice = confirm(`Approximate location found: ${lat.toFixed(4)}, ${lng.toFixed(4)} (low accuracy). Use this location for SOS?`);
    if(choice) await processLocation(lat,lng);
    else setStatus('Approximate location cancelled');
  }catch(e){ setStatus('IP fallback failed: '+(e.message||e)); setLastLocationError(e.message||String(e)); }
}

// hook button
const useApproxBtn = document.getElementById('useApproxBtn');
useApproxBtn?.addEventListener('click', ()=>{ ipFallbackLocation(); useApproxBtn.style.display='none'; });
async function findNearestHospital(lat,lng){
  try{
    const r = 5000;
    const query = `https://overpass-api.de/api/interpreter?data=[out:json];(node[amenity~"hospital|clinic|doctors"](around:${r},${lat},${lng}););out;`;
    const resp = await fetch(query); const data = await resp.json();
    if(data.elements && data.elements.length){
      let best = null; for(const el of data.elements){ const d = distanceKm(lat,lng,el.lat,el.lon); if(!best || d<best.distance) best={element:el,distance:d}; }
      document.getElementById('nearestHospital').textContent = `Nearest hospital: ${best.element.tags.name || 'Unnamed'} (${best.distance.toFixed(2)} km)`;
      return {name:best.element.tags.name||'Unnamed',distance:best.distance};
    }
  }catch(e){ }
  document.getElementById('nearestHospital').textContent = 'Nearest hospital: not found'; return {}; 
}
function distanceKm(lat1,lon1,lat2,lon2){ const R=6371; const dLat=(lat2-lat1)*Math.PI/180; const dLon=(lon2-lon1)*Math.PI/180; const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2); const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); return R*c; }
function startTimer(){ timerSeconds=0; timerBox.textContent='⏱ 0s'; clearInterval(window._ti); window._ti = setInterval(()=>{ timerSeconds++; timerBox.textContent=`⏱ ${timerSeconds}s`; },1000); }
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if(SpeechRecognition){ const recognition = new SpeechRecognition(); recognition.continuous=false; recognition.lang='en-US'; voiceBtn.addEventListener('click', ()=>{ try{ recognition.start(); setStatus('Listening... Say "help" or "sos"'); }catch(e){} }); recognition.onresult = (e)=>{ const t = e.results[0][0].transcript.toLowerCase(); if(t.includes('help')||t.includes('sos')){ sendSOS(); } }; }
let lastAccel = {x:null,y:null,z:null}; window.addEventListener('devicemotion', (e)=>{
  if(!shakeEnabled) return; const a=e.accelerationIncludingGravity; if(!a.x) return; if(lastAccel.x!==null){ const diff = Math.abs(a.x-lastAccel.x)+Math.abs(a.y-lastAccel.y)+Math.abs(a.z-lastAccel.z); if(diff>25){ setStatus('Shake detected'); sendSOS(); } } lastAccel={x:a.x,y:a.y,z:a.z}; });
shakeToggle.addEventListener('click', ()=>{ shakeEnabled = !shakeEnabled; shakeToggle.classList.toggle('active'); setStatus(shakeEnabled? 'Shake-to-alert enabled':'Shake-to-alert disabled'); });
const helps = {
  cpr:`\n🫀 CPR — Check responsiveness. Call emergency. 30 chest compressions then 2 breaths. Continue until help arrives.`,
  bleeding:`\n🩸 Severe bleeding — Apply direct pressure, elevate limb, use clean cloth. Do not remove embedded objects.`,
  unconscious:`\n😵 Unconscious — Check breathing. If breathing, put in recovery position. If not, start CPR.`,
  burns:`\n🔥 Burns — Cool with running water for 20 minutes. Do not use creams or break blisters.`
};
document.querySelectorAll('.card').forEach(c=>{ c.addEventListener('click', ()=> showHelp(c.dataset.help)); c.addEventListener('keypress', (e)=>{ if(e.key==='Enter') showHelp(c.dataset.help); }); });
function showHelp(k){ helpBox.textContent = helps[k] || '—'; setStatus('Showing first aid: '+k); }
function startBackgroundParticles(){
  if(window._bgInitialized) return; window._bgInitialized = true;
  // create neon blurred blobs only (no particle dots)
  const bg = document.getElementById('bg');
  if(bg){ ['blue','red','cyan'].forEach((cls,idx)=>{
    const div = document.createElement('div'); div.className = 'blob '+cls; div.style.left = (12 + idx*30)+'%'; div.style.top = (28 + idx*14)+'%'; div.style.width = (320 + idx*90)+'px'; div.style.height = (320 + idx*90)+'px'; div.style.opacity = 0.0; bg.appendChild(div);
    setTimeout(()=>div.classList.add('show'), 300 + idx*300);
  }); }

  // simple parallax for blobs
  let blobs = [];
  function updateBlobs(){ blobs = Array.from(document.querySelectorAll('.blob')); }
  updateBlobs();
  window.addEventListener('mousemove', (e)=>{ const cx = window.innerWidth/2, cy = window.innerHeight/2; blobs.forEach((b,idx)=>{ const rx = (e.clientX - cx)*(0.01*(idx+1)); const ry = (e.clientY - cy)*(0.008*(idx+1)); b.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`; }); });
  window.addEventListener('resize', updateBlobs);
  // respect reduced motion
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){ blobs.forEach(b=>{ b.style.transition='none'; }); }
}

function registerServiceWorker(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').then(()=>setStatus('Service Worker registered')).catch((err)=>{ setStatus('Service Worker failed: '+(err && err.message)); console.error('SW register failed', err); }); } else { setStatus('Service workers not supported'); } }

/* Diagnostics tool */
const diagBtn = document.getElementById('diagBtn');
const diagPanel = document.getElementById('diagPanel');
const diagOutput = document.getElementById('diagOutput');
const closeDiag = document.getElementById('closeDiag');

diagBtn?.addEventListener('click', runDiagnostics);
closeDiag?.addEventListener('click', ()=>{ diagPanel.style.display='none'; diagPanel.setAttribute('aria-hidden','true'); });

// Copy native testing steps to clipboard for easy use
const copyBtn = document.getElementById('copyNativeSteps');
const copyFeedback = document.getElementById('copyFeedback');
const nativeStepsText = `Native plugin testing steps:\n1) Install Node.js & npm on your development machine.\n2) Run 'npm install' in the project root.\n3) Install and sync plugins/platforms: 'npx cap sync'.\n4) Open Android Studio: 'npx cap open android' and run on an emulator/device.\nServe via HTTP/HTTPS when testing in a browser (e.g. 'npx http-server .') to avoid dynamic-import CORS errors.`;

copyBtn?.addEventListener('click', async ()=>{
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(nativeStepsText); }
    else { const ta = document.createElement('textarea'); ta.value = nativeStepsText; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    if(copyFeedback){ copyFeedback.textContent = 'Steps copied to clipboard'; copyFeedback.setAttribute('aria-hidden','false'); copyFeedback.classList.add('show'); setTimeout(()=>{ copyFeedback.classList.remove('show'); copyFeedback.setAttribute('aria-hidden','true'); },2500); }
  }catch(e){ if(copyFeedback){ copyFeedback.textContent = 'Copy failed'; copyFeedback.classList.add('show'); setTimeout(()=>{ copyFeedback.classList.remove('show'); copyFeedback.setAttribute('aria-hidden','true'); },2500); } }
});

// Native test button — tries to import the background-geolocation plugin and call getNativeBgLocation
const nativeTestBtn = document.getElementById('nativeTestBtn');
nativeTestBtn?.addEventListener('click', async ()=>{
  const outEl = document.getElementById('nativeTestOutput');
  diagPanel.style.display='block'; diagPanel.setAttribute('aria-hidden','false');
  outEl.style.display='block'; outEl.textContent = 'Running native test...';
  try{
    const platformNative = await isNativePlatform();
    outEl.textContent += '\nIs native platform: ' + platformNative;

    if(platformNative){
      // Only attempt plugin import when we are running as a native (Capacitor) app
      try{
        await import('@capacitor-community/background-geolocation');
        outEl.textContent += '\nBackgroundGeolocation plugin: available';
      }catch(e){ outEl.textContent += '\nBackgroundGeolocation plugin: NOT available ('+(e.message||e)+')'; }

      try{
        const loc = await getNativeBgLocation(8000);
        outEl.textContent += '\nNative location result:\n' + JSON.stringify(loc, null, 2).slice(0,2000);
      }catch(e){ outEl.textContent += '\nNative location failed: ' + (e.message || e); }
    } else {
      // Avoid dynamic import in web context (it can fail with a CORS/about:blank error). Provide helpful guidance instead.
      outEl.textContent += '\nSkipping plugin import: Not running in native (Capacitor) environment.';
      outEl.textContent += '\nTo test native plugins, run these steps on your development machine:\n 1) Ensure Node.js & npm are installed\n 2) Run `npm install` in the project root\ 3) Install/sync plugins and platforms (e.g. `npx cap sync`)\ 4) Open Android Studio: `npx cap open android` and run on an emulator or device.';
      outEl.textContent += '\nIf you are testing in a browser, serve the app via http(s) (e.g. `npx http-server .` or use Live Server). Dynamic imports from file:// or cross-origin contexts may fail with a CORS/about:blank error.';
    }
  }catch(e){ outEl.textContent += '\nTest error: ' + (e.message || e); }
});

async function runDiagnostics(){
  const lines = [];
  try{ lines.push('Time: '+new Date().toLocaleString()); }catch(e){}
  lines.push('Secure context: '+(location.protocol==='https:'||location.hostname==='localhost'));
  lines.push('Service Worker supported: '+('serviceWorker' in navigator));
  lines.push('Geolocation supported: '+('geolocation' in navigator));
  try{ const gperm = await navigator.permissions.query({name:'geolocation'}); lines.push('Geolocation permission: '+gperm.state); }catch(e){ lines.push('Geolocation permission: unknown'); }
  lines.push('SpeechRecognition supported: '+(window.SpeechRecognition || window.webkitSpeechRecognition ? 'yes' : 'no'));
  lines.push('Web Share API supported: '+(navigator.share ? 'yes' : 'no'));
  lines.push('Vibration supported: '+(navigator.vibrate ? 'yes' : 'no'));

  // Check if service worker is registered
  try{
    const regs = await navigator.serviceWorker.getRegistrations(); lines.push('Service worker registrations: '+regs.length);
  }catch(e){ lines.push('Could not enumerate service workers'); }

  // Basic network check
  lines.push('Online: '+navigator.onLine);
  lines.push('Saved contacts: '+(contacts && contacts.length ? contacts.join(', ') : 'none'));

  // Last send results
  if(window._lastSendResults && window._lastSendResults.length){ lines.push('\nLast send results:'); window._lastSendResults.forEach(s => lines.push(`  ${s.number} — ${s.status} (${s.method}${s.error?': '+s.error:''})`)); }

  // Last few console errors (captured)
  if(window._diagErrors && window._diagErrors.length){ lines.push('\nRecent errors:'); window._diagErrors.slice(-8).forEach(err => lines.push(err)); }

  diagOutput.textContent = lines.join('\n');
  diagPanel.style.display = 'block';
  diagPanel.setAttribute('aria-hidden','false');
}

// Capture uncaught errors and unhandled rejections for diagnostics
window._diagErrors = window._diagErrors || [];
window.addEventListener('error', (e) => {
  const msg = `Error: ${e.message} (${e.filename}:${e.lineno})`;
  window._diagErrors.push(msg);
  setStatus('Error: '+e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = `PromiseRejection: ${e.reason}`;
  window._diagErrors.push(msg);
  setStatus('Unhandled rejection');
});

function deactivateEmergency(){ emergencyActive=false; siren.pause(); siren.currentTime=0; clearInterval(window._ti); document.getElementById('lockScreen').style.display='none'; setStatus('Emergency cleared'); }
cancelBtn.addEventListener('click', deactivateEmergency);
shareBtn.addEventListener('click', async ()=>{ if(navigator.share){ navigator.share({title:'My Location',text:document.getElementById('coords').textContent}); setStatus('Shared'); } });
window.addEventListener('online', ()=>setStatus('Back online')); window.addEventListener('offline', ()=>setStatus('You are offline'));
function addNeonHandlers(){
  const btns = document.querySelectorAll('.sos, .voice, .shake, .fab, #saveContact, #cancelSOS, #diagBtn, #nativeTestBtn');
  btns.forEach(b => {
    b.addEventListener('click', ()=>{ b.classList.add('neon-press'); setTimeout(()=>b.classList.remove('neon-press'), 320); });
    b.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); b.classList.add('neon-press'); setTimeout(()=>b.classList.remove('neon-press'), 320); } });
  });
} 

window.addEventListener('keydown',(e)=>{ if(e.key==='s') beginCountdown(); if(e.key==='h') showHelp('cpr'); });

/* ---------------- Native plugin stubs (Android) ---------------- */
async function initNativePlugins(){
  // Push Notifications (Capacitor official)
  try{
    const mod = await import('@capacitor/push-notifications');
    const { PushNotifications } = mod;
    const perm = await PushNotifications.requestPermissions();
    if(perm.receive === 'granted'){
      await PushNotifications.register();
      PushNotifications.addListener('registration', token => setStatus('Push token: '+token.value));
      PushNotifications.addListener('pushNotificationReceived', n => setStatus('Push received: '+(n.notification?.title||n.notification?.body||'notification')));
    }
  }catch(e){ console.warn('Push plugin init skipped:',e); }

  // Background Geolocation (capacitor-community)
  try{
    const bg = await import('@capacitor-community/background-geolocation');
    const BackgroundGeolocation = bg.BackgroundGeolocation || bg.default || bg;
    // Example: add a watcher (configure options as needed)
    // BackgroundGeolocation.addWatcher({requestPermissions:true,backgroundTitle:'Tracking you',backgroundMessage:'Running in background'}, (loc,err)=>{ if(err) return console.error(err); setStatus('BG location: '+loc.latitude.toFixed(5)+','+loc.longitude.toFixed(5)); });
    setStatus('Background Geolocation available');
  }catch(e){ console.warn('BackgroundGeolocation not available:', e); }

  // Contacts access
  try{
    const cmod = await import('@capacitor-community/contacts');
    setStatus('Contacts plugin available');
  }catch(e){ console.warn('Contacts plugin not available:', e); }
}

// Helper to update the send status UI and diagnostics
function updateSendStatusUI(results){
  window._lastSendResults = results || [];
  const el = document.getElementById('sendStatus');
  if(el){ el.innerHTML = ''; results.forEach(r => { const li = document.createElement('li'); li.textContent = `${r.number} — ${r.status} (${r.method}${r.error?': '+r.error:''})`; el.appendChild(li); }); }
  // append a short summary to diagnostics
  window._diagErrors = window._diagErrors || [];
  window._diagErrors.push('SendResults: '+(results.map(r => `${r.number}:${r.status}`).join(', ')));
}

// Simple native SMS sender fallback (returns a Promise resolving with status)
function sendSmsNative(number, text){
  return new Promise((resolve) => {
    try{
      // Cordova SMS plugin path
      if(window.SMS && SMS.sendSMS){
        SMS.sendSMS(number, text, ()=> resolve({number,method:'cordova-sms',status:'sent'}), (err)=> resolve({number,method:'cordova-sms',status:'failed',error:String(err)}));
        return;
      }

      // Fallback: open SMS composer (cannot detect delivery reliably)
      try{ window.open(`sms:${number}?body=${encodeURIComponent(text)}`,'_blank'); resolve({number,method:'composer',status:'opened'}); }
      catch(e){ resolve({number,method:'composer',status:'failed',error:String(e)}); }
    }catch(e){ resolve({number,method:'unknown',status:'failed',error:String(e)}); }
  });
}

// Run init when app loads (safe to call on web; it will silently fail if plugins not installed)
initNativePlugins();

