@echo off
rem Keep this file ASCII with CRLF line endings. cmd.exe misreads multibyte text in an LF batch file,
rem cuts a line in half and exits before reaching pause, so a double-click only flashes a window.
chcp 65001 >nul
title SimCore CLI bridge (Claude Code / Codex)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node simcore-cli-bridge.js
if errorlevel 1 pause
