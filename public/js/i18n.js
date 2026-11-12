// Language: Lao (default) / English. UI strings are written in English and looked up in LO.
import { LO } from './lang-lo.js';

const read = () => { try { return localStorage.getItem('pev-lang'); } catch { return null; } };
export const lang = read() === 'en' ? 'en' : 'lo';
document.documentElement.lang = lang;

export function setLang(l) {
  try { localStorage.setItem('pev-lang', l); } catch { /* */ }
  location.reload();
}

/** t('Overdue {n} days', {n: 3}) */
export function t(key, vars) {
  let s = lang === 'lo' ? (LO[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const L = lang === 'lo';
export const MONTHS = L
  ? ['ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ', 'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ']
  : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = L
  ? ['ມ.ກ.', 'ກ.ພ.', 'ມ.ນ.', 'ມ.ສ.', 'ພ.ພ.', 'ມິ.ຖ.', 'ກ.ລ.', 'ສ.ຫ.', 'ກ.ຍ.', 'ຕ.ລ.', 'ພ.ຈ.', 'ທ.ວ.']
  : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WD = L ? ['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສກ', 'ສ'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WD_FULL = L ? ['ວັນອາທິດ', 'ວັນຈັນ', 'ວັນອັງຄານ', 'ວັນພຸດ', 'ວັນພະຫັດ', 'ວັນສຸກ', 'ວັນເສົາ'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const deptName = (d) => (d ? (L ? d.name : d.name_en || d.name) : '');
export const deptShort = (d) => (d ? (L ? d.short : d.short_en || d.short) : '');
export const deptDesc = (d) => (d ? (L ? d.description : d.description_en || d.description) : '');
