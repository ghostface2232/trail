/**
 * 오프스크린 Canvas 2D 텍스트 렌더링 (자동 줄바꿈 + 엔터)
 */

let canvas, ctx;

export function createTextLayer(width, height) {
  canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  ctx = canvas.getContext('2d');
}

function wrapLines(text, maxWidth) {
  // 엔터로 먼저 분리
  const paragraphs = text.split('\n');
  const lines = [];

  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    const words = para.split(/( +)/); // 공백도 보존
    let current = '';
    for (const word of words) {
      const test = current + word;
      if (ctx.measureText(test).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = word.trimStart();
      } else {
        current = test;
      }
      // 단어 하나가 maxWidth 초과 시 글자 단위 분할
      while (ctx.measureText(current).width > maxWidth) {
        let fit = '';
        for (const ch of current) {
          if (ctx.measureText(fit + ch).width > maxWidth) break;
          fit += ch;
        }
        if (!fit) break;
        lines.push(fit);
        current = current.slice(fit.length);
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

export function renderText(textItems, time) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!textItems || textItems.length === 0) return;

  const isMobile = canvas.width < canvas.height;
  const fontSize = Math.round(isMobile ? canvas.width * 0.26 : canvas.width * 0.13);
  ctx.font = `600 ${fontSize}px SFProKR, sans-serif`;
  ctx.letterSpacing = `${-fontSize * 0.03}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  const padding = canvas.width * 0.05;
  const maxWidth = canvas.width - padding * 2;
  const lineHeight = fontSize * 1.2;

  const text = textItems.join('');
  const lines = wrapLines(text, maxWidth);

  const totalHeight = lines.length * lineHeight;
  const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;
  const centerX = canvas.width / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], centerX, startY + i * lineHeight);
  }
}

export function getCanvas() {
  return canvas;
}

export function resize(width, height) {
  canvas.width = width;
  canvas.height = height;
}
