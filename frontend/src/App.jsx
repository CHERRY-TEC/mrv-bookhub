import { useEffect, useState, useCallback, useRef } from 'react';
import Scene from './three/Scene';
import { scrollStore } from './three/scrollStore';
import api from './api';

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind === 'error' ? 'toast-error' : ''}`}>
      {toast.message}
    </div>
  );
}

function LoginModal({ open, onClose, onLogin }) {
  const [role, setRole] = useState('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const identifierLabel = {
    student: 'Hall ticket number',
    faculty: 'Faculty ID',
    librarian: 'Library staff ID',
    vendor: 'Email',
    admin: 'Admin email',
  }[role];

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.loginRole(role, identifier.trim(), password);
      api.setSession(res.data.token, res.data.user);
      onLogin(res.data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2>Sign in to MRV BookHub</h2>
        <p className="modal-sub">Borrow, reserve and order books from the shelf.</p>

        <div className="role-tabs">
          {['student', 'faculty', 'librarian', 'vendor', 'admin'].map((r) => (
            <button
              key={r}
              className={role === r ? 'active' : ''}
              onClick={() => { setRole(r); setIdentifier(''); setError(''); }}
              type="button"
            >
              {r}
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          <label>
            {identifierLabel}
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={role === 'student' ? '22B81A0501' : role === 'vendor' || role === 'admin' ? 'you@example.com' : 'ID'}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="modal-hint">
          Demo: student <code>22B81A0501</code> / <code>Student@123</code> ·
          librarian <code>LIB001</code> / <code>Librarian@123</code>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Book detail panel (appears when a book flies to your hands)         */
/* ------------------------------------------------------------------ */

function BookPanel({ book, onClose, onAction, user, onLoginPrompt }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');
  const [days, setDays] = useState(7);

  useEffect(() => {
    setDetail(null);
    if (!book || book.source !== 'api' || !book.listing) return;
    let alive = true;
    api.getBook(book.listing.id)
      .then((res) => { if (alive) setDetail(res.data); })
      .catch(() => { /* keep shelf data */ });
    return () => { alive = false; };
  }, [book]);

  if (!book) return null;

  const listing = book.listing || detail;
  const canBorrow = listing && ['borrow', 'both'].includes(listing.listing_type);
  const canBuy = listing && ['sell', 'both'].includes(listing.listing_type) && listing.price;
  const maxDays = listing?.max_borrow_days || 14;

  const act = async (label, fn) => {
    if (!user) { onLoginPrompt(); return; }
    setBusy(label);
    try {
      const result = await fn();
      onAction(result?.message || `${label} done`, 'ok');
    } catch (err) {
      onAction(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="book-panel">
      <button className="panel-close" onClick={onClose} aria-label="Close book">×</button>

      <div className="panel-spine" style={{ background: book.color }} />

      <div className="panel-body">
        <span className="panel-tag">
          {book.source === 'api' ? 'From the catalogue' : 'On the shelf'}
        </span>
        <h2>{book.title}</h2>
        <p className="panel-author">by {book.author}</p>

        {listing && (
          <div className="panel-meta">
            {listing.listing_type && <span className="pill">{listing.listing_type}</span>}
            {listing.book_condition && <span className="pill">{listing.book_condition}</span>}
            {listing.max_borrow_days && <span className="pill">up to {listing.max_borrow_days} days</span>}
            {listing.price != null && <span className="pill pill-price">₹{Number(listing.price).toFixed(0)}</span>}
          </div>
        )}

        {canBorrow && (
          <div className="panel-action">
            <label>
              Borrow for
              <select value={Math.min(days, maxDays)} onChange={(e) => setDays(Number(e.target.value))}>
                {[3, 5, 7, 10, 14, 21, 30].filter((d) => d <= maxDays).map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </label>
            <button
              className="btn-primary"
              disabled={Boolean(busy)}
              onClick={() => act('Borrow', () => api.requestBorrow(listing.id, Math.min(days, maxDays), 'Requested from the 3D shelf'))}
            >
              {busy === 'Borrow' ? 'Sending…' : 'Request to borrow'}
            </button>
          </div>
        )}

        {canBuy && (
          <button
            className="btn-secondary"
            disabled={Boolean(busy)}
            onClick={() => act('Order', () => api.placeOrder(listing.id, 1))}
          >
            {busy === 'Order' ? 'Ordering…' : `Order now · ₹${Number(listing.price).toFixed(0)} (simulated)`}
          </button>
        )}

        {listing && listing.id && book.source === 'api' && !canBorrow && !canBuy && (
          <p className="panel-note">
            Library copies are reserved from the Library section after signing in.
          </p>
        )}

        {!listing && (
          <p className="panel-note">
            This copy is part of the library display. Sign in to browse the live catalogue.
          </p>
        )}

        <p className="panel-hint">Click anywhere else or press Esc to put the book back.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [heldBook, setHeldBook] = useState(null);
  const [apiBooks, setApiBooks] = useState([]);
  const [user, setUser] = useState(() => api.getUser());
  const [loginOpen, setLoginOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [unread, setUnread] = useState(0);
  const toastTimer = useRef(null);

  /* Load catalogue from the backend ------------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.listBooks('?limit=40&availability=available');
        const books = (res.data.books || []).map((b) => ({
          title: b.title,
          author: b.author,
          listing: b,
          bookId: b.book_id,
        }));
        if (alive && books.length) setApiBooks(books);
      } catch (err) {
        // Backend offline: shelf still renders with decorative books
        if (alive) {
          // Public/demo deployments run without the API; the shelf still works fully.
          // Only surface a warning when actually developing locally.
          if (import.meta.env.DEV) {
            setToast({ message: `Backend unreachable – showing demo shelf (${err.message})`, kind: 'error' });
          }
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  /* Unread notification count ------------------------------------- */
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    let alive = true;
    api.notifications()
      .then((res) => { if (alive) setUnread(res.data.unread_count || 0); })
      .catch(() => {});
    const t = setInterval(() => {
      api.notifications()
        .then((res) => { if (alive) setUnread(res.data.unread_count || 0); })
        .catch(() => {});
    }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  /* Scroll wiring -------------------------------------------------- */
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        scrollStore.progress = max > 0 ? window.scrollY / max : 0;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* Esc closes the held book --------------------------------------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (loginOpen) setLoginOpen(false);
        else setHeldBook(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen]);

  const showToast = useCallback((message, kind = 'ok') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const handleSelectBook = useCallback((book) => {
    setHeldBook((current) => {
      const next = book && (!current || current.key !== book.key) ? book : null;
      scrollStore.locked = Boolean(next);
      // Prevent page scroll while reading
      document.body.style.overflow = next ? 'hidden' : '';
      return next;
    });
  }, []);

  const handleLogin = useCallback((u) => {
    setUser(u);
    showToast(`Welcome back, ${u.full_name.split(' ')[0]}!`, 'ok');
  }, [showToast]);

  return (
    <div className={`app${heldBook ? ' book-held' : ''}`}>
      {/* 3D canvas fills the viewport */}
      <div className="canvas-wrap">
        <Scene
          apiBooks={apiBooks}
          heldKey={heldBook?.key || null}
          onSelectBook={handleSelectBook}
        />
      </div>

      {/* Header */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">📚</span>
          <div>
            <strong>MRV BookHub</strong>
            <small>College Book Exchange &amp; Library</small>
          </div>
        </div>

        <nav>
          <a href="#how">How it works</a>
          <a href="#library">Library</a>
          <a href="#market">Marketplace</a>
        </nav>

        <div className="topbar-actions">
          {user ? (
            <>
              <span className="notif-badge" title={`${unread} unread notifications`}>
                🔔{unread > 0 && <em>{unread}</em>}
              </span>
              <span className="user-chip">{user.full_name.split(' ')[0]} · {user.role}</span>
              <button
                className="btn-ghost"
                onClick={() => { api.clearSession(); setUser(null); showToast('Signed out'); }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setLoginOpen(true)}>Sign in</button>
          )}
        </div>
      </header>

      {/* Scroll content – drives the camera along the wall */}
      <main className="scroll-content">
        <section className="scroll-section hero" id="top">
          <div className="hero-card">
            <p className="eyebrow">MRV College · Digital Library</p>
            <h1>Walk the shelves.<br />Pull a book into your hands.</h1>
            <p className="lede">
              Scroll to stroll past the library wall — click any book and it flies
              to your hands and opens. Borrow from classmates, reserve library
              copies, or order from approved vendors.
            </p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => setLoginOpen(true)}>
                {user ? 'Browse as ' + user.role : 'Sign in to borrow'}
              </button>
              <a className="btn-secondary" href="#how">How it works ↓</a>
            </div>
            <p className="scroll-hint">↓ keep scrolling</p>
          </div>
        </section>

        <section className="scroll-section" id="how">
          <div className="info-card">
            <h2>Peer-to-peer borrowing</h2>
            <p>
              Students and faculty upload books, set a maximum borrowing duration,
              and approve requests from classmates. Every handover and return is
              tracked with due dates, extensions and automated reminders.
            </p>
            <ul>
              <li>Request → approve → hand over → return</li>
              <li>Extension requests need the owner's approval</li>
              <li>Due-date and overdue reminders, no duplicates</li>
            </ul>
          </div>
        </section>

        <section className="scroll-section" id="library">
          <div className="info-card">
            <h2>College library reservations</h2>
            <p>
              Reserve an available copy with a unique reservation code, collect it
              at the counter with your hall ticket, and return it before the expiry
              date. Inventory always balances: total = available + reserved + issued.
            </p>
            <ul>
              <li>Librarians control stock, shelves and issue duration</li>
              <li>Counter issue &amp; return with overdue reports</li>
              <li>Department-wise usage statistics</li>
            </ul>
          </div>
        </section>

        <section className="scroll-section" id="market">
          <div className="info-card">
            <h2>Vendor marketplace</h2>
            <p>
              Approved vendors list new books with live stock. Prices are calculated
              on the server, stock is checked inside a transaction, and checkout is
              simulated — no payment data is ever collected.
            </p>
            <ul>
              <li>Only approved vendors can publish</li>
              <li>Orders update stock atomically</li>
              <li>Vendors manage order status end-to-end</li>
            </ul>
          </div>
        </section>

        <section className="scroll-section finale">
          <div className="info-card center">
            <h2>Ready to pull one off the shelf?</h2>
            <p>Click any book in the scene above — it will fly to your hands.</p>
            <button className="btn-primary" onClick={() => setLoginOpen(true)}>
              Open MRV BookHub
            </button>
          </div>
        </section>
      </main>

      {/* Book detail panel */}
      <BookPanel
        book={heldBook}
        user={user}
        onClose={() => handleSelectBook(null)}
        onAction={showToast}
        onLoginPrompt={() => setLoginOpen(true)}
      />

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLogin={handleLogin} />
      <Toast toast={toast} />
    </div>
  );
}
