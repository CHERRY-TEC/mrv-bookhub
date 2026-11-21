'use strict';

/**
 * MRV BookHub - end-to-end API workflow test.
 * Usage:  node tests/run-tests.js
 * Requires the server to be running on PORT (default 5000).
 */

const BASE = process.env.API_BASE || 'http://localhost:5000/api';

let passed = 0;
let failed = 0;
const failures = [];

async function api(method, path, { token, body, headers = {} } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-json */ }
  return { status: res.status, body: json };
}

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function section(name) {
  console.log(`\n--- ${name} ---`);
}

async function main() {
  await section('AUTH: health & registration');
  let r = await api('GET', '/health');
  check('health endpoint', r.status === 200 && r.body.success);

  // Duplicate hall ticket should fail
  r = await api('POST', '/auth/register/student', {
    body: {
      full_name: 'Test Duplicate',
      hall_ticket_number: '22B81A0501',
      email: 'dup@test.com',
      mobile_number: '9000000001',
      password: 'Testing@123',
      confirm_password: 'Testing@123',
    },
  });
  check('duplicate hall ticket rejected (409)', r.status === 409, `got ${r.status}`);

  // Password mismatch
  r = await api('POST', '/auth/register/student', {
    body: {
      full_name: 'Test Mismatch',
      hall_ticket_number: '22B99X9999',
      email: 'mismatch@test.com',
      mobile_number: '9000000002',
      password: 'Testing@123',
      confirm_password: 'Different@123',
    },
  });
  check('password mismatch rejected (422)', r.status === 422, `got ${r.status}`);

  // Valid registration
  r = await api('POST', '/auth/register/student', {
    body: {
      full_name: 'Test New Student',
      hall_ticket_number: '22B99X9999',
      email: 'newstudent@test.com',
      mobile_number: '9000000003',
      department_id: 1,
      academic_year: '2023-2027',
      semester: 3,
      password: 'Testing@123',
      confirm_password: 'Testing@123',
    },
  });
  check('valid registration (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);

  await section('AUTH: logins');
  r = await api('POST', '/auth/login/student', {
    body: { hall_ticket_number: '22B81A0501', password: 'Student@123' },
  });
  check('student login', r.status === 200 && r.body.data.token, `got ${r.status}`);
  const student1Token = r.body?.data?.token;
  const student1 = r.body?.data?.user;

  r = await api('POST', '/auth/login/student', {
    body: { hall_ticket_number: '22B81A0501', password: 'wrongpass' },
  });
  check('incorrect password rejected (401)', r.status === 401, `got ${r.status}`);

  // Pending account login blocked
  r = await api('POST', '/auth/login/student', {
    body: { hall_ticket_number: '22B99X9999', password: 'Testing@123' },
  });
  check('pending account blocked (403)', r.status === 403, `got ${r.status}`);

  r = await api('POST', '/auth/login/faculty', { body: { faculty_id: 'FAC001', password: 'Faculty@123' } });
  check('faculty login', r.status === 200, `got ${r.status}`);
  const facultyToken = r.body?.data?.token;

  r = await api('POST', '/auth/login/librarian', { body: { staff_id: 'LIB001', password: 'Librarian@123' } });
  check('librarian login', r.status === 200, `got ${r.status}`);
  const librarianToken = r.body?.data?.token;

  r = await api('POST', '/auth/login/vendor', { body: { email: 'campus@vendor.com', password: 'Vendor@123' } });
  check('vendor login', r.status === 200, `got ${r.status}`);
  const vendorToken = r.body?.data?.token;

  r = await api('POST', '/auth/login/admin', { body: { email: 'admin@mrvbookhub.local', password: 'Admin@123' } });
  check('admin login', r.status === 200, `got ${r.status}`);
  const adminToken = r.body?.data?.token;

  // Login as second student for borrow tests
  r = await api('POST', '/auth/login/student', { body: { hall_ticket_number: '22B81A0502', password: 'Student@123' } });
  const student2Token = r.body?.data?.token;
  const student2 = r.body?.data?.user;
  check('second student login', Boolean(student2Token));

  await section('AUTH: unauthorized access');
  r = await api('GET', '/admin/users');
  check('admin route without token (401)', r.status === 401, `got ${r.status}`);
  r = await api('GET', '/admin/users', { token: student1Token });
  check('admin route with student token (403)', r.status === 403, `got ${r.status}`);

  await section('BOOKS: upload, search, update, delete');
  r = await api('POST', '/books', {
    token: student1Token,
    body: {
      title: 'Test Driven Book',
      author: 'Jane Author',
      edition: '1st',
      isbn: '9781234567890',
      course_code: 'CS999',
      department_id: 1,
      category: 'Testing',
      description: 'A book created by the test suite',
      listing_type: 'borrow',
      max_borrow_days: 21,
      book_condition: 'good',
    },
  });
  check('upload book (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const newBookId = r.body?.data?.id;

  r = await api('POST', '/books', {
    token: student1Token,
    body: { title: 'X', author: 'Y', listing_type: 'borrow' }, // missing max_borrow_days
  });
  check('invalid upload rejected (422)', r.status === 422, `got ${r.status}`);

  r = await api('GET', '/books/search?title=Python');
  check('search by title', r.status === 200 && r.body.data.books.length >= 1, `got ${r.status} n=${r.body?.data?.books?.length}`);

  r = await api('GET', '/books/search?course_code=CS101');
  check('search by course code', r.status === 200 && r.body.data.books.length >= 1, `got n=${r.body?.data?.books?.length}`);

  r = await api('GET', '/books/search?department=CSE');
  check('search by department code', r.status === 200 && r.body.data.books.length >= 1, `got n=${r.body?.data?.books?.length}`);

  r = await api('GET', `/books/${newBookId}`);
  check('get book detail', r.status === 200 && r.body.data.title === 'Test Driven Book');

  // Unauthorized modification: student2 tries to edit student1's listing
  r = await api('PUT', `/books/${newBookId}`, {
    token: student2Token,
    body: { title: 'Hacked Title' },
  });
  check('unauthorized book modification (403)', r.status === 403, `got ${r.status}`);

  // Authorized update
  r = await api('PUT', `/books/${newBookId}`, {
    token: student1Token,
    body: { description: 'Updated by owner', max_borrow_days: 30 },
  });
  check('owner updates own book (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

  await section('BORROW: full workflow');
  r = await api('POST', '/borrow/request', {
    token: student2Token,
    body: { listing_id: newBookId, requested_days: 14, request_message: 'Please let me borrow' },
  });
  check('request available book (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const requestId = r.body?.data?.id;

  // Borrow own book should fail
  r = await api('POST', '/borrow/request', {
    token: student1Token,
    body: { listing_id: newBookId, requested_days: 7 },
  });
  check('borrow own book rejected (400)', r.status === 400, `got ${r.status}`);

  // Request too many days
  r = await api('POST', '/borrow/request', {
    token: student2Token,
    body: { listing_id: newBookId, requested_days: 91 },
  });
  check('excessive days rejected (422)', r.status === 422, `got ${r.status}`);

  // Duplicate request
  r = await api('POST', '/borrow/request', {
    token: student2Token,
    body: { listing_id: newBookId, requested_days: 10 },
  });
  check('duplicate active request rejected (409)', r.status === 409, `got ${r.status}`);

  r = await api('GET', '/borrow/received-requests', { token: student1Token });
  check('owner sees received requests', r.status === 200 && r.body.data.some((x) => x.id === requestId), `got ${r.status}`);

  r = await api('GET', '/borrow/my-requests', { token: student2Token });
  check('borrower sees own requests', r.status === 200 && r.body.data.length >= 1);

  // Wrong user tries to approve
  r = await api('PATCH', `/borrow/${requestId}/approve`, { token: student2Token });
  check('non-owner approval rejected (403)', r.status === 403, `got ${r.status}`);

  r = await api('PATCH', `/borrow/${requestId}/approve`, { token: student1Token });
  check('owner approves request', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await api('POST', '/borrow/request', {
    token: student2Token,
    body: { listing_id: newBookId, requested_days: 10 },
  });
  check('request unavailable book (409)', r.status === 409, `got ${r.status}`);

  r = await api('POST', `/borrow/${requestId}/issue`, { token: student1Token });
  check('record physical handover (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  check('due date calculated', Boolean(r.body?.data?.due_date));

  // Extension
  r = await api('POST', `/borrow/${requestId}/extension-request`, {
    token: student2Token,
    body: { extension_days: 7 },
  });
  check('extension request (201)', r.status === 201, `got ${r.status}`);

  r = await api('PATCH', `/borrow/${requestId}/extension-approve`, { token: student1Token });
  check('owner approves extension', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  check('extension changes due date', Boolean(r.body?.data?.due_date));

  r = await api('PATCH', `/borrow/${requestId}/return`, { token: student1Token });
  check('return book (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await api('GET', '/borrow/history', { token: student1Token });
  const historyHasTestTx = r.status === 200 && r.body.data.some((t) => t.title === 'Test Driven Book');
  check('borrow history includes transaction', historyHasTestTx, `n=${r.body?.data?.length}`);

  await section('LIBRARY: inventory, reserve, issue, return');
  r = await api('POST', '/library/inventory', {
    token: student1Token, // student should be denied
    body: { title: 'Sneaky Book', author: 'X', total_copies: 5 },
  });
  check('student cannot add inventory (403)', r.status === 403, `got ${r.status}`);

  r = await api('POST', '/library/inventory', {
    token: librarianToken,
    body: {
      title: 'Library Test Book',
      author: 'Lib Author',
      edition: '2nd',
      isbn: '9780001112223',
      department_id: 2,
      total_copies: 2,
      shelf_number: 'Z-9',
      rack_number: 'R-2',
      max_issue_days: 14,
    },
  });
  check('librarian adds inventory (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const inventoryId = r.body?.data?.id;

  r = await api('GET', '/library/books?title=Library%20Test', { token: librarianToken });
  check('search library books', r.status === 200 && r.body.data.books.length >= 1, `n=${r.body?.data?.books?.length}`);

  // Reserve
  r = await api('POST', '/library/reservations', {
    token: student2Token,
    body: { inventory_id: inventoryId },
  });
  check('reserve available copy (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const reservationId = r.body?.data?.id;
  const reservationCode = r.body?.data?.reservation_code;

  // Duplicate reservation
  r = await api('POST', '/library/reservations', {
    token: student2Token,
    body: { inventory_id: inventoryId },
  });
  check('duplicate reservation rejected (409)', r.status === 409, `got ${r.status}`);

  // Inventory: 2 total, 1 reserved, 1 available
  r = await api('GET', '/library/inventory', { token: librarianToken });
  const inv = r.body?.data?.find((x) => x.id === inventoryId);
  check('inventory: 1 reserved after reservation', inv && inv.reserved_copies === 1 && inv.available_copies === 1,
    JSON.stringify(inv));

  // Student views own reservations
  r = await api('GET', '/library/my-reservations', { token: student2Token });
  check('student sees own reservations', r.status === 200 && r.body.data.some((x) => x.reservation_code === reservationCode));

  // Librarian views reservations
  r = await api('GET', '/library/reservations', { token: librarianToken });
  check('librarian sees reservations', r.status === 200 && r.body.data.reservations.length >= 1);

  // Student cannot approve
  r = await api('PATCH', `/library/reservations/${reservationId}/approve`, { token: student2Token });
  check('student cannot approve reservation (403)', r.status === 403, `got ${r.status}`);

  // Librarian approves then issues
  r = await api('PATCH', `/library/reservations/${reservationId}/approve`, { token: librarianToken });
  check('librarian approves reservation', r.status === 200, `got ${r.status}`);

  r = await api('POST', '/library/issues', {
    token: librarianToken,
    body: { reservation_id: reservationId, hall_ticket_number: '22B81A0502' },
  });
  check('librarian issues book (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const issueId = r.body?.data?.id;

  // Inventory after issue: 0 reserved, 1 issued, 1 available
  r = await api('GET', '/library/inventory', { token: librarianToken });
  const inv2 = r.body?.data?.find((x) => x.id === inventoryId);
  check('inventory invariant after issue', inv2
    && inv2.total_copies === inv2.available_copies + inv2.reserved_copies + inv2.issued_copies
    && inv2.issued_copies === 1 && inv2.reserved_copies === 0,
    JSON.stringify(inv2));

  // Student cannot issue
  r = await api('POST', '/library/issues', {
    token: student1Token,
    body: { reservation_id: reservationId },
  });
  check('student cannot issue (403)', r.status === 403, `got ${r.status}`);

  // Return
  r = await api('PATCH', `/library/issues/${issueId}/return`, { token: librarianToken });
  check('librarian records return (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await api('GET', '/library/inventory', { token: librarianToken });
  const inv3 = r.body?.data?.find((x) => x.id === inventoryId);
  check('inventory restored after return', inv3 && inv3.available_copies === 2 && inv3.issued_copies === 0,
    JSON.stringify(inv3));

  // Library reports
  r = await api('GET', '/library/reports', { token: librarianToken });
  check('library reports (200)', r.status === 200 && r.body.data.totals.total_titles >= 11, `got ${r.status}`);

  // Cancel a reservation: reserve then cancel
  r = await api('POST', '/library/reservations', { token: student2Token, body: { inventory_id: inventoryId } });
  const res2Id = r.body?.data?.id;
  r = await api('PATCH', `/library/reservations/${res2Id}/cancel`, { token: student2Token });
  check('cancel own reservation (200)', r.status === 200, `got ${r.status}`);
  r = await api('GET', '/library/inventory', { token: librarianToken });
  const inv4 = r.body?.data?.find((x) => x.id === inventoryId);
  check('cancel releases copy', inv4 && inv4.available_copies === 2 && inv4.reserved_copies === 0, JSON.stringify(inv4));

  // Inventory update guard: cannot go below reserved+issued
  r = await api('PUT', `/library/inventory/${inventoryId}`, {
    token: librarianToken,
    body: { total_copies: 10 },
  });
  check('increase total copies (200)', r.status === 200, `got ${r.status}`);

  await section('VENDOR: listings and orders');
  r = await api('POST', '/vendor/listings', {
    token: student1Token,
    body: { title: 'Nope', author: 'X', price: 100, stock_quantity: 1 },
  });
  check('student cannot create vendor listing (403)', r.status === 403, `got ${r.status}`);

  r = await api('POST', '/vendor/listings', {
    token: vendorToken,
    body: {
      title: 'Vendor Test Book',
      author: 'Seller Author',
      isbn: '9785555555555',
      price: 499,
      stock_quantity: 3,
      category: 'Reference',
      book_condition: 'new',
    },
  });
  check('vendor creates sale listing (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const vendorListingId = r.body?.data?.id;

  r = await api('GET', '/vendor/marketplace?title=Vendor%20Test');
  check('marketplace shows listing', r.status === 200 && r.body.data.listings.length >= 1, `n=${r.body?.data?.listings?.length}`);

  // Place order exceeding stock
  r = await api('POST', '/vendor/orders', {
    token: student1Token,
    body: { listing_id: vendorListingId, quantity: 10 },
  });
  check('order beyond stock rejected (409)', r.status === 409, `got ${r.status}`);

  // Valid order
  r = await api('POST', '/vendor/orders', {
    token: student1Token,
    body: { listing_id: vendorListingId, quantity: 2 },
  });
  check('valid order placed (201)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
  const orderId = r.body?.data?.id;
  check('backend calculated total', r.body?.data?.total_amount === 998, `total=${r.body?.data?.total_amount}`);

  r = await api('GET', '/vendor/listings', { token: vendorToken });
  const vl = r.body?.data?.find((x) => x.id === vendorListingId);
  check('stock reduced after order', vl && vl.stock_quantity === 1, `stock=${vl?.stock_quantity}`);

  r = await api('PATCH', `/vendor/orders/${orderId}/status`, {
    token: vendorToken,
    body: { order_status: 'confirmed' },
  });
  check('vendor updates order status', r.status === 200, `got ${r.status}`);

  await section('NOTIFICATIONS');
  r = await api('GET', '/notifications', { token: student1Token });
  check('student sees notifications', r.status === 200 && r.body.data.notifications.length >= 1,
    `n=${r.body?.data?.notifications?.length}`);

  const notifId = r.body?.data?.notifications?.[0]?.id;
  r = await api('PATCH', `/notifications/${notifId}/read`, { token: student1Token });
  check('mark notification read', r.status === 200, `got ${r.status}`);

  r = await api('PATCH', '/notifications/read-all', { token: student1Token });
  check('mark all read', r.status === 200, `got ${r.status}`);

  await section('PASSWORD RESET (dev OTP flow)');
  r = await api('POST', '/auth/forgot-password', { body: { identifier: 'student1@mrv.edu.in' } });
  check('forgot password accepted (200)', r.status === 200, `got ${r.status}`);
  const devOtp = r.body?.data?.dev_simulated_otp;
  check('dev OTP returned in dev mode', Boolean(devOtp), JSON.stringify(r.body?.data));

  if (devOtp) {
    r = await api('POST', '/auth/verify-reset-code', {
      body: { identifier: 'student1@mrv.edu.in', code: '000000' },
    });
    check('wrong OTP rejected', r.status === 400, `got ${r.status}`);

    r = await api('POST', '/auth/verify-reset-code', {
      body: { identifier: 'student1@mrv.edu.in', code: devOtp },
    });
    check('correct OTP verified', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

    r = await api('POST', '/auth/reset-password', {
      body: {
        identifier: 'student1@mrv.edu.in',
        code: devOtp,
        new_password: 'NewPass@123',
        confirm_password: 'NewPass@123',
      },
    });
    check('password reset (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

    r = await api('POST', '/auth/login/student', {
      body: { hall_ticket_number: '22B81A0501', password: 'NewPass@123' },
    });
    check('login with new password', r.status === 200, `got ${r.status}`);
  }

  await section('ADMIN');
  r = await api('GET', '/admin/users?role=student', { token: adminToken });
  check('admin lists users', r.status === 200 && r.body.data.users.length >= 10, `n=${r.body?.data?.users?.length}`);

  // Approve the pending student (find their id)
  const pendingUser = r.body.data.users.find((u) => u.account_status === 'pending');
  if (pendingUser) {
    r = await api('PATCH', `/admin/users/${pendingUser.id}/approve`, { token: adminToken });
    check('admin approves pending user', r.status === 200, `got ${r.status}`);

    r = await api('POST', '/auth/login/student', {
      body: { hall_ticket_number: '22B99X9999', password: 'Testing@123' },
    });
    check('approved student can log in', r.status === 200, `got ${r.status}`);

    r = await api('PATCH', `/admin/users/${pendingUser.id}/suspend`, {
      token: adminToken,
      body: { action: 'suspend', reason: 'test suspension' },
    });
    check('admin suspends user', r.status === 200, `got ${r.status}`);

    r = await api('POST', '/auth/login/student', {
      body: { hall_ticket_number: '22B99X9999', password: 'Testing@123' },
    });
    check('suspended login blocked (403)', r.status === 403, `got ${r.status}`);
  }

  r = await api('GET', '/admin/books', { token: adminToken });
  check('admin lists all books', r.status === 200 && r.body.data.listings.length >= 20, `n=${r.body?.data?.listings?.length}`);

  r = await api('GET', '/admin/reports', { token: adminToken });
  check('admin reports (200)', r.status === 200 && r.body.data.users.length >= 1);

  r = await api('GET', '/admin/audit-logs', { token: adminToken });
  check('admin audit logs', r.status === 200 && r.body.data.logs.length >= 5, `n=${r.body?.data?.logs?.length}`);

  r = await api('POST', '/admin/departments', {
    token: adminToken,
    body: { department_name: 'Biotechnology', department_code: 'BIOTECH' },
  });
  check('admin creates department (201)', r.status === 201, `got ${r.status}`);

  await section('SECURITY: misc');
  r = await api('GET', '/books/999999');
  check('missing book (404)', r.status === 404, `got ${r.status}`);

  r = await api('POST', '/borrow/request', { token: student1Token, body: { listing_id: 'abc' } });
  check('invalid body type (422)', r.status === 422, `got ${r.status}`);

  r = await api('GET', '/books/search?title=%27%20OR%201%3D1--');
  check('SQL injection attempt safe (200, no crash)', r.status === 200, `got ${r.status}`);

  r = await api('DELETE', `/books/${newBookId}`, { token: student2Token });
  check('unauthorized delete (403)', r.status === 403, `got ${r.status}`);

  r = await api('DELETE', `/books/${newBookId}`, { token: student1Token });
  check('owner deletes listing (200)', r.status === 200, `got ${r.status}`);

  // -----------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
