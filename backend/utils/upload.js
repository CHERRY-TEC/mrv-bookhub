'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/environment');

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// Ensure upload directory exists
fs.mkdirSync(env.UPLOAD_DIR_ABS, { recursive: true });

/**
 * Disk storage with a completely random filename - the original filename
 * is never used, which prevents path traversal and overwrite attacks.
 */
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, env.UPLOAD_DIR_ABS);
  },
  filename(_req, file, cb) {
    const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
  const err = new Error('Only JPEG, PNG and WEBP images are allowed');
  err.code = 'INVALID_FILE_TYPE';
  return cb(err);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.MAX_IMAGE_SIZE_BYTES, files: 1 },
});

/** Delete an uploaded image file (best effort). */
function removeImageFile(imagePath) {
  if (!imagePath) return;
  try {
    const abs = path.join(env.UPLOAD_DIR_ABS, path.basename(imagePath));
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_err) {
    // ignore
  }
}

/** Convert stored filename to a public URL path. */
function imageUrl(filename) {
  if (!filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  return `/uploads/book-images/${path.basename(filename)}`;
}

module.exports = { upload, removeImageFile, imageUrl };
