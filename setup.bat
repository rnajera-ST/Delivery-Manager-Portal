@echo off
REM Manager Portal - First Time Setup (Windows). Double-click or run `setup.bat`.
setlocal enabledelayedexpansion

echo.
echo   ========================================
echo     Manager Portal - First Time Setup
echo   ========================================
echo.

cd /d "%~dp0"

echo   [1/4] Installing dependencies...
pip install flask snowflake-connector-python requests snowflake-connector-python[secure-local-storage] >nul 2>&1
echo   Done.

echo.
echo   [2/4] Your profile
set /p FULL_NAME="  Your full name (as it appears in Salesforce): "
set /p EMAIL="  Your ServiceTitan email: "
set /p INITIALS="  Your initials (2 letters): "

REM Role detection: is this name in the LEAD_ICS list in server.py?
set ROLE=manager
for /f "delims=" %%L in ('findstr /B "LEAD_ICS" server.py') do set "LEADLINE=%%L"
echo !LEADLINE! | findstr /C:"!FULL_NAME!" >nul && set ROLE=lead-ic
if "!ROLE!"=="lead-ic" (echo.& echo   Detected: Lead IC role)

echo.
echo   [3/4] Saving your config...
if not exist ".data" mkdir ".data"
for /f "tokens=1" %%a in ("!FULL_NAME!") do set "FIRST=%%a"
(
echo {
echo   "manager": {
echo     "name": "!FIRST!",
echo     "fullName": "!FULL_NAME!",
echo     "initials": "!INITIALS!",
echo     "role": "Manager, SMB Implementation",
echo     "reportsTo": "",
echo     "skip": ""
echo   },
echo   "team": [],
echo   "role": "!ROLE!"
echo }
) > config.json
<nul set /p="!EMAIL!" > ".data\snowflake-user.txt"
echo   [4/4] Done ^(role: !ROLE!^).

echo.
echo   To start the dashboard:  python server.py
echo   Then open http://localhost:5001 in Chrome.
echo   Update later with: git pull   ^(your .data settings are kept^).
echo.
pause
