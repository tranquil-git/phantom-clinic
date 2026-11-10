# PostgreSQL tren Docker

Chay cac lenh duoi day trong thu muc du an.

## Ket noi

- Host: `127.0.0.1`
- Port: `5433` (cong `5432` cua may da duoc su dung)
- Database: `tranquil`
- User quan tri (superuser): `tranquil`
- Mat khau: `POSTGRES_PASSWORD` trong file `.env`, duoc sinh ngau nhien 16 ky tu.

File `.env` duoc bo qua boi Git. Khong chia se file nay cong khai.

## SQLTools trong VS Code

Da cau hinh connection `tranquil-local` trong `.vscode/settings.json` va tu dong
ket noi khi SQLTools khoi dong. File settings chua mat khau nen duoc bo qua boi Git.

Mo thu muc nay trong VS Code, chon bieu tuong SQLTools de xem connection.
Trong file `.sql`, them dong `-- @conn tranquil-local` o dau file roi chon
`SQLTools: Run Query` trong Command Palette de chay truy van.

Driver can dung: `mtxr.sqltools-driver-pg`. Cau hinh theo
[tai lieu SQLTools PostgreSQL](https://vscode-sqltools.mteixeira.dev/en/drivers/postgre-sql.html).

## TranquilClinicDB (CSDL phong kham nha khoa)

```powershell
powershell -ExecutionPolicy Bypass -File db/create-database.ps1
```

Tao user `TranAdmin` (chu database, khong phai superuser), database `TranquilClinicDB`,
bang (`db/schema.sql`) va du lieu mau (`db/seed.sql`). Thong tin lay tu `CLINIC_DB_*`
trong `.env`. Chay lai khong tao trung; database da co bang thi bo qua schema va seed.
Chi `TranAdmin` (va superuser) ket noi duoc. SQLTools: connection `TranquilClinicDB`.
Thiet ke: `.claude/docs/use-case.md`, `.claude/docs/erd.md`.

## Adminer (quan tri DB tren web)

`docker compose up -d --wait` chay ca PostgreSQL va Adminer. Mo http://127.0.0.1:8080,
chon he thong `PostgreSQL`, server `postgres`, user `tranquil`, mat khau trong `.env`,
database `tranquil`. Doi cong bang `ADMINER_PORT` trong `.env`.

## Website phong kham (Next.js + API Node.js)

Hai server, chay o hai cua so terminal:

```powershell
cd backend; npm install; npm run dev     # API Express: http://127.0.0.1:4000/api
cd frontend; npm install; npm run dev    # Next.js:     http://127.0.0.1:3000
```

Trinh duyet chi goi `/api/*` tren cong 3000; Next.js chuyen tiep sang API (doi bang
bien moi truong `API_URL`). API doc `CLINIC_DB_*`, `POSTGRES_PORT`, `JWT_SECRET` tu `../.env`.
Ban build: `cd frontend; npm run build; npm start`.

Tai khoan mau (mat khau `Demo@123`, doi bang `cd backend; npm run set-password -- <user> <mat khau>`):

| User | Vai tro |
|---|---|
| `lan`, `hoa` | Le tan (ca sang, ca chieu) |
| `an`, `binh`, `chi`, `dung` | Bac si (`dung` ban thoi gian T2/T4/T6) |
| `hung` | Quan ly |

So do man hinh va wireframe: `.claude/docs/man-hinh-tong-quan.drawio`
(mo bang extension Draw.io Integration hoac app.diagrams.net).

Thu muc `web/` la web app san pham cu, doc bang `products` da xoa trong database `tranquil`.

## Production (Vercel + Neon)

| Thanh phan | Dia chi | Project Vercel |
|---|---|---|
| Website (Next.js, `frontend/`) | https://vndental-ten.vercel.app | `vndental` |
| API (Express, `backend/`) | https://phantomdental.vercel.app/api | `phantomdental` |
| Database | Neon Free `phantom-clinic-db`, PostgreSQL 18, Singapore, database `TranquilClinicDB` | gan vao `phantomdental` |

`vndental.vercel.app` va `bevndental.vercel.app` da thuoc tai khoan Vercel khac nen khong dung duoc.
Trinh duyet chi goi `/api/*` tren website; Next.js chuyen tiep sang API (`frontend/.env.production`:
`API_URL=https://phantomdental.vercel.app`, ghi vao ban build), nen cookie dang nhap la cookie
cung domain voi website. Lan dau sau mot luc khong ai dung, Neon va function Vercel phai thuc day
nen request dau mat khoang 15 giay; cac request sau duoi 2 giay.

### Trien khai

Ca hai project noi voi GitHub `tranquil-git/phantom-clinic`: moi lan `git push` len `main`, Vercel tu
build lai ca hai (nhanh khac `main` thanh ban Preview). Moi project build mot thu muc con, dat trong
*Settings → Build and Deployment → Root Directory*:

| Project | Root Directory | Cach chay |
|---|---|---|
| `vndental` | `frontend` | Next.js |
| `phantomdental` | `backend` | `api/index.js` xuat app Express; `vercel.json` chuyen moi duong dan vao do, region `sin1` |

Root Directory de trong thi Vercel build ca repo va bao loi
*Couldn't find any `pages` or `app` directory*. Trien khai lai khong can commit moi:
Vercel → project → *Deployments* → *Redeploy*.

Thu muc `.vercel/` (lien ket voi project) va `.env.local` do Vercel CLI tao, khong commit.
`backend/.vercelignore` khong tai `.env*` va `scripts/` len Vercel.

### Bien moi truong API (project `phantomdental`, moi truong Production)

| Bien | Ghi chu |
|---|---|
| `NODE_ENV=production` | Bat cookie `Secure`, bat buoc co `DATABASE_URL` |
| `DATABASE_URL` | Neon, ban *pooled* (host `...-pooler...`), database `TranquilClinicDB` |
| `JWT_SECRET` | Toi thieu 32 ky tu, khac ban dev |
| `DB_POOL_MAX=5` | So ket noi moi instance |
| `NODEJS_HELPERS=0` | Tat helper `req.body`/`req.cookies` cua Vercel, de Express tu xu ly nhu khi chay o may |
| `NEON_*` | Do Neon tu tao khi gan database (`NEON_DATABASE_URL` tro vao database `neondb` mac dinh) |

Them / sua: `cd backend; npx vercel env add <TEN> --environment production` roi trien khai lai.
Chay API o host khac (Render, Railway...): `npm start` (doc `backend/.env.production` neu co),
them `PORT`, `HOST` (mac dinh `4000`, `0.0.0.0`); `COOKIE_SECURE=false` chi khi thu tren `http://127.0.0.1`.

### Database production

`backend/.env.production` (Git bo qua; mau `backend/.env.production.example`) chua `DATABASE_URL` ket noi
truc tiep toi Neon, role `neondb_owner`, dung cho cac lenh trong `backend/`:

- `npm run db:deploy`: nap `db/schema.sql` + `db/seed.sql` (them `-- --schema-only` neu khong muon du lieu mau).
  Database da co du lieu thi chi in so dong, khong ghi de.
- `npm run set-password:prod -- <user> <mat khau>`: doi mat khau tren production. Mat khau mau
  `Demo@123` ghi cong khai o tren, nen doi truoc khi dua website cho nguoi ngoai.

Quan ly database: Vercel → project `phantomdental` → *Storage* → `phantom-clinic-db` → *Open in Neon*.
API tu dat `SET TIME ZONE 'Asia/Ho_Chi_Minh'` cho moi ket noi (Neon mac dinh UTC); `db:deploy` cung dat
mui gio mac dinh cua database.

## Quan ly

```powershell
docker compose up -d --wait
docker compose ps
docker compose logs --tail 50 postgres
docker compose exec postgres psql -U tranquil -d tranquil
docker compose stop
docker compose start
```

Du lieu duoc luu trong named volume `buoi3-4_postgres_data`, van con sau khi
container duoc tao lai. `docker compose down` giu volume; them `-v` se xoa du lieu.

PostgreSQL chi duoc mo tren localhost. Image `postgres:18` dung duong dan volume
`/var/lib/postgresql` theo [huong dan image chinh thuc](https://hub.docker.com/_/postgres).

`POSTGRES_USER`, `POSTGRES_PASSWORD` va `POSTGRES_DB` chi khoi tao khi volume rong.
Sua `.env` sau khi khoi tao khong tu doi user, mat khau hoac database hien co.
"# phantom-clinic" 
