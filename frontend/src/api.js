/**
 * Thin API client for the MRV BookHub backend.
 * Base URL comes from VITE_API_BASE_URL (.env).
 */

const BASE = (import.meta.env.VITE_API_BASE_URL || 'https://mrv-bookhub-api.vercel.app/api').replace(/\/$/, '');

function getToken() {
  try {
    return localStorage.getItem('mrv_token') || '';
  } catch {
    return '';
  }
}

function getUser() {
  try {
    const raw = localStorage.getItem('mrv_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSession(token, user) {
  try {
    if (token) localStorage.setItem('mrv_token', token);
    if (user) localStorage.setItem('mrv_user', JSON.stringify(user));
  } catch { /* private mode */ }
}

function clearSession() {
  try {
    localStorage.removeItem('mrv_token');
    localStorage.removeItem('mrv_user');
  } catch { /* ignore */ }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = { success: false, message: `HTTP ${res.status}` };
  }

  if (!res.ok) {
    const err = new Error(json.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const api = {
  BASE,
  getToken,
  getUser,
  setSession,
  clearSession,
  isLoggedIn: () => Boolean(getToken()),

  // Auth
  loginStudent: (hall_ticket_number, password) =>
    request('/auth/login/student', { method: 'POST', body: { hall_ticket_number, password }, auth: false }),
  loginRole: (role, identifier, password) => {
    const body = { password };
    if (role === 'student') body.hall_ticket_number = identifier;
    else if (role === 'faculty') body.faculty_id = identifier;
    else if (role === 'librarian') body.staff_id = identifier;
    else body.email = identifier;
    return request(`/auth/login/${role}`, { method: 'POST', body, auth: false });
  },
  me: () => request('/auth/me'),

  // Books
  listBooks: (params = '') => request(`/books${params}`, { auth: false }),
  searchBooks: (params = '') => request(`/books/search${params}`, { auth: false }),
  getBook: (id) => request(`/books/${id}`, { auth: false }),

  // Library
  searchLibrary: (params = '') => request(`/library/books${params}`),
  reserveBook: (inventory_id) =>
    request('/library/reservations', { method: 'POST', body: { inventory_id } }),

  // Borrowing
  requestBorrow: (listing_id, requested_days, request_message) =>
    request('/borrow/request', {
      method: 'POST',
      body: { listing_id, requested_days, request_message },
    }),
  myRequests: () => request('/borrow/my-requests'),

  // Vendor
  marketplace: (params = '') => request(`/vendor/marketplace${params}`, { auth: false }),
  placeOrder: (listing_id, quantity = 1) =>
    request('/vendor/orders', { method: 'POST', body: { listing_id, quantity } }),

  // Notifications
  notifications: () => request('/notifications'),
  markRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => request('/notifications/read-all', { method: 'PATCH' }),
};

export default api;
