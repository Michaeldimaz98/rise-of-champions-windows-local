@echo off
REM Rise of Champions - Windows Launcher
REM Bahasa Indonesia
setlocal EnableDelayedExpansion

REM Pindah ke folder script ini (mendukung path dengan spasi)
cd /d "%~dp0"

echo ============================================
echo   RISE OF CHAMPIONS - Local Server
echo ============================================
echo.

REM 1. Cek Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js tidak ditemukan!
    echo.
    echo Silakan install Node.js LTS dari https://nodejs.org/
    echo Lalu jalankan lagi RUN_GAME.bat
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODEVER=%%v
echo [OK] Node.js ditemukan: %NODEVER%
echo.

REM 2. Cek file server
if not exist "server\src\http\server.js" (
    echo [ERROR] File server tidak ditemukan!
    echo Pastikan Anda mengekstrak seluruh isi ZIP.
    echo.
    pause
    exit /b 1
)

REM 3. Port (bisa diubah via environment variable PORT)
if "%PORT%"=="" set PORT=3000
echo [INFO] Server akan berjalan di http://localhost:%PORT%
echo [INFO] Data tersimpan di folder server\data
echo.
echo Menunggu server siap...
echo.

REM 4. Jalankan server di background, buka browser setelah siap
start "Rise of Champions Server" /min cmd /c "cd /d "%~dp0server" && node src\http\server.js"

REM Tunggu server merespons (maks 30 detik)
set /a TRIES=0
:waitloop
set /a TRIES+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PORT%/' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% EQU 0 goto ready
if %TRIES% GEQ 15 (
    echo [ERROR] Server tidak merespons setelah 30 detik.
    echo Cek jendela "Rise of Champions Server" untuk pesan error.
    echo Jika port %PORT% sudah dipakai, tutup aplikasi lain atau jalankan:
    echo   set PORT=3001 ^&^& RUN_GAME.bat
    echo.
    pause
    exit /b 1
)
timeout /t 2 /nobreak >nul
goto waitloop

:ready
echo [OK] Server siap!
echo Membuka browser...
start http://localhost:%PORT%/
echo.
echo ============================================
echo  Game berjalan di http://localhost:%PORT%/
echo  Untuk berhenti: tutup jendela "Rise of Champions Server"
echo  atau tekan Ctrl+C di jendela tersebut.
echo  Data tersimpan otomatis di server\data
echo ============================================
echo.
pause
