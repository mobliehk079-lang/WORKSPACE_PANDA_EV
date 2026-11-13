# PANDA EV WORKSPACE

ລະບົບບໍລິຫານວຽກພາຍໃນບໍລິສັດ: ວຽກ, ພາລະວຽກ, KPI ແລະ ນັດປະຊຸມ — Internal work management: tasks, workload, KPI and meetings.

- ພາສາຫຼັກ **ລາວ**, ສະຫຼັບເປັນ **English** ໄດ້ (ປຸ່ມ ລາວ / EN)
- ໃຊ້ໄດ້ທັງຄອມ, Mac, iPad (ແນວຕັ້ງ/ແນວນອນ) ແລະ ມືຖື
- Dark / Light mode

## Run

Requires **Node.js 22.13+** (24 recommended). No `npm install` needed — only Node built-ins (`node:sqlite`, `node:http`).

```bash
npm start          # http://localhost:3000   (other port: PORT=8080 npm start)
npm run reset      # wipe everything and start clean (super admin only)
npm run demo       # wipe everything and load demo data (all demo accounts use password demo1234)
```

## First start

The workspace starts **empty**: the 3 departments and one super admin.

- Email: `superadmin@panda-ev.com` (or set `SUPERADMIN_EMAIL`)
- Password: set `SUPERADMIN_PASSWORD` before the first start, or a random one is generated, printed in the console and saved to `data/superadmin-password.txt`.

Log in, change the password (profile menu → Change password), delete that file, then add your team under **ຜູ້ໃຊ້ / Users**.

> Never run `npm run demo` on a server that is reachable from outside: the demo accounts share a public password.

## Deploy on Railway

1. **Add a Volume** to the service (right-click the service → *Attach volume*), mount path `/data`.
   Without it, the database and uploaded files are **erased on every deploy**. The app finds the volume automatically (`RAILWAY_VOLUME_MOUNT_PATH`); you can also set `DATA_DIR`.
2. **Variables** (service → Variables):
   - `SUPERADMIN_PASSWORD` — password for the first super admin (only used when the database is empty)
   - `SUPERADMIN_EMAIL` — optional, default `superadmin@panda-ev.com`
3. **Networking → Generate Domain** to get a public `https://…up.railway.app` URL.
4. Optional: *Settings → Healthcheck path* = `/health`.

`PORT` is provided by Railway. HTTPS cookies, real client IPs (login rate limit) and the proxy host are handled automatically. Back up the volume regularly (it holds `workspace.db` and `uploads/`).

## Users & registration

- **Super admin → ຜູ້ໃຊ້ / Users**: add users (a password is generated and copied for you), edit name/email/role/department, reset passwords, disable/enable accounts.
- **Register** on the login page creates a *pending* account. It cannot log in until a super admin approves it and sets the role.
- Safety rules: there is always at least one active super admin; you cannot remove your own super admin access; disabling a user, resetting a password or moving someone to another department logs them out everywhere. Moving departments also unassigns their open tasks there.

## Permissions (checked on the server for every request)

| | Super admin / Manager | Supervisor | Staff |
|---|---|---|---|
| See tasks & files | all departments | every task in own department | only tasks they are assigned to, created, or were added to as a coworker |
| Choose coworkers on a task (same department) | ✓ | ✓ | if they are the assignee or creator |
| Assign tasks | anyone | own department | self only |
| Approve "Done" | ✓ | ✓ | ✗ (moves to "In review") |
| **ກວດວຽກ / Review work** page (approve or send back with a note) | all departments | own department | ✗ |
| Schedule meetings | anyone | own department | ✗ (can accept/decline) |
| KPI | everyone | own team | self |
| Manage users | super admin only | ✗ | ✗ |

## Languages

UI text is written in English in the code and translated in `public/js/lang-lo.js` (Lao, default). Server messages are translated in `src/i18n.js` based on the `X-Lang` header. To change a Lao wording, edit the value next to its English key.

## Layout

| Screen | Layout |
|---|---|
| Desktop / Mac ≥ 1181px | full sidebar |
| iPad landscape, small laptops 921–1180px | icon rail sidebar |
| iPad portrait, phones ≤ 920px | slide-out menu, bottom-sheet dialogs |
| Touch devices | larger tap targets, 16px inputs (no iOS zoom), press-and-hold to drag Kanban cards |

## Structure

```
server.js            HTTP server, API, permissions, uploads/streaming (Range support)
src/db.js            SQLite schema, password hashing (scrypt), file rules
src/logic.js         permissions, workload, KPI
src/i18n.js          server messages (Lao)
src/seed.js          demo data (Lao)
public/js/i18n.js    language switch, Lao dates
public/js/lang-lo.js Lao UI dictionary
public/css/          style.css (glass UI) + responsive.css (devices)
data/                database + uploaded files (created automatically)
```
