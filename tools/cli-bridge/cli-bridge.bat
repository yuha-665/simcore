@echo off
chcp 65001 >nul
title SimCore CLI 다리 (Claude Code / Codex)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 없어요. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
node simcore-cli-bridge.js
if errorlevel 1 pause
