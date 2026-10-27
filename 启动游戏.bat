@echo off
title PokeBonk Offline
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto NONODE

echo.
echo   Starting PokeBonk Offline ...
echo   Your browser will open automatically.
echo   Close this window to stop the server.
echo.
node serve.js --open
goto END

:NONODE
echo.
echo   [!] Node.js not found.
echo       This game needs a tiny local server to run.
echo       Install Node.js from https://nodejs.org/ then run this file again.
echo.
pause

:END
