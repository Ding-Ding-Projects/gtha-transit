@echo off
setlocal
cd /d "%~dp0"
call "%~dp0download-dependencies.bat" /s
if errorlevel 1 exit /b 1
set "PATH=%LOCALAPPDATA%\GTHATransit\toolchains\node-v24.19.0-win-x64;%PATH%"
call npm run build
if errorlevel 1 exit /b 1
if /i "%~1"=="--run" call npm start
if /i "%~1"=="/run" call npm start
exit /b %errorlevel%
