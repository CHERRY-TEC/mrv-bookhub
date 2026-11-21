import * as THREE from 'three';

/**
 * Canvas-generated textures for the 3D shelf (no external assets needed).
 *
 * Style: classic cloth-bound library books — solid colour, gold foil frame,
 * serif title with a diamond divider, italic gold author, "MRV PRESS" imprint.
 * When a book is opened the inner pages carry the real catalogue details.
 */

const SERIF = 'Georgia, "Times New Roman", serif';
const CREAM = 'rgba(247, 239, 220, 0.97)';
const GOLD = 'rgba(231, 205, 148, 0.95)';   // foil frame / rules
const GOLD_TEXT = 'rgba(219, 181, 108, 0.96)'; // italic author on cover
const INK = '#33210f';
const INK_SOFT = '#6b4a2a';
const PAPER = '#f4ead2';
const PAPER_GOLD = '#a8741f';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/);
  let line = '';
  let lineNo = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineNo * lineHeight);
      line = words[i];
      lineNo++;
      if (lineNo >= maxLines) { line = ''; break; }
    } else {
      line = test;
    }
  }
  if (line && lineNo < maxLines) {
    ctx.fillText(line, x, y + lineNo * lineHeight);
    lineNo++;
  }
  return y + lineNo * lineHeight;
}

/** Break text into an array of lines that fit maxWidth. */
function layoutLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) { line = ''; break; }
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [String(text || '')];
}

/** Draw text with letter-spacing, centred on cx (used for "MRV PRESS"). */
function drawTracked(ctx, text, cx, cy, tracking) {
  const chars = Array.from(String(text));
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, cy);
    x += widths[i] + tracking;
  });
  ctx.textAlign = prevAlign;
}

/** Draw text with letter-spacing, left-aligned from x (used for page headings). */
function drawTrackedLeft(ctx, text, x, y, tracking) {
  let cx = x;
  for (const ch of Array.from(String(text))) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

/* ------------------------------------------------------------------ */
/* Spine — vertical text read top-to-bottom, foil rules top & bottom   */
/* ------------------------------------------------------------------ */
export function makeSpineTexture({ title, author, color }) {
  const W = 160;
  const H = 640;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);

  // Cloth shading across the rounded spine
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.03)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Double hairline rules at head and foot
  const rule = (y, w) => {
    ctx.strokeStyle = 'rgba(240, 226, 196, 0.85)';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(W - 14, y);
    ctx.stroke();
  };
  rule(24, 3);
  rule(34, 1.5);
  rule(H - 34, 1.5);
  rule(H - 24, 3);

  const rawTitle = String(title || '').trim() || 'Untitled';
  const rawAuthor = String(author || '').trim();

  // Fit the title: one line if it works, else two columns (first on the right)
  const zoneTop = 56;
  const zoneBottom = 432;
  const zoneLen = zoneBottom - zoneTop;
  const zoneMid = (zoneTop + zoneBottom) / 2;

  ctx.font = `bold 100px ${SERIF}`;
  const w100 = ctx.measureText(rawTitle).width || 1;
  let size = Math.min(74, (zoneLen / w100) * 100);
  let columns;
  if (size >= 46) {
    columns = [rawTitle];
  } else {
    const words = rawTitle.split(/\s+/);
    if (words.length < 2) {
      columns = [rawTitle];
    } else {
      let best = 1;
      let bestDiff = Infinity;
      for (let i = 1; i < words.length; i++) {
        const left = words.slice(0, i).join(' ');
        const right = words.slice(i).join(' ');
        const diff = Math.abs(ctx.measureText(left).width - ctx.measureText(right).width);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      const left = words.slice(0, best).join(' ');
      const right = words.slice(best).join(' ');
      const widest = Math.max(
        ctx.measureText(left).width,
        ctx.measureText(right).width
      ) || 1;
      size = Math.max(30, Math.min(58, (zoneLen / widest) * 100));
      columns = right ? [left, right] : [rawTitle];
    }
  }

  // Draw a line of vertical text; cx/cy is its centre on the canvas.
  // rotate(+90°): reading top-to-bottom with glyph tops facing right.
  const drawLine = (text, cx, cy, font, fill) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 2);
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  ctx.fillStyle = CREAM;
  if (columns.length === 1) {
    drawLine(columns[0], W / 2, zoneMid, `bold ${size}px ${SERIF}`, CREAM);
  } else {
    const lh = size * 1.06;
    // Line 1 (first read) sits right, line 2 to its left
    drawLine(columns[0], W / 2 + lh / 2, zoneMid - lh / 2, `bold ${size}px ${SERIF}`, CREAM);
    drawLine(columns[1], W / 2 - lh / 2, zoneMid + lh / 2, `bold ${size}px ${SERIF}`, CREAM);
  }

  if (rawAuthor) {
    ctx.font = `italic 100px ${SERIF}`;
    const aw = ctx.measureText(rawAuthor).width || 1;
    const asize = Math.max(14, Math.min(26, (360 / aw) * 100));
    drawLine(rawAuthor, W / 2, 486, `italic ${asize}px ${SERIF}`, 'rgba(246, 235, 211, 0.82)');
  }

  // Imprint near the foot
  ctx.save();
  ctx.translate(W / 2, 556);
  ctx.rotate(Math.PI / 2);
  ctx.font = `bold 15px ${SERIF}`;
  ctx.fillStyle = 'rgba(246, 235, 211, 0.8)';
  ctx.textBaseline = 'middle';
  drawTracked(ctx, 'MRV PRESS', 0, 0, 2.5);
  ctx.restore();

  return finish(c);
}

/* ------------------------------------------------------------------ */
/* Front cover — foil double frame, serif title, diamond divider       */
/* ------------------------------------------------------------------ */
export function makeCoverTexture({ title, author, color }) {
  const W = 512;
  const H = 704;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  // Cloth colour with a soft top-light gradient
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.13)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  grad.addColorStop(1, 'rgba(0,0,0,0.24)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Foil double frame (square corners)
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3.5;
  ctx.strokeRect(26.5, 26.5, W - 53, H - 53);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(41.5, 41.5, W - 83, H - 83);

  const rawTitle = String(title || '').trim() || 'Untitled';

  // Title: wrap to at most 2 lines (shrink once if needed)
  let size = 58;
  ctx.font = `bold ${size}px ${SERIF}`;
  let lines = layoutLines(ctx, rawTitle, W - 150, 3);
  if (lines.length > 2) {
    size = 48;
    ctx.font = `bold ${size}px ${SERIF}`;
    lines = layoutLines(ctx, rawTitle, W - 150, 3);
  }

  const blockMid = 236;
  const lh = size * 1.16;
  ctx.font = `bold ${size}px ${SERIF}`;
  ctx.fillStyle = CREAM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    const y = blockMid + (i - (lines.length - 1) / 2) * lh;
    ctx.fillText(ln, W / 2, y);
  });

  // Diamond divider below the title
  const divY = blockMid + ((lines.length - 1) / 2) * lh + size * 0.5 + 44;
  ctx.strokeStyle = GOLD;
  ctx.fillStyle = GOLD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 92, divY);
  ctx.lineTo(W / 2 - 16, divY);
  ctx.moveTo(W / 2 + 16, divY);
  ctx.lineTo(W / 2 + 92, divY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2, divY - 8);
  ctx.lineTo(W / 2 + 8, divY);
  ctx.lineTo(W / 2, divY + 8);
  ctx.lineTo(W / 2 - 8, divY);
  ctx.closePath();
  ctx.fill();

  // Italic gold author
  const authorText = String(author || '').trim();
  if (authorText) {
    ctx.font = `italic 30px ${SERIF}`;
    if (ctx.measureText(authorText).width > 350) {
      ctx.font = `italic 24px ${SERIF}`;
    }
    ctx.fillStyle = GOLD_TEXT;
    ctx.fillText(authorText, W / 2, divY + 58);
  }

  // Imprint near the foot
  ctx.font = `bold 20px ${SERIF}`;
  ctx.fillStyle = CREAM;
  ctx.textBaseline = 'middle';
  drawTracked(ctx, 'MRV PRESS', W / 2, H - 88, 4);

  return finish(c);
}

/* ------------------------------------------------------------------ */
/* Inside pages shown while the book is open in your hands             */
/* ------------------------------------------------------------------ */

function paperBase(ctx, W, H, gutterSide) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const x0 = gutterSide === 'right' ? W : 0;
  const x1 = gutterSide === 'right' ? W - 130 : 130;
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, 'rgba(70,40,10,0.36)');
  grad.addColorStop(1, 'rgba(70,40,10,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

/**
 * One of the 6 printed pages of an open book (pages 0..5 = 3 spreads).
 * Page 0/1 = current front/back matter, 2..5 = extended catalogue content.
 * The two sides of a physical leaf share a book/page index via `bookPage`.
 */
export function makePageTexture(book, index) {
  switch (index) {
    case 0: return makeLeftPageTexture(book);
    case 1: return makeRightPageTexture(book);
    default: return makeExtraPageTexture(book, index);
  }
}

/** Extended content pages (2..5) — course info, how-to, policies, colophon. */
export function makeExtraPageTexture(book, index) {
  const W = 512;
  const H = 704;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  // Left-hand faces have the gutter on the right; right-hand on the left
  paperBase(ctx, W, H, index % 2 === 0 ? 'right' : 'left');

  const listing = book.listing || null;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const heading = (text, y) => {
    ctx.font = `bold 17px ${SERIF}`;
    ctx.fillStyle = PAPER_GOLD;
    drawTrackedLeft(ctx, text, 54, y, 2.5);
  };
  const rule = (y) => {
    ctx.strokeStyle = 'rgba(168,116,31,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(54, y); ctx.lineTo(W - 54, y); ctx.stroke();
  };

  if (index === 2) {
    // Catalogue card: ISBN, edition, department, course
    heading('CATALOGUE DETAILS', 96);
    rule(116);
    ctx.font = `21px ${SERIF}`;
    ctx.fillStyle = INK;
    let y = 162;
    const rows = [
      ['Title', book.title],
      ['Author', book.author],
      ['Edition', listing?.edition || '—'],
      ['ISBN', listing?.isbn || '—'],
      ['Course', listing?.course_code || '—'],
      ['Department', listing?.department_name || 'MRV College'],
    ];
    for (const [k, v] of rows) {
      ctx.fillStyle = PAPER_GOLD;
      ctx.font = `bold 19px ${SERIF}`;
      ctx.fillText(`${k}`, 54, y);
      ctx.fillStyle = INK;
      ctx.font = `21px ${SERIF}`;
      y = wrapText(ctx, String(v || '—'), 190, y, W - 244, 28, 2) + 34;
    }
  } else if (index === 3) {
    // How borrowing works / steps
    heading(listing?.listing_type === 'sell' ? 'PLACING AN ORDER' : 'BORROWING STEPS', 96);
    rule(116);
    ctx.font = `21px ${SERIF}`;
    ctx.fillStyle = INK;
    let y = 166;
    const steps = listing?.listing_type === 'sell'
      ? ['Browse the marketplace and pick a copy.',
         'Check the price and available stock.',
         'Place an order — checkout is simulated.',
         'Collect from the approved vendor.']
      : ['Find a book and send a borrow request.',
         'Wait for the owner to approve it.',
         'Hand over the book on the agreed date.',
         'Return it by the due date — or request more time.'];
    steps.forEach((s, i) => {
      ctx.fillStyle = PAPER_GOLD;
      ctx.font = `bold 21px ${SERIF}`;
      ctx.fillText(`${i + 1}.`, 54, y);
      ctx.fillStyle = INK;
      ctx.font = `21px ${SERIF}`;
      y = wrapText(ctx, s, 92, y, W - 146, 28, 3) + 34;
    });
  } else if (index === 4) {
    // Good-to-know / policies
    heading('GOOD TO KNOW', 96);
    rule(116);
    ctx.font = `21px ${SERIF}`;
    ctx.fillStyle = INK;
    let y = 166;
    const notes = [
      'Borrowing is free between students — no payment needed.',
      'Extensions need the owner’s approval before the due date.',
      'Overdue reminders are sent once a day, never duplicated.',
      'Book condition is recorded when listed, not when returned.',
      'Your data stays on the college server — never sold or shared.',
    ];
    for (const n of notes) {
      ctx.fillStyle = PAPER_GOLD;
      ctx.fillText('•', 54, y);
      ctx.fillStyle = INK;
      y = wrapText(ctx, n, 82, y, W - 136, 28, 3) + 22;
    }
  } else {
    // Colophon / closing note
    heading('ABOUT MRV BOOKHUB', 96);
    rule(116);
    ctx.font = `22px ${SERIF}`;
    ctx.fillStyle = INK;
    let y = 172;
    y = wrapText(ctx,
      'MRV BookHub is a college book exchange and digital library built for students, faculty, librarians and vendors. Every copy on these shelves is part of a small, carefully maintained collection.',
      54, y, W - 108, 32, 6) + 46;
    ctx.fillStyle = PAPER_GOLD;
    ctx.font = `italic 24px ${SERIF}`;
    ctx.fillText('“A book in hand is worth a hundred on a shelf.”', 54, y + 20);
    ctx.fillStyle = INK_SOFT;
    ctx.font = `italic 18px ${SERIF}`;
    ctx.fillText('— The MRV Library', 54, y + 54);
  }

  // Running footer with page number
  ctx.font = `italic 16px ${SERIF}`;
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = 'center';
  ctx.fillText(`— ${index + 1} —`, W / 2, H - 46);
  ctx.textAlign = 'left';
  return finish(c);
}

/** Left page = inside of the front cover: who / what / price. */
export function makeLeftPageTexture(book) {
  const W = 512;
  const H = 704;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  paperBase(ctx, W, H, 'right');

  const listing = book.listing || null;
  const title = String(book.title || 'Untitled');
  const author = String(book.author || 'MRV Press');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Title
  ctx.font = `bold 42px ${SERIF}`;
  ctx.fillStyle = INK;
  let lines = layoutLines(ctx, title, W - 90, 3);
  let size = 42;
  if (lines.length > 2) {
    size = 34;
    ctx.font = `bold ${size}px ${SERIF}`;
    lines = layoutLines(ctx, title, W - 90, 3);
  }
  const lh = size * 1.18;
  let y = 96;
  lines.forEach((ln) => { ctx.fillText(ln, 54, y); y += lh; });

  // by Author
  ctx.font = `italic 24px ${SERIF}`;
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(`by ${author}`, 54, y + 14);
  y += 44;

  // Gold rule
  ctx.strokeStyle = PAPER_GOLD;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54, y);
  ctx.lineTo(W - 54, y);
  ctx.stroke();
  y += 54;

  // Tag pills
  const tags = [];
  if (listing) {
    if (listing.listing_type === 'both') tags.push('Borrow or Buy');
    else if (listing.listing_type === 'borrow') tags.push('Borrow');
    else if (listing.listing_type === 'sell') tags.push('Sell');
    if (listing.book_condition) {
      tags.push(String(listing.book_condition).replace(/^\w/, (m) => m.toUpperCase()));
    }
    if (listing.price != null) tags.push(`₹${Number(listing.price).toFixed(0)}`);
    else if (listing.max_borrow_days) tags.push(`up to ${listing.max_borrow_days} days`);
  } else if (book.source === 'api') {
    tags.push('Catalogue');
  } else {
    tags.push('Display copy');
  }

  ctx.font = `bold 20px ${SERIF}`;
  let x = 54;
  for (const tag of tags) {
    const tw = ctx.measureText(tag).width + 34;
    if (x + tw > W - 44) break;
    ctx.fillStyle = 'rgba(168, 116, 31, 0.16)';
    roundRect(ctx, x, y - 24, tw, 38, 19);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, x + 17, y - 4);
    ctx.textBaseline = 'alphabetic';
    x += tw + 12;
  }
  y += 64;

  // Condition · listed by
  if (listing) {
    ctx.font = `19px ${SERIF}`;
    ctx.fillStyle = INK;
    const parts = [];
    if (listing.book_condition) parts.push(`Condition: ${listing.book_condition}`);
    if (listing.owner_name) parts.push(`Listed by: ${listing.owner_name}`);
    if (parts.length) ctx.fillText(parts.join('   ·   '), 54, y);
    if (listing.course_code) {
      ctx.fillStyle = INK_SOFT;
      ctx.fillText(`Course: ${listing.course_code}`, 54, y + 30);
    }
  }

  // Footer note
  ctx.font = `italic 19px ${SERIF}`;
  ctx.fillStyle = INK_SOFT;
  let footer;
  if (!listing) {
    footer = 'Part of the MRV College display — sign in to browse the live catalogue.';
  } else if (listing.listing_type === 'sell') {
    footer = 'Order from an approved vendor — checkout is simulated, no payment data is collected.';
  } else {
    footer = "Request this book, wait for the owner's approval, then hand over and return.";
  }
  wrapText(ctx, footer, 54, H - 88, W - 110, 26, 3);

  return finish(c);
}

/** Right page = the matter: about + how it works. */
export function makeRightPageTexture(book) {
  const W = 512;
  const H = 704;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  paperBase(ctx, W, H, 'left');

  const listing = book.listing || null;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // ABOUT THIS BOOK
  ctx.font = `bold 17px ${SERIF}`;
  ctx.fillStyle = PAPER_GOLD;
  drawTrackedLeft(ctx, 'ABOUT THIS BOOK', 54, 92, 2.5);
  ctx.font = `22px ${SERIF}`;
  ctx.fillStyle = INK;
  let about = listing?.description || '';
  if (!about) {
    about = listing
      ? `${book.title} by ${book.author}. A ${listing.listing_type === 'sell' ? 'vendor-listed' : 'peer-listed'} copy in the MRV BookHub catalogue, ready for ${listing.listing_type === 'sell' ? 'ordering' : 'borrowing'}.`
      : `${book.title} by ${book.author} — a display copy on the MRV College shelf. Click any catalogue book to pull it into your hands.`;
  }
  let y = wrapText(ctx, about, 54, 132, W - 100, 31, 6) + 36;

  // HOW IT WORKS
  ctx.font = `bold 17px ${SERIF}`;
  ctx.fillStyle = PAPER_GOLD;
  drawTrackedLeft(ctx, 'HOW IT WORKS', 54, y, 2.5);
  y += 44;

  let points;
  if (!listing) {
    points = [
      'Scroll to stroll along the library wall',
      'Click any book to pull it into your hands',
      'Sign in to borrow, reserve or order',
    ];
  } else if (listing.listing_type === 'sell') {
    points = [
      'Order from an approved vendor',
      'Stock checked and price set on the server',
      'Checkout is simulated — no payment data',
    ];
  } else {
    points = [
      'Request → approve → hand over → return',
      "Extension requests need the owner's approval",
      'Due-date and overdue reminders, no duplicates',
    ];
  }

  ctx.font = `21px ${SERIF}`;
  for (const p of points) {
    ctx.fillStyle = PAPER_GOLD;
    ctx.fillText('•', 54, y);
    ctx.fillStyle = INK;
    y = wrapText(ctx, p, 82, y, W - 136, 28, 3) + 20;
  }

  // Footnote
  ctx.font = `italic 16px ${SERIF}`;
  ctx.fillStyle = INK_SOFT;
  ctx.fillText('MRV BookHub · sample text for demo', 54, H - 52);

  return finish(c);
}

/** Open pages with faux text lines (used while book is on the shelf). */
export function makePagesTexture() {
  const c = makeCanvas(512, 704);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, c.width, c.height);

  // Warm page edge shading
  const grad = ctx.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, 'rgba(160, 130, 90, 0.35)');
  grad.addColorStop(0.08, 'rgba(160, 130, 90, 0.0)');
  grad.addColorStop(0.92, 'rgba(160, 130, 90, 0.0)');
  grad.addColorStop(1, 'rgba(160, 130, 90, 0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);

  // Text lines
  ctx.fillStyle = 'rgba(70, 58, 44, 0.72)';
  let y = 74;
  let seed = 7;
  while (y < c.height - 60) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const w = 300 + (seed % 170);
    const x = 56 + ((seed >> 5) % 10);
    ctx.fillRect(x, y, w, 7);
    y += 26;
    if ((seed >> 9) % 5 === 0) y += 16; // paragraph break
  }

  return finish(c);
}

/** Warm wooden floor. */
export function makeFloorTexture() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a3222';
  ctx.fillRect(0, 0, 512, 512);

  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    const shade = 40 + ((row * 37) % 30);
    ctx.fillStyle = `rgb(${shade + 46}, ${shade + 22}, ${shade})`;
    ctx.fillRect(0, y, 512, 60);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + 60, 512, 4);
    // grain
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const gy = y + 8 + i * 11;
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + 5, 340, gy - 5, 512, gy + 2);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Deterministic pseudo-random so the shelf layout is stable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
