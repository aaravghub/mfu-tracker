/* MFU sign-in stage: at dusk a Mallakhamb pole rises, a rope drops, a climber goes up each, the pole climber holds a flag
   and a yogi finishes in a pose. Flat SVG, animated with transform and opacity only (cheap on phones), about 3 seconds,
   once per visit. Tap the scene to replay. Reduced motion shows the finished scene. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seen = () => { try { return sessionStorage.getItem('mfu-intro') === '1'; } catch { return false; } };
  const mark = () => { try { sessionStorage.setItem('mfu-intro', '1'); } catch { /* private mode */ } };

  const scene = `
  <svg viewBox="0 0 1200 560" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A Mallakhamb pole and rope with athletes climbing them, and a yogi holding a pose at sunset">
    <rect width="1200" height="560" fill="#13213d"/>
    <rect y="170" width="1200" height="390" fill="#283d66"/>
    <rect y="300" width="1200" height="260" fill="#6b3b57"/>
    <rect y="390" width="1200" height="170" fill="#c4542a"/>
    <g class="i-cast"><g class="i-sun"><circle cx="600" cy="420" r="150" fill="#f59a45"/><circle cx="600" cy="420" r="104" fill="#ffc673"/></g></g>
    <path d="M0 448 Q160 418 320 440 T640 436 T960 442 T1200 426 V560 H0Z" fill="#2a1830"/>
    <rect y="470" width="1200" height="90" fill="#0b0f1a"/>
    <rect y="469" width="1200" height="2" fill="#ffb26b" opacity=".6"/>

    <g class="i-cast">
    <g class="i-pole" fill="#0b0f1a" stroke="#f08a45" stroke-width="1.5">
      <ellipse cx="300" cy="470" rx="58" ry="9"/>
      <path d="M290 470 V385 h20 V470Z M292 385 V300 h16 V385Z M293 300 V215 h14 V300Z M293.5 215 V150 Q293.5 124 300 120 Q306.5 124 306.5 150 V215Z"/>
    </g>

    <g class="i-rope">
      <path d="M862 0 L870 38 M938 0 L930 38" stroke="#0b0f1a" stroke-width="3"/>
      <rect x="850" y="36" width="100" height="10" rx="5" fill="#0b0f1a" stroke="#f08a45" stroke-width="1.5"/>
      <path d="M900 46 C893 100 907 150 900 205 S893 290 900 335" fill="none" stroke="#f3a560" stroke-width="9" stroke-linecap="round"/>
      <path d="M900 46 C893 100 907 150 900 205 S893 290 900 335" fill="none" stroke="#0b0f1a" stroke-width="5" stroke-linecap="round"/>
      <circle cx="900" cy="338" r="9" fill="#0b0f1a" stroke="#f08a45" stroke-width="1.5"/>
    </g>
    <g class="i-rope-climber" fill="#05070f" stroke="#05070f" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="909" cy="200" r="11" stroke="none"/>
      <path fill="none" stroke-width="24" d="M904 222 L906 276"/><path fill="none" d="M900 170 L913 198 L904 222 M901 190 L893 208 L904 222"/><path fill="none" stroke-width="15" d="M906 276 L884 312 L880 346 M906 276 L950 292 L1000 286"/>
    </g>

    <g class="i-pole-climber" fill="#05070f" stroke="#05070f" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <g class="i-flag">
        <circle cx="326" cy="167" r="12.5" stroke="none"/>
        <path fill="none" stroke-width="24" d="M342 171 L440 174"/><path fill="none" stroke-width="12" d="M300 150 L340 163 M300 192 L338 181"/><path fill="none" stroke-width="15" d="M440 174 L522 166 M440 174 L516 184"/>
      </g>
    </g>

    <g class="i-yogi" fill="#05070f" stroke="#05070f" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <g class="i-pose-a"><circle cx="600" cy="276" r="12" stroke="none"/><path fill="none" stroke-width="26" d="M600 298 L600 366"/><path fill="none" stroke-width="12" d="M600 306 L584 338 L600 328 M600 306 L616 338 L600 328"/><path fill="none" stroke-width="16" d="M600 366 L593 470 M600 366 L607 470"/></g>
      <g class="i-pose-b"><circle cx="600" cy="262" r="12" stroke="none"/><path fill="none" stroke-width="26" d="M600 284 L600 360"/><path fill="none" stroke-width="12" d="M600 292 L574 262 L600 212 M600 292 L626 262 L600 212"/><path fill="none" stroke-width="16" d="M600 360 L598 468 M600 360 L560 392 L597 418"/></g>
    </g>
    </g>
  </svg>
  <p class="i-tag">Strength, balance and discipline, tracked class by class.</p>`;

  window.mfuStage = inner => {
    const mode = reduce || seen() ? 'done' : 'play';
    mark();
    return `<div class="auth-stage"><div class="mfu-intro ${mode}" title="Tap to replay">${scene}</div>
      <div class="login card"><img class="login-logo" src="/mfu-logo.png" alt="Mallakhamb Federation USA logo" width="64" height="64">${inner}</div></div>`;
  };

  document.addEventListener('click', e => {
    const box = e.target.closest('.mfu-intro');
    if (!box || reduce) return;
    box.classList.remove('play', 'done'); void box.offsetWidth; box.classList.add('play');
  });
})();
