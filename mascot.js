// mascot.js — SVOCAt mascot SVG factory (vanilla JS)
// Source: docs/UX guide/mascot.jsx (v2)
// 사용: const svg = createMascot({ size: 22, expression: 'happy' });
//      el.appendChild(svg);

(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let _uid = 0;
  const nextId = () => `m-${++_uid}`;

  const MASCOT_GRADIENT_STOPS = [
    { offset: '0%',   color: 'oklch(0.62 0.16 230)' },
    { offset: '20%',  color: 'oklch(0.6 0.2 280)'   },
    { offset: '40%',  color: 'oklch(0.65 0.18 25)'  },
    { offset: '60%',  color: 'oklch(0.7 0.15 85)'   },
    { offset: '80%',  color: 'oklch(0.7 0.15 155)'  },
    { offset: '100%', color: 'oklch(0.62 0.16 230)' },
  ];

  const CAT_PATH = `
    M -34 -8
    L -28 -36
    L -14 -22
    Q 0 -28 14 -22
    L 28 -36
    L 34 -8
    Q 38 14 22 28
    Q 0 38 -22 28
    Q -38 14 -34 -8
    Z
  `;

  function createSvgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      el.setAttribute(k, String(v));
    }
    return el;
  }

  function appendEye(parent, cx, kind) {
    if (kind === 'arc') {
      parent.appendChild(createSvgEl('path', {
        d: `M ${cx - 5} 0 Q ${cx} 5 ${cx + 5} 0`,
        stroke: 'white',
        'stroke-width': '3.6',
        fill: 'none',
        'stroke-linecap': 'round',
      }));
    } else {
      parent.appendChild(createSvgEl('ellipse', {
        cx, cy: 0, rx: '3.2', ry: '4.2', fill: 'white',
      }));
    }
  }

  function createMascot({ size = 128, expression = 'happy', showBlocks = false, variant = 'ring' } = {}) {
    const ringId = nextId();
    const innerId = nextId();

    const svg = createSvgEl('svg', {
      viewBox: '-64 -64 128 128',
      width: size,
      height: size,
      'aria-label': 'SVOCAt mascot',
    });

    const defs = createSvgEl('defs');

    const linearGrad = createSvgEl('linearGradient', { id: ringId, x1: '0', y1: '0', x2: '1', y2: '1' });
    for (const s of MASCOT_GRADIENT_STOPS) {
      linearGrad.appendChild(createSvgEl('stop', { offset: s.offset, 'stop-color': s.color }));
    }
    defs.appendChild(linearGrad);

    const radialGrad = createSvgEl('radialGradient', { id: innerId, cx: '50%', cy: '40%', r: '65%' });
    radialGrad.appendChild(createSvgEl('stop', { offset: '0%', 'stop-color': 'oklch(0.32 0.05 270)' }));
    radialGrad.appendChild(createSvgEl('stop', { offset: '100%', 'stop-color': 'oklch(0.2 0.04 270)' }));
    defs.appendChild(radialGrad);

    svg.appendChild(defs);

    const eyeProps = expression === 'wink' ? { left: 'arc', right: 'dot' }
      : expression === 'smile' ? { left: 'arc', right: 'arc' }
      : { left: 'dot', right: 'dot' };

    if (variant === 'ring') {
      svg.appendChild(createSvgEl('path', { d: CAT_PATH, fill: `url(#${ringId})` }));
      svg.appendChild(createSvgEl('path', {
        d: CAT_PATH,
        fill: `url(#${innerId})`,
        transform: 'translate(0 4) scale(0.82)',
      }));

      const eyeG = createSvgEl('g', { transform: 'translate(0 2) scale(0.82)' });
      appendEye(eyeG, -12, eyeProps.left);
      appendEye(eyeG, 12, eyeProps.right);
      svg.appendChild(eyeG);

      svg.appendChild(createSvgEl('path', {
        d: 'M -3 6 Q 0 9 3 6',
        stroke: 'white',
        'stroke-width': '2.4',
        fill: 'none',
        'stroke-linecap': 'round',
        transform: 'translate(0 4) scale(0.82)',
      }));
    } else if (variant === 'flat') {
      svg.appendChild(createSvgEl('path', { d: CAT_PATH, fill: `url(#${ringId})` }));
      const eyeG = createSvgEl('g', { transform: 'translate(0 -2)' });
      appendEye(eyeG, -12, eyeProps.left);
      appendEye(eyeG, 12, eyeProps.right);
      svg.appendChild(eyeG);
      svg.appendChild(createSvgEl('path', {
        d: 'M -4 8 Q 0 12 4 8',
        stroke: 'white',
        'stroke-width': '3',
        fill: 'none',
        'stroke-linecap': 'round',
      }));
    }

    if (showBlocks) {
      const dotsG = createSvgEl('g', { transform: 'translate(0 52)' });
      const dots = [
        { x: -20, color: 'oklch(0.62 0.16 230)' },
        { x: -10, color: 'oklch(0.65 0.18 25)' },
        { x: 0,   color: 'oklch(0.7 0.15 155)' },
        { x: 10,  color: 'oklch(0.7 0.15 85)' },
        { x: 20,  color: 'oklch(0.65 0.16 350)' },
      ];
      for (const d of dots) {
        dotsG.appendChild(createSvgEl('circle', { cx: d.x, cy: 0, r: 3, fill: d.color }));
      }
      svg.appendChild(dotsG);
    }

    return svg;
  }

  // ─── 앱 아이콘 (라운드 사각형 + 마스코트) ───
  // 스토어 아이콘, 확장 아이콘 PNG 생성용
  function createMascotIcon({ size = 128 } = {}) {
    const bgId = nextId();
    const ringId = nextId();

    const svg = createSvgEl('svg', {
      viewBox: '0 0 128 128',
      width: size, height: size,
      xmlns: SVG_NS,
    });

    const defs = createSvgEl('defs');

    const bgGrad = createSvgEl('linearGradient', { id: bgId, x1: '0', y1: '0', x2: '1', y2: '1' });
    bgGrad.appendChild(createSvgEl('stop', { offset: '0%',   'stop-color': 'oklch(0.97 0.01 75)' }));
    bgGrad.appendChild(createSvgEl('stop', { offset: '100%', 'stop-color': 'oklch(0.94 0.018 75)' }));
    defs.appendChild(bgGrad);

    const ringGrad = createSvgEl('linearGradient', { id: ringId, x1: '0', y1: '0', x2: '1', y2: '1' });
    ringGrad.appendChild(createSvgEl('stop', { offset: '0%',   'stop-color': 'oklch(0.62 0.16 230)' }));
    ringGrad.appendChild(createSvgEl('stop', { offset: '25%',  'stop-color': 'oklch(0.6 0.2 280)' }));
    ringGrad.appendChild(createSvgEl('stop', { offset: '55%',  'stop-color': 'oklch(0.65 0.18 25)' }));
    ringGrad.appendChild(createSvgEl('stop', { offset: '80%',  'stop-color': 'oklch(0.7 0.15 85)' }));
    ringGrad.appendChild(createSvgEl('stop', { offset: '100%', 'stop-color': 'oklch(0.7 0.15 155)' }));
    defs.appendChild(ringGrad);

    svg.appendChild(defs);

    // 배경 (라운드 사각형)
    svg.appendChild(createSvgEl('rect', {
      x: 0, y: 0, width: 128, height: 128,
      rx: 28, fill: `url(#${bgId})`,
    }));

    // 마스코트 그룹 (중앙 + 약간 확대)
    const g = createSvgEl('g', { transform: 'translate(64 64) scale(1.05)' });
    g.appendChild(createSvgEl('path', { d: CAT_PATH, fill: `url(#${ringId})` }));
    g.appendChild(createSvgEl('path', {
      d: CAT_PATH,
      fill: 'oklch(0.22 0.04 270)',
      transform: 'translate(0 4) scale(0.82)',
    }));

    // 눈
    const eyeG = createSvgEl('g', { transform: 'translate(0 2) scale(0.82)' });
    eyeG.appendChild(createSvgEl('ellipse', { cx: -12, cy: 0, rx: '3.4', ry: '4.6', fill: 'white' }));
    eyeG.appendChild(createSvgEl('ellipse', { cx: 12,  cy: 0, rx: '3.4', ry: '4.6', fill: 'white' }));
    g.appendChild(eyeG);

    svg.appendChild(g);
    return svg;
  }

  window.createMascot = createMascot;
  window.createMascotIcon = createMascotIcon;
})();
