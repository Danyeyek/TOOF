@echo off
rem ============================================================
rem  TOOF - one-click: deploy Firestore rules and indexes.
rem  Thin wrapper around tasks.bat (task: deploy-rules).
rem  Run from anywhere: the game folder is taken from this file.
rem ============================================================

if "%~1"=="" (
    call "%~dp0tasks.bat" deploy-rules -pause
) else (
    call "%~dp0tasks.bat" deploy-rules %*
)
exit /b %ERRORLEVEL%
