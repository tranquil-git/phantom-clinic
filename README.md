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

## Production: database tren Neon + cau hinh API

Database online dung [Neon](https://neon.tech) goi Free: khong can the, region Singapore,
tu ngu khi khong ai dung va thuc lai sau vai giay o request dau tien.

1. Tren https://console.neon.tech tao project `phantom-clinic`, Postgres 17 hoac 18,
   region `AWS Asia Pacific 1 (Singapore)`.
2. Branch `main` → *Roles & Databases*: them role `TranAdmin`, them database
   `TranquilClinicDB` voi owner `TranAdmin`.
3. *Connect* → database `TranquilClinicDB`, role `TranAdmin`, tat *Connection pooling*,
   chep chuoi ket noi vao `DATABASE_URL` trong `backend/.env.production`
   (mau: `backend/.env.production.example`; file that bi Git bo qua).
4. Nap bang + du lieu mau:

   ```powershell
   cd backend; npm run db:deploy          # them "-- --schema-only" neu khong muon du lieu mau
   ```

   Database da co du lieu thi script chi in so dong, khong ghi de.

Bien moi truong cua API production (dat trong `backend/.env.production` hoac muc Environment cua host):

| Bien | Ghi chu |
|---|---|
| `NODE_ENV=production` | Bat cookie `Secure`, lang nghe `0.0.0.0`, bat buoc co `DATABASE_URL` |
| `DATABASE_URL` | Chuoi ket noi Neon; dan nguyen `?sslmode=require&channel_binding=require` cung duoc |
| `JWT_SECRET` | Toi thieu 32 ky tu, khac ban dev |
| `PORT`, `HOST` | Host thuong tu dat `PORT`; mac dinh `4000`, `0.0.0.0` |
| `DB_POOL_MAX` | Mac dinh 10 |
| `COOKIE_SECURE=false` | Chi khi chay ban production tren `http://127.0.0.1` (khong HTTPS) |

Lenh trong `backend/`:

- `npm start`: production, doc `.env.production` neu co, neu khong dung bien moi truong cua host.
- `npm run dev` / `npm run start:local`: may dev, doc `../.env` (Postgres Docker).
- `npm run set-password:prod -- <user> <mat khau>`: doi mat khau tren production. Mat khau mau
  `Demo@123` ghi cong khai o tren, nen doi truoc khi mo website cho nguoi ngoai.

Moi ket noi tu dat `SET TIME ZONE 'Asia/Ho_Chi_Minh'`, vi Neon mac dinh UTC.
Frontend: dat `API_URL=https://<dia-chi-api>` truoc khi chay `npm run build`, vi Next.js ghi
dia chi chuyen tiep `/api/*` vao ban build.

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
