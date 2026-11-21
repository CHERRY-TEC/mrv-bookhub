'use strict';

/**
 * MRV BookHub - Development seed data.
 *
 * Usage:  node database/seed.js
 *
 * ============================================================
 * DEVELOPMENT-ONLY CREDENTIALS (never ship in production!)
 * ============================================================
 *  Student 1   hall ticket: 22B81A0501   password: Student@123
 *  Student 2   hall ticket: 22B81A0502   password: Student@123
 *  (students 3-10 follow the same pattern: 22B81A0503 ... 22B81A0510)
 *  Faculty     faculty id:  FAC001        password: Faculty@123
 *  Librarian   staff id:    LIB001        password: Librarian@123
 *  Vendor      email:       vendor1@example.com   password: Vendor@123
 *  Admin       email:       admin@mrvbookhub.local  password: Admin@123
 * ============================================================
 *
 * The seed is idempotent - running it twice will not duplicate data.
 */

const bcrypt = require('bcrypt');
const { initDatabase, getDb, closeDatabase, withTransaction } = require('../config/database');
const env = require('../config/environment');
const { addDays, now } = require('../utils/dateUtils');
const { generateReservationId } = require('../utils/generateReservationId');

initDatabase();
const db = getDb();

const SALT = env.BCRYPT_SALT_ROUNDS;

async function main() {
  // Skip if already seeded
  const existingUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existingUsers > 0) {
    console.log(`Database already contains ${existingUsers} users - seed skipped.`);
    console.log('Run "npm run db:reset" to wipe and reseed.');
    return;
  }

  console.log('Seeding MRV BookHub development data...\n');

  const hash = (pw) => bcrypt.hashSync(pw, SALT);

  // -----------------------------------------------------------
  // Departments
  // -----------------------------------------------------------
  const departments = [
    ['Computer Science and Engineering', 'CSE'],
    ['CSE - AI & Machine Learning', 'CSE AIML'],
    ['Electronics and Communication', 'ECE'],
    ['Electrical and Electronics', 'EEE'],
    ['Mechanical Engineering', 'Mechanical'],
    ['Civil Engineering', 'Civil'],
    ['Information Technology', 'IT'],
  ];
  const deptId = {};
  const insertDept = db.prepare('INSERT INTO departments (department_name, department_code) VALUES (?, ?)');
  departments.forEach(([name, code]) => {
    const info = insertDept.run(name, code);
    deptId[code] = info.lastInsertRowid;
  });
  console.log(`  ${departments.length} departments`);

  // -----------------------------------------------------------
  // Users
  // -----------------------------------------------------------
  const insertUser = db.prepare(
    `INSERT INTO users (full_name, email, mobile_number, password_hash, role, account_status, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const insertStudent = db.prepare(
    `INSERT INTO students (user_id, hall_ticket_number, department_id, academic_year, semester)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertFaculty = db.prepare(
    `INSERT INTO faculty (user_id, faculty_id, department_id, designation) VALUES (?, ?, ?, ?)`
  );
  const insertLibrarian = db.prepare(
    `INSERT INTO librarians (user_id, staff_id, designation) VALUES (?, ?, ?)`
  );
  const insertVendor = db.prepare(
    `INSERT INTO vendors (user_id, vendor_name, business_name, contact_number, business_address, approval_status)
     VALUES (?, ?, ?, ?, ?, 'approved')`
  );

  const studentPw = hash('Student@123');
  const studentIds = [];

  const studentNames = [
    'Aarav Sharma', 'Diya Patel', 'Rohan Kumar', 'Sneha Reddy', 'Arjun Nair',
    'Ishita Gupta', 'Karthik Iyer', 'Ananya Joshi', 'Vikram Singh', 'Priya Menon',
  ];
  const studentDepts = ['CSE', 'CSE AIML', 'ECE', 'EEE', 'IT', 'CSE', 'Mechanical', 'ECE', 'Civil', 'CSE'];

  studentNames.forEach((name, i) => {
    const email = `student${i + 1}@mrv.edu.in`;
    const mobile = `98480${String(100000 + i).slice(-6)}`;
    const hallTicket = `22B81A05${String(i + 1).padStart(2, '0')}`;
    const info = insertUser.run(name, email, mobile, studentPw, 'student', 'active');
    insertStudent.run(
      info.lastInsertRowid,
      hallTicket,
      deptId[studentDepts[i]],
      i < 5 ? '2022-2026' : '2023-2027',
      (i % 8) + 1
    );
    studentIds.push(info.lastInsertRowid);
  });
  console.log(`  ${studentIds.length} students`);

  const facultyPw = hash('Faculty@123');
  const facultyData = [
    ['Dr. Ramesh Chandra', 'FAC001', 'CSE', 'Professor'],
    ['Dr. Lakshmi Devi', 'FAC002', 'ECE', 'Associate Professor'],
    ['Prof. Suresh Babu', 'FAC003', 'Mechanical', 'Assistant Professor'],
  ];
  const facultyIds = [];
  facultyData.forEach(([name, fid, dept, desig]) => {
    const info = insertUser.run(name, `${fid.toLowerCase()}@mrv.edu.in`, `984802${fid.slice(-4)}`, facultyPw, 'faculty', 'active');
    insertFaculty.run(info.lastInsertRowid, fid, deptId[dept], desig);
    facultyIds.push(info.lastInsertRowid);
  });
  console.log(`  ${facultyIds.length} faculty`);

  const librarianPw = hash('Librarian@123');
  const librarianData = [
    ['Mrs. Kavitha Rao', 'LIB001', 'Chief Librarian'],
    ['Mr. Praveen Kumar', 'LIB002', 'Assistant Librarian'],
  ];
  const librarianIds = [];
  librarianData.forEach(([name, sid, desig]) => {
    const info = insertUser.run(name, `${sid.toLowerCase()}@mrv.edu.in`, `984803${sid.slice(-4)}`, librarianPw, 'librarian', 'active');
    insertLibrarian.run(info.lastInsertRowid, sid, desig);
    librarianIds.push(info.lastInsertRowid);
  });
  console.log(`  ${librarianIds.length} librarians`);

  const vendorPw = hash('Vendor@123');
  const vendorData = [
    ['Campus Books & Stationery', 'Ravi Verma', '9848041111', '12-3-45, Main Road, Vijayawada'],
    ['Textbook World', 'Meena Krishnan', '9848042222', '8-2-19, Library Street, Guntur'],
  ];
  const vendorIds = [];
  vendorData.forEach(([biz, vname, phone, addr]) => {
    const email = `${biz.split(' ')[0].toLowerCase()}@vendor.com`;
    const info = insertUser.run(vname, email, phone, vendorPw, 'vendor', 'active');
    insertVendor.run(info.lastInsertRowid, vname, biz, phone, addr);
    vendorIds.push(info.lastInsertRowid);
  });
  console.log(`  ${vendorIds.length} vendors`);

  const adminPw = hash('Admin@123');
  const adminInfo = insertUser.run(
    'MRV BookHub Administrator',
    'admin@mrvbookhub.local',
    '9848050000',
    adminPw,
    'admin',
    'active'
  );
  const adminId = adminInfo.lastInsertRowid;
  console.log(`  1 admin\n`);

  // -----------------------------------------------------------
  // 30 academic books (shared catalogue)
  // -----------------------------------------------------------
  const books = [
    ['Python Programming', 'E. Balagurusamy', '3rd', '9789353061531', 'CS101', 'CSE', 'Programming'],
    ['Data Structures and Algorithms', 'Narasimha Karumanchi', '2nd', '9789352651467', 'CS201', 'CSE', 'Core CS'],
    ['Operating System Concepts', 'Silberschatz', '10th', '9781119320913', 'CS301', 'CSE', 'Core CS'],
    ['Database Management Systems', 'Raghu Ramakrishnan', '2nd', '9780070635524', 'CS202', 'CSE', 'Core CS'],
    ['Computer Networks', 'Andrew S. Tanenbaum', '6th', '9789332509656', 'CS302', 'CSE', 'Core CS'],
    ['Machine Learning', 'Tom M. Mitchell', '1st', '9780070428072', 'CS401', 'CSE AIML', 'AI/ML'],
    ['Artificial Intelligence: A Modern Approach', 'Stuart Russell', '4th', '9780134610993', 'CS402', 'CSE AIML', 'AI/ML'],
    ['Deep Learning', 'Ian Goodfellow', '1st', '9780262035613', 'CS403', 'CSE AIML', 'AI/ML'],
    ['Digital Logic Design', 'Morris Mano', '6th', '9789332549043', 'EC101', 'ECE', 'Core ECE'],
    ['Signals and Systems', 'Alan V. Oppenheim', '2nd', '9788120349490', 'EC201', 'ECE', 'Core ECE'],
    ['Analog Electronic Circuits', 'Sedra & Smith', '7th', '9780198738077', 'EC202', 'ECE', 'Core ECE'],
    ['VLSI Design', 'Douglas Perry', '2nd', '9788177589214', 'EC301', 'ECE', 'VLSI'],
    ['Electrical Machines', 'P.S. Bimbhra', '5th', '9788174093219', 'EE101', 'EEE', 'Core EEE'],
    ['Power Systems', 'C.L. Wadhwa', '6th', '9788177588897', 'EE201', 'EEE', 'Power'],
    ['Control Systems Engineering', 'Norman Nise', '8th', '9781119492870', 'EE202', 'EEE', 'Control'],
    ['Circuit Analysis', 'Alexander & Sadiku', '6th', '9789352132652', 'EE102', 'EEE', 'Circuits'],
    ['Thermodynamics', 'P.K. Nag', '6th', '9789332508378', 'ME101', 'Mechanical', 'Core ME'],
    ['Fluid Mechanics', 'Frank M. White', '8th', '9789352133512', 'ME201', 'Mechanical', 'Fluids'],
    ['Theory of Machines', 'S.S. Rattan', '6th', '9789352133354', 'ME202', 'Mechanical', 'Machines'],
    ['Manufacturing Processes', 'Kalpakjian', '7th', '9789352133604', 'ME301', 'Mechanical', 'Manufacturing'],
    ['Strength of Materials', 'R.K. Bansal', '8th', '9789352132454', 'CE101', 'Civil', 'Core CE'],
    ['Surveying', 'B.C. Punmia', '6th', '9788131802168', 'CE201', 'Civil', 'Surveying'],
    ['Concrete Technology', 'M.S. Shetty', '6th', '9788131802595', 'CE202', 'Civil', 'Materials'],
    ['Structural Analysis', 'Hibbeler', '10th', '9789352132652', 'CE301', 'Civil', 'Structures'],
    ['Computer Organization', 'Carl Hamacher', '5th', '9789332521456', 'IT101', 'IT', 'Core IT'],
    ['Web Technologies', 'Uttam K. Roy', '2nd', '9780199457892', 'IT201', 'IT', 'Web'],
    ['Software Engineering', 'Ian Sommerville', '10th', '9789332508972', 'IT301', 'IT', 'Engineering'],
    ['Compiler Design', 'Aho & Lam', '2nd', '9789332508699', 'IT302', 'IT', 'Core IT'],
    ['Discrete Mathematics', 'Kenneth Rosen', '8th', '9789332508185', 'MA101', 'CSE', 'Mathematics'],
    ['Engineering Physics', 'H.K. Malhotra', '4th', '9788177588477', 'PH101', 'ECE', 'Basic Science'],
  ];

  const insertBook = db.prepare(
    `INSERT INTO books (title, author, edition, isbn, course_code, department_id, category, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const bookIds = [];
  books.forEach(([title, author, edition, isbn, course, dept, category]) => {
    const info = insertBook.run(
      title, author, edition, isbn, course,
      deptId[dept] || null, category,
      `${title} (${edition} edition) - prescribed for ${course}.`,
      facultyIds[0]
    );
    bookIds.push(info.lastInsertRowid);
  });
  console.log(`  ${books.length} books`);

  // -----------------------------------------------------------
  // Book listings: students/faculty offer borrow, vendors sell
  // -----------------------------------------------------------
  const insertListing = db.prepare(
    `INSERT INTO book_listings (book_id, owner_user_id, owner_type, listing_type, book_condition, max_borrow_days, price, stock_quantity, available)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  // 15 borrowable listings from students/faculty
  for (let i = 0; i < 15; i++) {
    const ownerIdx = i % studentIds.length;
    const isFaculty = i % 7 === 6;
    insertListing.run(
      bookIds[i],
      isFaculty ? facultyIds[i % facultyIds.length] : studentIds[ownerIdx],
      isFaculty ? 'faculty' : 'student',
      i % 4 === 0 ? 'both' : 'borrow',
      ['new', 'like_new', 'good', 'fair', 'worn'][i % 5],
      7 + (i % 4) * 7,           // 7, 14, 21, 28 days
      i % 4 === 0 ? 150 + i * 10 : null, // price when 'both'
      0
    );
  }
  // 8 sale listings from vendors
  for (let i = 15; i < 23; i++) {
    insertListing.run(
      bookIds[i],
      vendorIds[i % vendorIds.length],
      'vendor',
      'sell',
      'new',
      null,
      199 + (i % 6) * 60,
      3 + (i % 8)
    );
  }
  const listingCount = db.prepare('SELECT COUNT(*) AS c FROM book_listings').get().c;
  console.log(`  ${listingCount} book listings\n`);

  // -----------------------------------------------------------
  // Library inventory (10 titles, copies on shelves)
  // -----------------------------------------------------------
  const insertInventory = db.prepare(
    `INSERT INTO library_inventory (book_id, total_copies, available_copies, reserved_copies, issued_copies, shelf_number, rack_number, max_issue_days)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?)`
  );
  const inventoryIds = [];
  for (let i = 0; i < 10; i++) {
    const total = 4 + (i % 5); // 4-8 copies
    const info = insertInventory.run(
      bookIds[i], total, total,
      `A-${String(i + 1).padStart(2, '0')}`,
      `R-${(i % 3) + 1}`,
      i % 3 === 0 ? 21 : 14
    );
    inventoryIds.push(info.lastInsertRowid);
  }
  console.log(`  ${inventoryIds.length} library inventory records`);

  // One confirmed reservation + one collected issue for realism
  const sampleIssueRes = db
    .prepare(
      `INSERT INTO library_reservations (reservation_code, student_user_id, inventory_id, reservation_status, expiry_date)
       VALUES (?, ?, ?, 'collected', ?)`
    )
    .run(generateReservationId(), studentIds[0], inventoryIds[0], addDays(now(), 3));
  db.prepare(
    `UPDATE library_inventory SET available_copies = available_copies - 1, issued_copies = issued_copies + 1 WHERE id = ?`
  ).run(inventoryIds[0]);
  db.prepare(
    `INSERT INTO library_issues (reservation_id, inventory_id, student_user_id, issued_by_librarian_id, issue_date, due_date, issue_status)
     VALUES (?, ?, ?, ?, ?, ?, 'issued')`
  ).run(sampleIssueRes.lastInsertRowid, inventoryIds[0], studentIds[0], librarianIds[0], now(), addDays(now(), 14));

  // One pending reservation
  const pendingRes = db
    .prepare(
      `INSERT INTO library_reservations (reservation_code, student_user_id, inventory_id, reservation_status, expiry_date)
       VALUES (?, ?, ?, 'pending', ?)`
    )
    .run(generateReservationId(), studentIds[1], inventoryIds[1], addDays(now(), 3));
  db.prepare(
    `UPDATE library_inventory SET available_copies = available_copies - 1, reserved_copies = reserved_copies + 1 WHERE id = ?`
  ).run(inventoryIds[1]);
  console.log(`  1 issued + 1 pending library reservation\n`);

  // -----------------------------------------------------------
  // Borrow requests + transactions
  // -----------------------------------------------------------
  const insertRequest = db.prepare(
    `INSERT INTO borrow_requests (listing_id, borrower_user_id, requested_days, request_message, status, approved_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Pending request: student 2 -> listing 1 (owned by student 1)
  insertRequest.run(1, studentIds[1], 14, 'Need it for the mid-term project.', 'pending', null);

  // Approved + issued: student 3 -> listing 2
  const r2 = insertRequest.run(2, studentIds[2], 10, 'Circulation for assignment.', 'approved', now());
  db.prepare('UPDATE book_listings SET available = 0 WHERE id = 2').run();
  db.prepare(
    `INSERT INTO borrow_transactions (borrow_request_id, issue_date, due_date, original_due_date, transaction_status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(r2.lastInsertRowid, now(), addDays(now(), 10), addDays(now(), 10));

  // Returned history: student 4 -> listing 3
  const r3 = insertRequest.run(3, studentIds[3], 7, 'Weekend reading.', 'returned', addDays(now(), -20));
  db.prepare(
    `INSERT INTO borrow_transactions (borrow_request_id, issue_date, due_date, original_due_date, return_date, transaction_status)
     VALUES (?, ?, ?, ?, ?, 'returned')`
  ).run(r3.lastInsertRowid, addDays(now(), -20), addDays(now(), -13), addDays(now(), -13), addDays(now(), -14));

  console.log('  3 borrow requests (1 pending, 1 active, 1 returned)\n');

  // -----------------------------------------------------------
  // Notifications
  // -----------------------------------------------------------
  const insertNotif = db.prepare(
    `INSERT INTO notifications (user_id, title, message, notification_type) VALUES (?, ?, ?, ?)`
  );
  insertNotif.run(studentIds[0], 'Welcome to MRV BookHub', 'Your account is active. Start uploading and borrowing books!', 'system_alert');
  insertNotif.run(studentIds[1], 'New borrow request', 'A classmate wants to borrow your copy of "Python Programming".', 'borrow_request');
  insertNotif.run(studentIds[2], 'Book handed over', '"Data Structures and Algorithms" is due back in 10 days.', 'library_issued');
  insertNotif.run(studentIds[0], 'Library book due soon', 'Your library copy is due at the counter soon.', 'return_reminder');
  insertNotif.run(adminId, 'System ready', 'Seed data loaded successfully for development.', 'system_alert');
  console.log('  5 notifications\n');

  // -----------------------------------------------------------
  // Audit logs
  // -----------------------------------------------------------
  const insertAudit = db.prepare(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`
  );
  insertAudit.run(adminId, 'seed_completed', 'system', null, 'Development seed data loaded');
  insertAudit.run(adminId, 'inventory_created', 'library_inventory', inventoryIds[0], 'Initial library stock');
  insertAudit.run(facultyIds[0], 'listing_created', 'book_listing', 1, 'Faculty book upload');

  console.log('Seed complete!\n');
  console.log('='.repeat(60));
  console.log('DEVELOPMENT-ONLY LOGIN CREDENTIALS');
  console.log('='.repeat(60));
  console.log('  Student   hall ticket: 22B81A0501   password: Student@123');
  console.log('  Student   hall ticket: 22B81A0502   password: Student@123');
  console.log('  Faculty   faculty id:  FAC001        password: Faculty@123');
  console.log('  Librarian staff id:    LIB001        password: Librarian@123');
  console.log('  Vendor    email:       campus@vendor.com   password: Vendor@123');
  console.log('  Admin     email:       admin@mrvbookhub.local  password: Admin@123');
  console.log('='.repeat(60));
  console.log('Do NOT use these credentials in production.\n');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
