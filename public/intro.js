/* MFU login stage: silhouettes assemble a Mallakhamb pole + rope, a yogi strikes a pose, then everyone locks into formation.
   Pure SVG + CSS (see glass.css). Plays once per page load; later re-renders (tab switches, logout) show the finished scene. Click the scene to replay. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let played = false;

  const sparks = Array.from({ length: 16 }, (_, i) => {
    const x = 60 + ((i * 197) % 1080), y = 40 + ((i * 131) % 380), r = 1.4 + (i % 3) * .8;
    return `<circle cx="${x}" cy="${y}" r="${r}" style="--i:${i}"/>`;
  }).join('');

  const scene = `
  <svg viewBox="0 0 1200 560" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Silhouettes assembling a Mallakhamb pole and rope, then a yoga pose and a final formation">
    <defs>
      <linearGradient id="mfu-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1130"/><stop offset=".5" stop-color="#4a2447"/><stop offset=".82" stop-color="#d9552b"/><stop offset="1" stop-color="#ff9a4d"/></linearGradient>
      <radialGradient id="mfu-sun"><stop offset="0" stop-color="#fff0c4"/><stop offset=".45" stop-color="#ffb35e"/><stop offset="1" stop-color="#f26b21" stop-opacity="0"/></radialGradient>
      <filter id="mfu-rim" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#ffc37e" flood-opacity=".95"/></filter>
    </defs>
    <rect width="1200" height="560" fill="url(#mfu-sky)"/>
    <g class="sparks" fill="#ffe2b8">${sparks}</g>
    <g class="sun"><circle cx="600" cy="330" r="270" fill="url(#mfu-sun)"/><circle cx="600" cy="330" r="150" fill="#ffd08a" opacity=".92"/></g>
    <path d="M0 440 Q150 400 300 430 T600 425 T900 430 T1200 410 V560 H0Z" fill="#150f24" opacity=".7"/>
    <rect y="470" width="1200" height="90" fill="#070a14"/>
    <rect y="469" width="1200" height="2" fill="#ffa55a" opacity=".55"/>

    <ellipse class="burst" cx="600" cy="472" rx="210" ry="26" fill="none" stroke="#ffc07a" stroke-width="3"/>
    <ellipse class="burst b2" cx="600" cy="472" rx="210" ry="26" fill="none" stroke="#fff0c4" stroke-width="1.5"/>
    <circle class="aura" cx="600" cy="342" r="170" fill="none" stroke="#ffd9a0" stroke-width="1.4" stroke-dasharray="3 11"/>

    <!-- POLE -->
    <g filter="url(#mfu-rim)" fill="#080c18" stroke="#ff9a52" stroke-width="1.4">
      <ellipse class="pole-base" cx="300" cy="470" rx="58" ry="9"/>
      <rect class="pseg" style="--i:0" x="290" y="385" width="20" height="85" rx="2"/>
      <rect class="pseg" style="--i:1" x="292" y="300" width="16" height="85"/>
      <rect class="pseg" style="--i:2" x="293" y="215" width="14" height="85"/>
      <path class="pseg" style="--i:3" d="M293.5 215 V150 Q293.5 124 300 120 Q306.5 124 306.5 150 V215Z"/>
    </g>
    <g stroke="#ffd9a0" stroke-width="3" stroke-linecap="round"><path class="joint" style="--i:0" d="M288 385h24"/><path class="joint" style="--i:1" d="M290 300h20"/><path class="joint" style="--i:2" d="M291 215h18"/></g>

    <!-- ROPE -->
    <g class="rope-sway">
      <path d="M862 38 L846 -10 M938 38 L954 -10" stroke="#080c18" stroke-width="3" fill="none"/>
      <g filter="url(#mfu-rim)"><rect class="rope-hook" x="850" y="36" width="100" height="10" rx="5" fill="#080c18" stroke="#ff9a52" stroke-width="1.4"/></g>
      <path class="rope-line" pathLength="1" d="M900 46 C893 100 907 150 900 205 S893 290 900 335" fill="none" stroke="#ffb06a" stroke-width="9" stroke-linecap="round"/>
      <path class="rope-line r2" pathLength="1" d="M900 46 C893 100 907 150 900 205 S893 290 900 335" fill="none" stroke="#080c18" stroke-width="5.5" stroke-linecap="round"/>
      <circle class="knot" cx="900" cy="338" r="9" fill="#080c18" stroke="#ff9a52" stroke-width="1.4"/>
      <g class="rope-climber" filter="url(#mfu-rim)" fill="#05070f" stroke="#05070f" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="909" cy="200" r="11" stroke="none"/>
        <path fill="none" stroke-width="24" d="M904 222 L906 276"/><path fill="none" stroke-width="12" d="M900 170 L913 198 L904 222 M901 190 L893 208 L904 222"/><path fill="none" stroke-width="15" d="M906 276 L884 312 L880 346"/>
        <path class="rope-leg" fill="none" stroke-width="15" d="M906 276 L950 292 L1000 286"/>
      </g>
    </g>

    <!-- YOGI -->
    <g class="yogi" filter="url(#mfu-rim)" fill="#05070f" stroke="#05070f" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <g class="pose-a"><circle cx="600" cy="276" r="12" stroke="none"/><path fill="none" stroke-width="26" d="M600 298 L600 366"/><path fill="none" stroke-width="12" d="M600 306 L584 338 L600 328 M600 306 L616 338 L600 328"/><path fill="none" stroke-width="16" d="M600 366 L593 470 M600 366 L607 470"/></g>
      <g class="pose-b"><g class="breathe"><circle cx="600" cy="262" r="12" stroke="none"/><path fill="none" stroke-width="26" d="M600 284 L600 360"/><path fill="none" stroke-width="12" d="M600 292 L574 262 L600 212 M600 292 L626 262 L600 212"/><path fill="none" stroke-width="16" d="M600 360 L598 468 M600 360 L560 392 L597 418"/></g></g>
    </g>

    <!-- POLE ATHLETE: climbs, then flies into a human flag -->
    <g class="flag-climb" filter="url(#mfu-rim)" fill="#05070f" stroke="#05070f" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <g class="flag-body">
        <circle cx="326" cy="167" r="12.5" stroke="none"/>
        <path fill="none" stroke-width="24" d="M342 171 L440 174"/><path fill="none" stroke-width="12" d="M300 150 L340 163 M300 192 L338 181"/><path fill="none" stroke-width="15" d="M440 174 L522 166 M440 174 L516 184"/>
      </g>
    </g>
  </svg>
  <div class="intro-tag"><b>MFU</b><i></i><span>MALLAKHAMB FEDERATION USA</span></div>
  <div class="intro-foot"><span>STRENGTH</span><i></i><span>BALANCE</span><i></i><span>DISCIPLINE</span></div>`;

  window.mfuStage = function (inner) {
    const mode = played || reduce ? 'done' : 'play';
    played = true;
    return `<div class="auth-stage ${mode}"><div class="mfu-intro" title="Click to replay">${scene}</div>
      <div class="login card"><img class="login-logo" src="/mfu-logo.png" alt="Mallakhamb Federation USA logo">${inner}</div></div>`;
  };

  // Replay on click (not on reduced motion).
  document.addEventListener('click', e => {
    const box = e.target.closest('.mfu-intro');
    if (!box || reduce) return;
    const stage = box.closest('.auth-stage');
    stage.classList.remove('play', 'done'); box.innerHTML = scene; void stage.offsetWidth; stage.classList.add('play');
  });
})();
