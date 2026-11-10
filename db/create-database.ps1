# Tạo TranquilClinicDB: user quản trị, database, bảng (schema.sql), dữ liệu mẫu (seed.sql) và migration (db/migrations).
# Chạy từ thư mục gốc dự án:  powershell -ExecutionPolicy Bypass -File db/create-database.ps1
# Đọc POSTGRES_USER, CLINIC_DB_NAME, CLINIC_DB_USER, CLINIC_DB_PASSWORD từ .env.
# Database đã có bảng thì không chạy lại schema / seed; migration chỉ chạy file chưa chạy.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$envVars = @{}
foreach ($line in Get-Content .env -Encoding UTF8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value -match "^'(.*)'$" -or $value -match '^"(.*)"$') { $value = $Matches[1] }
        $envVars[$name] = $value
    }
}
foreach ($name in 'POSTGRES_USER', 'CLINIC_DB_NAME', 'CLINIC_DB_USER', 'CLINIC_DB_PASSWORD') {
    if (-not $envVars[$name]) { throw "Thiếu $name trong .env" }
}
$superUser = $envVars.POSTGRES_USER
$dbName = $envVars.CLINIC_DB_NAME
$dbUser = $envVars.CLINIC_DB_USER
$dbPassword = $envVars.CLINIC_DB_PASSWORD

function Invoke-Native([scriptblock]$Command, [string]$Step) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Lỗi ở bước: $Step" }
}

# Chép file vào container rồi chạy bằng -f để giữ nguyên tiếng Việt có dấu
foreach ($file in 'create-database.sql', 'schema.sql', 'seed.sql') {
    Invoke-Native { docker compose cp "db/$file" "postgres:/tmp/$file" | Out-Null } "chép $file"
}

Write-Host "1/4 Tạo user $dbUser và database $dbName"
Invoke-Native {
    docker compose exec -T postgres psql -U $superUser -d postgres -v ON_ERROR_STOP=1 -q `
        -v "db_name=$dbName" -v "db_user=$dbUser" -v "db_password=$dbPassword" -f /tmp/create-database.sql
} 'tạo user / database'

# Từ đây đăng nhập bằng chính user quản trị qua TCP, để bảng thuộc về user đó
$asAdmin = @('compose', 'exec', '-T', '-e', "PGPASSWORD=$dbPassword", 'postgres',
             'psql', '-h', '127.0.0.1', '-U', $dbUser, '-d', $dbName, '-v', 'ON_ERROR_STOP=1', '-q')

$hasTables = (& docker @asAdmin -tAc "SELECT to_regclass('public.staff') IS NOT NULL").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Không đăng nhập được bằng user quản trị' }

if ($hasTables -eq 't') {
    Write-Host '2/4 Database đã có bảng — bỏ qua schema.sql và seed.sql'
} else {
    Write-Host '2/4 Tạo bảng (schema.sql)'
    Invoke-Native { docker @asAdmin -f /tmp/schema.sql } 'schema.sql'
    Write-Host '3/4 Nạp dữ liệu mẫu (seed.sql)'
    Invoke-Native { docker @asAdmin -f /tmp/seed.sql } 'seed.sql'
}

docker compose exec -T postgres rm -f /tmp/create-database.sql /tmp/schema.sql /tmp/seed.sql | Out-Null

# Bảng phân quyền, nhật ký đăng nhập… nằm trong db/migrations; chạy bằng script Node của backend (ghi nhận file đã chạy)
if (Test-Path backend/node_modules/pg) {
    Write-Host '4/4 Chạy migration (db/migrations)'
    Push-Location backend
    try { Invoke-Native { node --env-file=../.env scripts/migrate.js } 'migration' } finally { Pop-Location }
} else {
    Write-Warning '4/4 Chưa cài backend: chạy "cd backend; npm install; npm run db:migrate" để tạo bảng phân quyền'
}
Write-Host "Xong: $dbName, chủ sở hữu $dbUser"
