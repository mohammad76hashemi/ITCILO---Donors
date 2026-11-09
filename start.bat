@echo off
title Donor and Partner Explorer
rem Double-click this file to start the Donor and Partner Explorer on Windows.
rem It starts the server (which saves everything in the database) and opens the site.
rem Keep this window open while you use the site. Close it to stop.
cd /d "%~dp0"

set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY python3 -c "import sys" >nul 2>nul && set "PY=python3"
if not defined PY (
  echo.
  echo Python is not installed on this computer.
  echo 1. Download it from https://www.python.org/downloads/
  echo 2. During setup, tick "Add python.exe to PATH".
  echo 3. Then double-click start.bat again.
  echo.
  pause
  exit /b 1
)

echo Starting the Donor and Partner Explorer...
%PY% server.py --open
echo.
pause
