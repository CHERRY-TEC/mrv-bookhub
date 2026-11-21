'use strict';

/**
 * Date helpers. All timestamps stored in SQLite are UTC 'YYYY-MM-DD HH:MM:SS'.
 */

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function addDays(dateLike, days) {
  const d = typeof dateLike === 'string' ? new Date(dateLike.replace(' ', 'T') + 'Z') : new Date(dateLike);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function addMinutes(dateLike, minutes) {
  const d = typeof dateLike === 'string' ? new Date(dateLike.replace(' ', 'T') + 'Z') : new Date(dateLike);
  d.setUTCMinutes(d.getUTCMinutes() + Number(minutes));
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Whole calendar days from `from` to `to` (to - from). */
function daysBetween(from, to) {
  const a = new Date(String(from).replace(' ', 'T') + 'Z');
  const b = new Date(String(to).replace(' ', 'T') + 'Z');
  return Math.floor((b - a) / 86400000);
}

function isPast(dateLike) {
  return new Date(String(dateLike).replace(' ', 'T') + 'Z') < new Date();
}

function toDateOnly(dateLike) {
  return String(dateLike).slice(0, 10);
}

module.exports = { now, addDays, addMinutes, daysBetween, isPast, toDateOnly };
