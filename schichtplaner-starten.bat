@echo off
chcp 65001 >nul
title Schichtplaner
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop ist nicht installiert.
  echo Bitte installieren: https://www.docker.com/products/docker-desktop/
  start "" "https://www.docker.com/products/docker-desktop/"
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop wird gestartet ...
  if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  :warten
  timeout /t 3 /nobreak >nul
  docker info >nul 2>nul
  if errorlevel 1 goto warten
)

echo Schichtplaner wird gestartet (beim ersten Mal dauert das einige Minuten) ...
docker compose up -d --build
if errorlevel 1 (
  echo Start fehlgeschlagen. Details oben.
  pause
  exit /b 1
)

echo Warte, bis die App bereit ist ...
:bereit
timeout /t 3 /nobreak >nul
curl -k -s -o nul https://localhost/api/health
if errorlevel 1 goto bereit

start "" "https://localhost"
