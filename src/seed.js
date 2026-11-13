// ຂໍ້ມູນຕົວຢ່າງ — ວັນທີທັງໝົດຄິດໄລ່ຈາກ "ມື້ນີ້" ເພື່ອໃຫ້ເດໂມເບິ່ງສົດໃໝ່ສະເໝີ
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDb, tx, ymd, addDays, localIso, hashPassword, DB_FILE, UPLOAD_DIR, ensureDepartments } from './db.js';

export const DEMO_PASSWORD = 'demo1234';


const D = '@panda-ev.com';
const USERS = [
  { key: 'super', name: 'ສຸລິຍາ ພົມມະຈັນ', email: `superadmin${D}`, role: 'superadmin', dept: null, title: 'ຜູ້ດູແລລະບົບ' },
  { key: 'admin', name: 'ບຸນມີ ສີສະຫວາດ', email: `admin${D}`, role: 'admin', dept: null, title: 'ຜູ້ຈັດການທົ່ວໄປ' },
  { key: 'itLead', name: 'ທອງສະຫວັນ ວົງໄຊ', email: `it.lead${D}`, role: 'supervisor', dept: 'it', title: 'ຫົວໜ້າພະແນກໄອທີ' },
  { key: 'it1', name: 'ສົມສັກ ແກ້ວມະນີ', email: `it.staff1${D}`, role: 'staff', dept: 'it', title: 'System Administrator', presence: 'busy' },
  { key: 'it2', name: 'ພູວົງ ທອງດີ', email: `it.staff2${D}`, role: 'staff', dept: 'it', title: 'Network Engineer', presence: 'busy' },
  { key: 'it3', name: 'ມະນີວອນ ໄຊຍະສານ', email: `it.staff3${D}`, role: 'staff', dept: 'it', title: 'Software Developer' },
  { key: 'it4', name: 'ອານຸສອນ ຈັນທະວົງ', email: `it.staff4${D}`, role: 'staff', dept: 'it', title: 'IT Support', presence: 'away' },
  { key: 'finLead', name: 'ວັນນະພອນ ສີສຸວັນ', email: `fin.lead${D}`, role: 'supervisor', dept: 'finance', title: 'ຫົວໜ້າພະແນກການເງິນ' },
  { key: 'fin1', name: 'ຈັນທະລາ ພິລາວົງ', email: `fin.staff1${D}`, role: 'staff', dept: 'finance', title: 'ນັກບັນຊີອາວຸໂສ', presence: 'busy' },
  { key: 'fin2', name: 'ໄຊຍະວົງ ບຸນມາ', email: `fin.staff2${D}`, role: 'staff', dept: 'finance', title: 'ເຈົ້າໜ້າທີ່ການເງິນ' },
  { key: 'fin3', name: 'ສີດາ ເພັດລັດສະໝີ', email: `fin.staff3${D}`, role: 'staff', dept: 'finance', title: 'ເຈົ້າໜ້າທີ່ອາກອນ' },
  { key: 'mktLead', name: 'ພອນສະຫວັນ ອິນທະວົງ', email: `mkt.lead${D}`, role: 'supervisor', dept: 'marketing', title: 'ຫົວໜ້າພະແນກການຕະຫຼາດ' },
  { key: 'mkt1', name: 'ກິດຕິພົງ ສິນລະປະໄຊ', email: `mkt.staff1${D}`, role: 'staff', dept: 'marketing', title: 'Graphic Designer', presence: 'busy' },
  { key: 'mkt2', name: 'ນິດຕະຍາ ອິນແກ້ວ', email: `mkt.staff2${D}`, role: 'staff', dept: 'marketing', title: 'Video Editor', presence: 'busy' },
  { key: 'mkt3', name: 'ທະວີສັກ ມີສຸກ', email: `mkt.staff3${D}`, role: 'staff', dept: 'marketing', title: 'Content Creator' },
  { key: 'mkt4', name: 'ວັນນິສາ ດວງດີ', email: `mkt.staff4${D}`, role: 'staff', dept: 'marketing', title: 'Digital Marketing' },
  { key: 'bizLead', name: 'ສົມພອນ ແສງອາລຸນ', email: `biz.lead${D}`, role: 'supervisor', dept: 'bizdev', title: 'ຫົວໜ້າພະແນກພັດທະນາທຸລະກິດ' },
  { key: 'biz1', name: 'ອາລຸນີ ວົງສະຫວັນ', email: `biz.staff1${D}`, role: 'staff', dept: 'bizdev', title: 'Business Development Officer', presence: 'busy' },
  { key: 'biz2', name: 'ເພັດສະໝອນ ຄຳມະນີ', email: `biz.staff2${D}`, role: 'staff', dept: 'bizdev', title: 'Partnership Officer' },
  { key: 'mgmtLead', name: 'ດາລາວັນ ສີພັນດອນ', email: `mgmt.lead${D}`, role: 'supervisor', dept: 'mgmt', title: 'ຫົວໜ້າພະແນກບໍລິຫານ' },
  { key: 'mgmt1', name: 'ບົວພັນ ໄຊສົມບັດ', email: `mgmt.staff1${D}`, role: 'staff', dept: 'mgmt', title: 'HR Officer' },
  { key: 'mgmt2', name: 'ສຸກສະຫວັນ ພົມມະລາດ', email: `mgmt.staff2${D}`, role: 'staff', dept: 'mgmt', title: 'Admin Officer', presence: 'busy' },
];

// [dept, title, description, assignee, start, due, priority, status, progress, completed|null]
const TASKS = [
  ['it', 'ຍ້າຍເຊີບເວີອີເມວຂຶ້ນຄລາວ', 'ຍ້າຍກ່ອງຈົດໝາຍທັງໝົດໄປ Microsoft 365 ພ້ອມຕັ້ງຄ່າ DNS/SPF/DKIM', 'it1', -5, 4, 'high', 'doing', 55],
  ['it', 'ອັບເດດແພັດຄວາມປອດໄພ Windows ທັງອົງກອນ', 'ຕິດຕັ້ງແພັດປະຈຳເດືອນໃຫ້ເຄື່ອງລູກຂ່າຍ ແລະ ເຊີບເວີທັງໝົດ', 'it1', -4, -1, 'urgent', 'doing', 70],
  ['it', 'ກວດສອບລະບົບສຳຮອງຂໍ້ມູນປະຈຳເດືອນ', 'ທົດສອບການກູ້ຄືນຂໍ້ມູນຈາກ backup ແລະ ເຮັດລາຍງານຜົນ', 'it1', -4, 1, 'high', 'review', 90],
  ['it', 'ປັບປຸງ Firewall rules', 'ທົບທວນກົດ firewall ທີ່ບໍ່ໄດ້ໃຊ້ ແລະ ປິດພອດທີ່ບໍ່ຈຳເປັນ', 'it1', 1, 8, 'medium', 'todo', 0],
  ['it', 'ຕິດຕັ້ງ VPN ສຳລັບພະນັກງານເຮັດວຽກທາງໄກ', 'ຕັ້ງຄ່າ VPN ແບບ SSL ພ້ອມ MFA ແລະ ເຮັດຄູ່ມືໃຫ້ພະນັກງານ', 'it2', 2, 10, 'medium', 'todo', 0],
  ['it', 'ແກ້ໄຂ Wi-Fi ຊັ້ນ 3 ຫຼຸດເລື້ອຍໆ', 'ສຳຫຼວດສັນຍານ ແລະ ເພີ່ມ Access Point ບໍລິເວນຫ້ອງປະຊຸມ', 'it2', -9, -6, 'high', 'done', 100, -6],
  ['it', 'ຕໍ່ອາຍຸໄລເຊັນ Microsoft 365', 'ປະສານງານກັບຕົວແທນຈຳໜ່າຍ ແລະ ພະແນກການເງິນເລື່ອງໃບສະເໜີລາຄາ', 'it2', -2, 0, 'urgent', 'review', 95],
  ['it', 'ພັດທະນາລະບົບຈອງລົດທົດລອງຂັບ EV', 'ເວັບແອັບໃຫ້ລູກຄ້າຈອງທົດລອງຂັບລົດໄຟຟ້າ ເຊື່ອມກັບປະຕິທິນສາຂາ', 'it3', -10, 12, 'medium', 'doing', 35],
  ['it', 'ເຮັດເອກະສານຄູ່ມືການໃຊ້ງານ ERP', 'ຄູ່ມືສຳລັບຜູ້ໃຊ້ໃໝ່ ກວມເອົາໂມດູນຈັດຊື້ ແລະ ສາງສິນຄ້າ', 'it3', 5, 20, 'low', 'todo', 0],
  ['it', 'ຕັ້ງຄ່າຄອມພະນັກງານໃໝ່ 3 ເຄື່ອງ', 'ລົງໂປຣແກຣມມາດຕະຖານ ເຂົ້າໂດເມນ ແລະ ກຽມບັນຊີຜູ້ໃຊ້', 'it4', 0, 3, 'low', 'todo', 0],
  ['finance', 'ປິດງົບການເງິນປະຈຳເດືອນ', 'ກວດສອບລາຍການປັບປຸງ ປິດບັນຊີ ແລະ ເຮັດງົບທົດລອງ', 'fin1', -6, 2, 'urgent', 'doing', 60],
  ['finance', 'ກະທົບຍອດບັນຊີທະນາຄານ', 'ກະທົບຍອດບັນຊີທະນາຄານທັງ 4 ບັນຊີຂອງເດືອນທີ່ຜ່ານມາ', 'fin1', -5, 0, 'high', 'review', 95],
  ['finance', 'ວາງແຜນງົບປະມານໄຕມາດ 1', 'ລວບລວມຄຳຂໍງົບປະມານຈາກທຸກພະແນກ ແລະ ເຮັດຮ່າງງົບປະມານ', 'fin1', -7, 14, 'high', 'doing', 25],
  ['finance', 'ກວດສອບໃບບິນເບີກຈ່າຍພະນັກງານ', 'ກວດເອກະສານເບີກຄ່າເດີນທາງ ແລະ ຄ່າຮັບຮອງຂອງເດືອນທີ່ຜ່ານມາ', 'fin1', -3, -1, 'medium', 'doing', 40],
  ['finance', 'ເຮັດລາຍງານອາກອນມູນຄ່າເພີ່ມ (VAT)', 'ເຮັດລາຍງານ ແລະ ຍື່ນແບບພາຍໃນກຳນົດ', 'fin3', 1, 6, 'high', 'todo', 0],
  ['finance', 'ຕິດຕາມລູກໜີ້ຄ້າງຊຳລະເກີນ 60 ວັນ', 'ໂທຕິດຕາມ ແລະ ສົ່ງໜັງສືແຈ້ງເຕືອນລູກໜີ້', 'fin2', -2, 5, 'medium', 'doing', 30],
  ['finance', 'ຈ່າຍເງິນເດືອນພະນັກງານປະຈຳເດືອນ', 'ກວດສອບລາຍການເງິນເດືອນ OT ແລະ ໂອນເງິນ', 'fin2', -6, -3, 'urgent', 'done', 100, -4],
  ['finance', 'ເຮັດທະບຽນຊັບສົມບັດຄົງທີ່', 'ປັບປຸງທະບຽນ ແລະ ຄິດໄລ່ຄ່າຫຼຸ້ຍຫ້ຽນ', 'fin3', 3, 18, 'low', 'todo', 0],
  ['marketing', 'ອອກແບບໂປສເຕີໂປຣໂມຊັນລົດໄຟຟ້າທ້າຍປີ', 'ໂປສເຕີ 2 ແບບ ສຳລັບໂຊຣູມ ແລະ ໂຊຊຽວ ຂະໜາດ A2 ແລະ 1080x1350', 'mkt1', -6, 1, 'high', 'review', 90],
  ['marketing', 'ອອກແບບແບນເນີເວັບໄຊ', 'ແບນເນີໜ້າຫຼັກ 3 ຂະໜາດ (desktop / tablet / mobile)', 'mkt1', 0, 5, 'medium', 'todo', 0],
  ['marketing', 'ເຮັດ Motion graphic intro ຊ່ອງ YouTube', 'Intro ຄວາມຍາວ 5 ວິນາທີ ພ້ອມສຽງປະກອບ', 'mkt1', -3, 6, 'medium', 'doing', 40],
  ['marketing', 'ອອກແບບໂລໂກ້ແຄມເປນ 11.11', 'ໂລໂກ້ ແລະ key visual ຂອງແຄມເປນ', 'mkt1', -12, -5, 'high', 'done', 100, -4],
  ['marketing', 'ຕັດຕໍ່ຄລິບຣີວິວລົດ EV 60 ວິນາທີ', 'ຕັດຕໍ່ຄລິບແນວຕັ້ງສຳລັບ TikTok / Reels ພ້ອມຊັບໄຕເຕີ້ນ', 'mkt2', -4, 2, 'urgent', 'doing', 50],
  ['marketing', 'ຖ່າຍຮູບລົດລຸ້ນໃໝ່', 'ຖ່າຍຮູບລົດ 6 ລຸ້ນ ພື້ນຫຼັງສະຕູດິໂອ ແລະ ຮູບ lifestyle', 'mkt2', -2, 3, 'high', 'doing', 45],
  ['marketing', 'ລາຍງານຜົນແຄມເປນ Facebook Ads', 'ສະຫຼຸບ reach, CTR, ROAS ທຽບກັບເປົ້າໝາຍ', 'mkt4', -5, -2, 'medium', 'doing', 65],
  ['marketing', 'ວາງແຜນຄອນເທັນໂຊຊຽວເດືອນໜ້າ', 'Content calendar 30 ວັນ ສຳລັບ Facebook, IG ແລະ TikTok', 'mkt3', 2, 9, 'medium', 'todo', 0],
  ['marketing', 'ກຽມບູດງານວາງສະແດງລົດ (Motor Show)', 'ອອກແບບບູດ ສື່ສິ່ງພິມ ແລະ ຂອງທີ່ລະນຶກ', 'mkt3', 1, 7, 'urgent', 'todo', 0],
  ['bizdev', 'ສຳຫຼວດທີ່ຕັ້ງສາຂາໃໝ່ ແຂວງຫຼວງພະບາງ', 'ລົງພື້ນທີ່ 3 ຈຸດ ທຽບຄ່າເຊົ່າ ແລະ ຈຳນວນລູກຄ້າເປົ້າໝາຍ', 'biz1', -4, 3, 'high', 'doing', 50],
  ['bizdev', 'ເຈລະຈາຕົວແທນຈຳໜ່າຍ ແຂວງຈຳປາສັກ', 'ກຽມຂໍ້ສະເໜີ ແລະ ເງື່ອນໄຂສັນຍາຕົວແທນ', 'biz2', -3, 2, 'urgent', 'review', 90],
  ['bizdev', 'ແຜນຕິດຕັ້ງສະຖານີສາກໄຟ ປີ 2027', 'ຈຸດຕິດຕັ້ງ, ງົບປະມານ ແລະ ຄູ່ຮ່ວມມື', 'biz1', 1, 12, 'medium', 'todo', 0],
  ['bizdev', 'ລາຍງານວິເຄາະຕະຫຼາດລົດ EV ລາວ', 'ສ່ວນແບ່ງຕະຫຼາດ ແລະ ຄູ່ແຂ່ງ ໄຕມາດນີ້', 'biz2', -8, -2, 'medium', 'done', 100, -2],
  ['mgmt', 'ປັບປຸງລະບຽບການພະນັກງານ ສະບັບ 2027', 'ທົບທວນລະບຽບ ວັນພັກ ແລະ ສະຫວັດດີການ', 'mgmt1', -5, 4, 'high', 'doing', 40],
  ['mgmt', 'ສະຫຼຸບການເຂົ້າ-ອອກວຽກປະຈຳເດືອນ', 'ລວບລວມຂໍ້ມູນຈາກເຄື່ອງສະແກນ ສົ່ງພະແນກການເງິນ', 'mgmt2', -2, 1, 'urgent', 'doing', 70],
  ['mgmt', 'ຕໍ່ສັນຍາເຊົ່າອາຄານສຳນັກງານ', 'ປະສານເຈົ້າຂອງອາຄານ ແລະ ກວດເງື່ອນໄຂສັນຍາໃໝ່', 'mgmt2', 2, 9, 'medium', 'todo', 0],
  // Leaders' own work
  ['it', 'ທົບທວນແຜນງົບປະມານ IT ປີ 2027', 'ສະຫຼຸບຄວາມຕ້ອງການອຸປະກອນ ແລະ ໄລເຊັນ ສົ່ງຜູ້ບໍລິຫານ', 'itLead', -3, 2, 'high', 'doing', 60],
  ['finance', 'ກວດສອບງົບການເງິນກ່ອນສົ່ງຜູ້ສອບບັນຊີ', 'ທົບທວນງົບດຸນ ແລະ ງົບກຳໄລຂາດທຶນ', 'finLead', -4, -1, 'urgent', 'done', 100, -1],
  ['marketing', 'ອະນຸມັດແຜນແຄມເປນໄຕມາດ 1', 'ກວດງົບໂຄສະນາ ແລະ ຊ່ອງທາງສື່', 'mktLead', 0, 6, 'high', 'todo', 0],
  ['bizdev', 'ນຳສະເໜີແຜນຂະຫຍາຍສາຂາຕໍ່ຜູ້ບໍລິຫານ', 'ສະຫຼຸບຜົນສຳຫຼວດ 3 ແຂວງ ແລະ ງົບລົງທຶນ', 'bizLead', -2, 4, 'high', 'doing', 45],
  ['mgmt', 'ກຳນົດ KPI ພະນັກງານປີ 2027', 'ປະສານທຸກພະແນກ ກຳນົດຕົວຊີ້ວັດ', 'mgmtLead', -1, 8, 'medium', 'doing', 20],
  // The general manager's own work (managers can take tasks in any department)
  ['mgmt', 'ເຊັນສັນຍາຄູ່ຮ່ວມທຸລະກິດ ແຂວງຈຳປາສັກ', 'ທົບທວນສັນຍາສຸດທ້າຍ ແລະ ເຊັນ', 'admin', -2, 1, 'urgent', 'doing', 70],
  ['bizdev', 'ພົບຕົວແທນຜູ້ຜະລິດລົດ EV ຈີນ', 'ເຈລະຈາລາຄາ ແລະ ເງື່ອນໄຂການນຳເຂົ້າປີໜ້າ', 'admin', -6, -2, 'high', 'done', 100, -2],
  ['finance', 'ອະນຸມັດງົບປະມານປີ 2027', 'ພິຈາລະນາຮ່າງງົບປະມານຈາກທຸກພະແນກ', 'admin', 3, 10, 'high', 'todo', 0],
  ['mgmt', 'ສຳພາດພະນັກງານໃໝ່ 4 ຕຳແໜ່ງ', 'ຄັດເລືອກໃບສະໝັກ ແລະ ນັດສຳພາດ', 'mgmt1', -9, -3, 'high', 'done', 100, -3],
];

const ROUTINE = {
  it: ['ຣີເຊັດລະຫັດຜ່ານ ແລະ ປົດລັອກບັນຊີຜູ້ໃຊ້', 'ຕິດຕັ້ງເຄື່ອງພິມຊັ້ນ 2', 'ອັບເດດເຟີມແວສະວິດ', 'ກວດສອບ log ຄວາມປອດໄພ', 'ແກ້ບັກລະບົບລາພັກ', 'ຍ້າຍໄຟລ໌ແຊຣ໌ໄປ NAS ໃໝ່', 'ທົດສອບ UPS ໄຟຟ້າສຳຮອງ', 'ຕັ້ງຄ່າອີເມວພະນັກງານໃໝ່'],
  finance: ['ບັນທຶກໃບແຈ້ງໜີ້ຜູ້ສະໜອງ', 'ເຮັດລາຍງານກະແສເງິນສົດ', 'ກວດນັບເງິນສົດຍ່ອຍ', 'ຍື່ນແບບອາກອນລາຍໄດ້', 'ອອກໃບເກັບເງິນ', 'ສະຫຼຸບຄ່າໃຊ້ຈ່າຍລາຍພະແນກ', 'ກວດສອບສັນຍາເຊົ່າ', 'ວິເຄາະຕົ້ນທຶນລົດນຳເຂົ້າ'],
  bizdev: ['ພົບລູກຄ້າອົງກອນ', 'ກຽມໃບສະເໜີລາຄາຂາຍຍົກ', 'ສະຫຼຸບຍອດຂາຍຕົວແທນ', 'ສຳຫຼວດຄູ່ແຂ່ງ', 'ກຽມເອກະສານປະມູນ'],
  mgmt: ['ອອກໜັງສືຢັ້ງຢືນເງິນເດືອນ', 'ຈັດຊື້ອຸປະກອນສຳນັກງານ', 'ຈັດເກັບເອກະສານສັນຍາ', 'ກຽມຫ້ອງປະຊຸມຜູ້ບໍລິຫານ', 'ປະຖົມນິເທດພະນັກງານໃໝ່'],
  marketing: ['ອອກແບບໂພສ Facebook ປະຈຳອາທິດ', 'ຕັດຕໍ່ຄລິບສຳພາດລູກຄ້າ', 'ຂຽນບົດຄວາມ SEO', 'ເຮັດ Story Instagram', 'ອອກແບບໃບປິວໂປຣໂມຊັນ', 'ສະຫຼຸບ engagement ລາຍອາທິດ', 'ເຮັດຮູບປົກອີເວັນ', 'ເຮັດ EDM ສົ່ງລູກຄ້າ'],
};

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function posterSvg(title, subtitle, c1, c2, c3) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>
<filter id="b"><feGaussianBlur stdDeviation="60"/></filter></defs>
<rect width="1080" height="1350" fill="url(#g)"/>
<circle cx="860" cy="260" r="260" fill="#ffffff" opacity=".22" filter="url(#b)"/>
<circle cx="180" cy="1100" r="300" fill="#ffffff" opacity=".18" filter="url(#b)"/>
<rect x="90" y="360" width="900" height="620" rx="48" fill="#ffffff" fill-opacity=".16" stroke="#ffffff" stroke-opacity=".5" stroke-width="3"/>
<text x="540" y="560" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="96" font-weight="700" fill="#fff">${title}</text>
<text x="540" y="680" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="56" fill="#fff" opacity=".92">${subtitle}</text>
<text x="540" y="860" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="140" font-weight="800" fill="#fff">-15%</text>
<text x="540" y="1250" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="#fff" opacity=".85">PANDA EV</text>
</svg>`;
}

function minimalPdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const content = ['BT', '/F1 22 Tf', '60 780 Td', ...lines.flatMap((l, i) => [i ? '0 -32 Td' : '', `(${esc(l)}) Tj`, i === 0 ? '/F1 13 Tf' : '']).filter(Boolean), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function seed(db) {
  const today = ymd();
  const now = localIso();
  const at = (offset, hh = 10, mm = 0) => `${addDays(today, offset)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

  return tx(db, () => {
    ensureDepartments(db);
    const deptId = Object.fromEntries(db.prepare('SELECT code,id FROM departments').all().map((d) => [d.code, d.id]));

    const uid = {};
    const pw = hashPassword(DEMO_PASSWORD);
    const insUser = db.prepare("INSERT INTO users (name,email,password_hash,role,dept_id,title,presence,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?)");
    for (const u of USERS) uid[u.key] = Number(insUser.run(u.name, u.email, pw, u.role, u.dept ? deptId[u.dept] : null, u.title, u.presence || 'available', now).lastInsertRowid);
    // ຄຳຂໍລົງທະບຽນທີ່ລໍຖ້າອະນຸມັດ (ຕົວຢ່າງ)
    const pending = Number(db.prepare("INSERT INTO users (name,email,password_hash,role,dept_id,title,status,created_at) VALUES (?,?,?,'staff',?,?,'pending',?)")
      .run('ແສງເດືອນ ພົມມະວົງ', `saengdeuan${D}`, pw, deptId.marketing, 'Social Media Admin', now).lastInsertRowid);
    const leadOf = { it: 'itLead', finance: 'finLead', marketing: 'mktLead', bizdev: 'bizLead', mgmt: 'mgmtLead' };

    const insTask = db.prepare(`INSERT INTO tasks (title,description,dept_id,assignee_id,assigner_id,created_by,start_date,due_date,completed_at,priority,status,progress,sort,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const taskId = {};
    TASKS.forEach((t, i) => {
      const [dept, title, desc, who, s, d, prio, status, progress, comp] = t;
      const assigner = i % 5 === 0 || who === 'admin' ? uid.admin : uid[leadOf[dept]];
      taskId[title] = Number(insTask.run(title, desc, deptId[dept], uid[who], assigner, assigner, addDays(today, s), addDays(today, d),
        comp != null ? at(comp, 16, 30) : null, prio, status, progress, i + 1, at(s - 1, 9), now).lastInsertRowid);
    });

    const rnd = mulberry32(20261112);
    const prios = ['low', 'medium', 'medium', 'high', 'urgent'];
    for (const u of USERS.filter((x) => x.role === 'staff')) {
      const n = 5 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        const list = ROUTINE[u.dept];
        const start = -70 + Math.floor(rnd() * 60);
        const due = start + 1 + Math.floor(rnd() * 6);
        const slip = rnd() < 0.75 ? -Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 3);
        const comp = Math.min(-1, due + slip);
        const lead = uid[leadOf[u.dept]];
        insTask.run(list[Math.floor(rnd() * list.length)], 'ວຽກປະຈຳ (ຂໍ້ມູນຕົວຢ່າງຍ້ອນຫຼັງ)', deptId[u.dept], uid[u.key], lead, lead,
          addDays(today, start), addDays(today, due), at(comp, 15 + Math.floor(rnd() * 3)), prios[Math.floor(rnd() * prios.length)], 'done', 100, 100 + k, at(start - 1, 9), now);
      }
    }

    const insC = db.prepare('INSERT INTO comments (task_id,user_id,body,created_at) VALUES (?,?,?,?)');
    const poster = 'ອອກແບບໂປສເຕີໂປຣໂມຊັນລົດໄຟຟ້າທ້າຍປີ';
    insC.run(taskId[poster], uid.mktLead, 'ໂທນສີໂອເຄແລ້ວ ຂໍປັບຕົວເລກ -15% ໃຫ້ໃຫຍ່ຂຶ້ນອີກໜ້ອຍໜຶ່ງ', at(-1, 14, 20));
    insC.run(taskId[poster], uid.mkt1, 'ຮັບຊາບ ອັບໂຫຼດເວີຊັນໃໝ່ໃຫ້ແລ້ວ', at(-1, 16, 5));
    insC.run(taskId['ອັບເດດແພັດຄວາມປອດໄພ Windows ທັງອົງກອນ'], uid.itLead, 'ຍັງເຫຼືອເຄື່ອງພະແນກບັນຊີອີກ 6 ເຄື່ອງ ລົບກວນເລັ່ງດ່ວນ', at(-1, 9, 40));
    insC.run(taskId['ອັບເດດແພັດຄວາມປອດໄພ Windows ທັງອົງກອນ'], uid.it1, 'ກຳລັງເຮັດ ຕິດບັນຫາເຄື່ອງທີ່ຕ້ອງຣີສະຕາດນອກເວລາວຽກ', at(-1, 10, 15));
    insC.run(taskId['ປິດງົບການເງິນປະຈຳເດືອນ'], uid.finLead, 'ລໍຖ້າລາຍການປັບປຸງຄ່າຫຼຸ້ຍຫ້ຽນກ່ອນເດີ້', at(-2, 11));
    insC.run(taskId['ຕັດຕໍ່ຄລິບຣີວິວລົດ EV 60 ວິນາທີ'], uid.mktLead, 'ຂໍເວີຊັນມີຊັບພາສາອັງກິດນຳເດີ້', at(-1, 13));

    const insF = db.prepare('INSERT INTO files (task_id,dept_id,name,stored,mime,size,kind,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const addFile = (task, dept, name, buf, mime, kind, by, when) => {
      const stored = `seed-${crypto.randomBytes(8).toString('hex')}${path.extname(name)}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
      insF.run(taskId[task], deptId[dept], name, stored, mime, buf.length, kind, uid[by], when);
    };
    addFile(poster, 'marketing', 'poster-yearend-v2.svg', Buffer.from(posterSvg('YEAR END EV SALE', 'Drive electric today', '#7c3aed', '#ec4899', '#fb923c')), 'image/svg+xml', 'image', 'mkt1', at(-1, 16));
    addFile(poster, 'marketing', 'poster-yearend-story.svg', Buffer.from(posterSvg('MEGA DEAL', 'Free home charger', '#2563eb', '#a855f7', '#f472b6')), 'image/svg+xml', 'image', 'mkt1', at(-1, 16, 2));
    addFile('ອອກແບບໂລໂກ້ແຄມເປນ 11.11', 'marketing', 'campaign-1111-keyvisual.svg', Buffer.from(posterSvg('11.11', 'Super EV Day', '#f97316', '#ef4444', '#db2777')), 'image/svg+xml', 'image', 'mkt1', at(-5, 15));
    addFile('ອອກແບບແບນເນີເວັບໄຊ', 'marketing', 'banner-moodboard.svg', Buffer.from(posterSvg('NEW ARRIVAL', 'Banner moodboard', '#0ea5e9', '#6366f1', '#ec4899')), 'image/svg+xml', 'image', 'mktLead', at(0, 9));
    addFile('ກວດສອບລະບົບສຳຮອງຂໍ້ມູນປະຈຳເດືອນ', 'it', 'backup-restore-report.pdf', minimalPdf(['Backup & Restore Test Report', 'Result: 12/12 restore jobs passed', 'Average restore time: 18 min', 'Prepared by IT Department']), 'application/pdf', 'pdf', 'it1', at(-1, 15));
    addFile('ຍ້າຍເຊີບເວີອີເມວຂຶ້ນຄລາວ', 'it', 'migration-checklist.md', Buffer.from('# Checklist ຍ້າຍອີເມວ\n\n- [x] ສຳຮອງ mailbox\n- [x] ຕັ້ງຄ່າ domain ໃນ Microsoft 365\n- [ ] ປ່ຽນ MX record\n- [ ] ຕັ້ງຄ່າ SPF / DKIM / DMARC\n- [ ] ແຈ້ງຜູ້ໃຊ້\n'), 'text/markdown; charset=utf-8', 'doc', 'it1', at(-3, 11));
    addFile('ປິດງົບການເງິນປະຈຳເດືອນ', 'finance', 'trial-balance.csv', Buffer.from('﻿ລະຫັດບັນຊີ,ຊື່ບັນຊີ,ໜີ້,ມີ\n1100,ເງິນສົດ,250000000,\n1200,ລູກໜີ້ການຄ້າ,1840000000,\n2100,ເຈົ້າໜີ້ການຄ້າ,,920000000\n4100,ລາຍຮັບຈາກການຂາຍລົດ,,3150000000\n5100,ຕົ້ນທຶນຂາຍ,1980000000,\n'), 'text/csv; charset=utf-8', 'sheet', 'fin1', at(-1, 17));
    addFile('ກະທົບຍອດບັນຊີທະນາຄານ', 'finance', 'bank-reconciliation.pdf', minimalPdf(['Bank Reconciliation Statement', 'Bank: 4 accounts', 'Difference: 0.00 LAK', 'Prepared by Finance Department']), 'application/pdf', 'pdf', 'fin1', at(0, 10));

    const insM = db.prepare('INSERT INTO meetings (title,start_at,end_at,location,online_url,agenda,dept_id,organizer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const insA = db.prepare('INSERT INTO meeting_attendees (meeting_id,user_id,response) VALUES (?,?,?)');
    const meeting = (title, day, h1, h2, loc, url, agenda, dept, org, attendees) => {
      const id = Number(insM.run(title, at(day, h1), at(day, h2), loc, url, agenda, dept ? deptId[dept] : null, uid[org], now).lastInsertRowid);
      insA.run(id, uid[org], 'accepted');
      for (const [k, r] of attendees) insA.run(id, uid[k], r);
      return id;
    };
    meeting('ປະຊຸມຜູ້ບໍລິຫານປະຈຳອາທິດ', 1, 9, 10, 'ຫ້ອງປະຊຸມໃຫຍ່ ຊັ້ນ 5', '', '1. ສະຫຼຸບຜົນງານແຕ່ລະພະແນກ\n2. ວຽກທີ່ເລີຍກຳນົດ ແລະ ແນວທາງແກ້ໄຂ\n3. ແຜນງານໄຕມາດໜ້າ', null, 'admin', [['itLead', 'accepted'], ['finLead', 'accepted'], ['mktLead', 'pending']]);
    const standup = meeting('IT Daily Stand-up', 0, 16, 17, '', 'https://meet.google.com/abc-defg-hij', 'ອັບເດດຄວາມຄືບໜ້າ ແລະ ບັນຫາທີ່ຕິດຂັດ', 'it', 'itLead', [['it1', 'accepted'], ['it2', 'accepted'], ['it3', 'pending'], ['it4', 'declined']]);
    meeting('ວາງແຜນຍ້າຍລະບົບອີເມວ (Cut-over)', 2, 14, 15, 'ຫ້ອງປະຊຸມ IT', 'https://teams.microsoft.com/l/meetup-join/demo', '1. ລຳດັບຂັ້ນຕອນ cut-over\n2. ແຜນສຳຮອງກໍລະນີລົ້ມເຫຼວ\n3. ການແຈ້ງຜູ້ໃຊ້', 'it', 'itLead', [['it1', 'accepted'], ['it2', 'pending']]);
    meeting('ທົບທວນງົບການເງິນທ້າຍເດືອນ', 2, 10, 12, 'ຫ້ອງປະຊຸມການເງິນ ຊັ້ນ 3', '', '1. ງົບທົດລອງ\n2. ລາຍການປັບປຸງ\n3. ກຳນົດການຍື່ນອາກອນ', 'finance', 'finLead', [['fin1', 'accepted'], ['fin2', 'pending'], ['fin3', 'pending']]);
    const brainstorm = meeting('ລະດົມຄວາມຄິດແຄມເປນປີໃໝ່', 3, 13, 15, 'Creative Room', 'https://zoom.us/j/1234567890', '1. ຄອນເຊັບແຄມເປນ\n2. ຊ່ອງທາງສື່\n3. ງົບປະມານ ແລະ ໄທມ໌ລາຍ', 'marketing', 'mktLead', [['mkt1', 'accepted'], ['mkt2', 'pending'], ['mkt3', 'accepted'], ['mkt4', 'pending']]);
    meeting('ສະຫຼຸບຜົນແຄມເປນ 11.11', -3, 15, 16, 'Creative Room', '', 'ສະຫຼຸບຍອດຂາຍ ແລະ ບົດຮຽນທີ່ໄດ້ຮັບ', 'marketing', 'mktLead', [['mkt1', 'accepted'], ['mkt2', 'accepted'], ['mkt3', 'accepted'], ['mkt4', 'accepted']]);

    const insN = db.prepare('INSERT INTO notifications (user_id,type,title,body,link,params,ref_key,created_at) VALUES (?,?,?,?,?,?,?,?)');
    const lead = USERS.find((u) => u.key === 'mktLead').name;
    insN.run(uid.mkt2, 'meeting', '{name} invited you to a meeting', 'ລະດົມຄວາມຄິດແຄມເປນປີໃໝ່', '#/meetings', JSON.stringify({ name: lead }), `meet-invite:${brainstorm}`, now);
    insN.run(uid.it3, 'meeting', '{name} invited you to a meeting', 'IT Daily Stand-up', '#/meetings', JSON.stringify({ name: USERS[2].name }), `meet-invite:${standup}`, now);
    insN.run(uid.mktLead, 'review', '{name} submitted a task for review', poster, `#/task/${taskId[poster]}`, JSON.stringify({ name: USERS.find((u) => u.key === 'mkt1').name }), null, now);
    insN.run(uid.super, 'register', '{name} requested an account', `saengdeuan${D}`, '#/users', JSON.stringify({ name: 'ແສງເດືອນ ພົມມະວົງ' }), `register:${pending}`, now);
    return { users: USERS.length, tasks: TASKS.length };
  });
}

/**
 * Clean start for real use: the departments + one super admin. No demo users, tasks or files.
 * Password comes from SUPERADMIN_PASSWORD, otherwise a random one is generated, printed once,
 * and saved to data/superadmin-password.txt (data/ is never committed).
 */
export const PASSWORD_FILE = path.join(path.dirname(DB_FILE), 'superadmin-password.txt');
export function seedBase(db) {
  const email = (process.env.SUPERADMIN_EMAIL || `superadmin${D}`).toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  tx(db, () => {
    ensureDepartments(db);
    db.prepare("INSERT INTO users (name,email,password_hash,role,dept_id,title,status,created_at) VALUES (?,?,?,'superadmin',NULL,?,'active',?)")
      .run('Super Admin', email, hashPassword(password), 'ຜູ້ດູແລລະບົບ', localIso());
  });
  if (!process.env.SUPERADMIN_PASSWORD) {
    fs.writeFileSync(PASSWORD_FILE, `PANDA EV WORKSPACE — first super admin\nemail:    ${email}\npassword: ${password}\n\nLog in, change this password (profile menu → Change password), then delete this file.\n`);
  }
  console.log(`\n  ✓ New workspace created.\n    Super admin: ${email}\n    Password:    ${process.env.SUPERADMIN_PASSWORD ? '(from SUPERADMIN_PASSWORD)' : password + `\n    (also saved to ${PASSWORD_FILE})`}\n`);
}

function wipe() {
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', PASSWORD_FILE]) fs.rmSync(f, { force: true });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
}

// node src/seed.js --reset   → wipe everything, start clean (super admin only)
// node src/seed.js --demo    → wipe everything, load the demo data (password demo1234)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const demo = process.argv.includes('--demo');
  if (demo || process.argv.includes('--reset')) wipe();
  const db = openDb();
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) console.log('Database already has data (use --reset or --demo to recreate)');
  else if (demo) { const r = seed(db); console.log(`Demo data created: ${r.users} users, ${r.tasks}+ tasks (password: ${DEMO_PASSWORD})`); }
  else seedBase(db);
  db.close();
}
